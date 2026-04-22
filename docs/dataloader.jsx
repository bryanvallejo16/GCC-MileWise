// Loads pre-generated GeoJSON files (produced by prepare_data.py) and
// builds an in-memory road graph for Dijkstra routing.
//
// Exposes:
//   window.loadRealData()   -> Promise<{buildings, roads, graph, depot, chargers, boundary}>
//   window.dijkstraGraph    -> Dijkstra on the graph
//   window.reconstructPath  -> rebuild a polyline from prev[] array

async function loadRealData() {
  // 1) Site config (depot, chargers, boundary)
  const pre = await fetch('data.json').then(r => {
    if (!r.ok) throw new Error('data.json failed to load (' + r.status + ')');
    return r.json();
  });

  // 2) Buildings as plain GeoJSON Points
  const bGeo = await fetch('data/buildings.geojson').then(r => {
    if (!r.ok) throw new Error('buildings.geojson failed to load (' + r.status + ')');
    return r.json();
  });
  const buildings = bGeo.features.map((f, i) => ({
    id: i,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  })).filter(b => isFinite(b.lon) && isFinite(b.lat));

  // 3) Roads as plain GeoJSON LineStrings
  const rGeo = await fetch('data/roads.geojson').then(r => {
    if (!r.ok) throw new Error('roads.geojson failed to load (' + r.status + ')');
    return r.json();
  });
  const roads = rGeo.features.map(f => f.geometry.coordinates).filter(l => l && l.length >= 2);

  // 4) Build a routable graph.
  //    - Snap nearby endpoints together on a ~5 m grid (SNAP) so the same
  //      intersection shared by multiple road segments becomes one node.
  //    - Edge weight = haversine distance in km.
  const SNAP = 1e-4;
  const key = (lon, lat) => `${Math.round(lon / SNAP)}:${Math.round(lat / SNAP)}`;
  const nodeMap = new Map();   // key -> node id
  const nodes = [];            // [{lon, lat}]
  const adj = [];              // adj[id] = [{to, w}]

  const getNode = (lon, lat) => {
    const k = key(lon, lat);
    let id = nodeMap.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ lon, lat });
      nodeMap.set(k, id);
      adj.push([]);
    }
    return id;
  };

  const dkm = (a, b) => {
    // Equirectangular approximation — plenty accurate at this scale
    const dx = (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180);
    const dy = (a.lat - b.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  };

  for (const line of roads) {
    for (let i = 0; i < line.length - 1; i++) {
      const u = getNode(line[i][0], line[i][1]);
      const v = getNode(line[i + 1][0], line[i + 1][1]);
      if (u === v) continue;
      const w = dkm(nodes[u], nodes[v]);
      adj[u].push({ to: v, w });
      adj[v].push({ to: u, w });
    }
  }

  // 5) Spatial index for snap-to-nearest-node on ~1 km grid cells.
  const cell = 0.01;
  const cellMap = new Map();
  nodes.forEach((n, id) => {
    const ck = `${Math.floor(n.lon / cell)}:${Math.floor(n.lat / cell)}`;
    if (!cellMap.has(ck)) cellMap.set(ck, []);
    cellMap.get(ck).push(id);
  });
  function nearestNode(lon, lat) {
    const cx = Math.floor(lon / cell), cy = Math.floor(lat / cell);
    let best = -1, bd = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const arr = cellMap.get(`${cx + dx}:${cy + dy}`);
        if (!arr) continue;
        for (const id of arr) {
          const n = nodes[id];
          const d = (n.lon - lon) ** 2 + (n.lat - lat) ** 2;
          if (d < bd) { bd = d; best = id; }
        }
      }
    }
    return best;
  }

  console.log(`[dataloader] ${buildings.length.toLocaleString()} buildings, ` +
              `${roads.length.toLocaleString()} road segments, ` +
              `${nodes.length.toLocaleString()} graph nodes`);

  return {
    ...pre,
    buildings,
    roads,
    graph: { nodes, adj, nearestNode },
  };
}

// Dijkstra from a source node. Returns { dist: Float32Array, prev: Int32Array }.
// maxDist (km) bounds the expansion; unreachable nodes stay at Infinity.
function dijkstra(graph, src, maxDist = Infinity) {
  const n = graph.nodes.length;
  const dist = new Float32Array(n);
  dist.fill(Infinity);
  const prev = new Int32Array(n);
  prev.fill(-1);
  dist[src] = 0;

  // Binary min-heap
  const heap = [[0, src]];
  const siftUp = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] > heap[i][0]) { [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } else break;
    }
  };
  const siftDown = (i) => {
    const m = heap.length;
    while (true) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let s = i;
      if (l < m && heap[l][0] < heap[s][0]) s = l;
      if (r < m && heap[r][0] < heap[s][0]) s = r;
      if (s !== i) { [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } else break;
    }
  };

  while (heap.length) {
    const [d, u] = heap[0];
    heap[0] = heap[heap.length - 1]; heap.pop(); if (heap.length) siftDown(0);
    if (d > dist[u]) continue;
    if (d > maxDist) continue;
    for (const e of graph.adj[u]) {
      const nd = d + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        heap.push([nd, e.to]);
        siftUp(heap.length - 1);
      }
    }
  }
  return { dist, prev };
}

function reconstructPath(graph, prev, target) {
  const pts = [];
  let cur = target;
  while (cur !== -1) {
    pts.push([graph.nodes[cur].lon, graph.nodes[cur].lat]);
    cur = prev[cur];
  }
  return pts.reverse();
}

window.loadRealData = loadRealData;
window.dijkstraGraph = dijkstra;
window.reconstructPath = reconstructPath;
