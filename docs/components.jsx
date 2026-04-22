// UI components + solver mock
const { useState, useEffect, useRef, useMemo } = React;

// ---------------- TOP BAR ----------------
function TopBar({ result, running, progress }) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M3 17h2l2-6h10l2 6h2" stroke="#0B7A75" strokeWidth="1.6" strokeLinecap="round"/>
          <circle cx="7.5" cy="17.5" r="1.8" fill="#0B7A75"/>
          <circle cx="16.5" cy="17.5" r="1.8" fill="#0B7A75"/>
          <path d="M11 3v4M11 5h3" stroke="#0B7A75" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        <div className="brand-text">
          <div className="brand-name">GCC MileWise</div>
          <div className="brand-sub">Rovaniemi · Fleet Routing</div>
        </div>
      </div>
      <div className="crumbs">
        <span className="crumb">Analysis</span>
        <span className="crumb-sep">/</span>
        <span className="crumb active">EV Delivery · Daily Plan</span>
      </div>
      <div className="top-actions">
        <div className="meta-chip">
          <span className="dot" />
          {running ? `Solver running · ${Math.round(progress * 100)}%` : result ? 'Solved' : 'Ready'}
        </div>
        <button className="btn-ghost" title="Export (mock)">Export GeoJSON</button>
        <button className="btn-ghost" title="Share (mock)">Share</button>
      </div>
    </header>
  );
}

// ---------------- SIDEBAR ----------------
function Sidebar(props) {
  const { data, numEV, setNumEV, evRange, setEvRange, startBattery, setStartBattery,
    depotId, setDepotId, workDay, setWorkDay,
    loadState,
    running, progress, stage, logLines, result, onRun, railWidth } = props;

  const stages = ['Clustering', 'Routing', 'Coverage', 'Gaps'];
  const stageMap = { clustering: 0, routing: 1, coverage: 2, gaps: 3, done: 4 };
  const curIdx = stageMap[stage] ?? -1;

  return (
    <aside className="rail" style={{ width: railWidth }}>
      <div className="rail-scroll">
        <section className="rail-block">
          <div className="block-label">Depot</div>
          <div className="depot-card">
            <div className="depot-name">Rovaniemi Fleet Depot</div>
            <div className="depot-meta">66.4799°N · 25.6203°E</div>
            <div className="depot-fleet">
              <span className="tag tag-diesel">28 diesel</span>
              <span className="tag tag-ev">5 EV</span>
              <span className="tag tag-gas">4 gas</span>
            </div>
          </div>
        </section>

        <section className="rail-block">
          <div className="block-label">Routing parameters</div>

          <Stepper label="Number of EV vehicles" value={numEV} setValue={setNumEV} min={1} max={12} unit="" />
          <Slider label="EV range" value={evRange} setValue={setEvRange} min={80} max={400} step={10} unit=" km" />
          <Slider label="Starting battery" value={startBattery} setValue={setStartBattery} min={40} max={100} step={1} unit=" %" />
          <Slider label="Working day" value={workDay} setValue={setWorkDay} min={4} max={12} step={1} unit=" h" />

          <div className="field">
            <label className="field-label">Depot</label>
            <div className="select-wrap">
              <select value={depotId} onChange={e => setDepotId(e.target.value)}>
                <option value="rovaniemi-main">Rovaniemi Fleet Depot (primary)</option>
                <option value="napapiiri" disabled>Napapiiri Sub-hub (offline)</option>
                <option value="sodankyla" disabled>Sodankylä Depot (out of area)</option>
              </select>
            </div>
          </div>
        </section>

        {loadState && loadState.stage !== 'ready' && (
          <section className="rail-block">
            <div className="load-card">
              <span className="spinner spinner-dark" />
              <div>
                <div className="load-title">Loading data</div>
                <div className="load-msg">{loadState.msg}</div>
              </div>
            </div>
          </section>
        )}

        <section className="rail-block">
          <button className="btn-run" onClick={onRun} disabled={running || !data}>
            {running ? (
              <>
                <span className="spinner" />
                Solving · {Math.round(progress * 100)}%
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 2v10l8-5-8-5z" fill="currentColor" />
                </svg>
                Run Analysis
              </>
            )}
          </button>
          {(running || result) && (
            <>
              <div className="progress"><div className="progress-fill" style={{ width: `${progress * 100}%` }} /></div>
              <div className="stage-pills">
                {stages.map((s, i) => (
                  <div key={s} className={`pill ${curIdx > i ? 'done' : curIdx === i ? 'active' : ''}`}>
                    <span className="pill-num">{i + 1}</span>{s}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="rail-block log-block">
          <div className="block-label">Solver log</div>
          <LogView lines={logLines} />
        </section>
      </div>
    </aside>
  );
}

function Stepper({ label, value, setValue, min, max, unit }) {
  return (
    <div className="field">
      <label className="field-label">
        <span>{label}</span>
        <span className="field-val">{value}{unit}</span>
      </label>
      <div className="stepper">
        <button onClick={() => setValue(Math.max(min, value - 1))} aria-label="decrement">−</button>
        <div className="stepper-bar">
          <input type="range" min={min} max={max} value={value} onChange={e => setValue(+e.target.value)} />
        </div>
        <button onClick={() => setValue(Math.min(max, value + 1))} aria-label="increment">+</button>
      </div>
    </div>
  );
}

function Slider({ label, value, setValue, min, max, step, unit }) {
  return (
    <div className="field">
      <label className="field-label">
        <span>{label}</span>
        <span className="field-val">{value}{unit}</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => setValue(+e.target.value)} />
      <div className="range-ticks">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

function LogView({ lines }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  if (lines.length === 0) return <div className="log-empty">Run the analysis to stream solver output.</div>;
  return (
    <div className="log" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={`log-line log-${l.level}`}>
          <span className="log-time">{l.t.toTimeString().slice(0, 8)}</span>
          <span className="log-msg">{l.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- KPI STRIP ----------------
function KPIStrip({ result }) {
  const kpis = [
    { label: 'Buildings covered', value: result.covered, sub: `of ${result.total}`, tone: 'ok' },
    { label: 'Unreachable', value: result.unreachable.length, sub: 'out of range', tone: result.unreachable.length ? 'warn' : 'ok' },
    { label: 'Total distance', value: `${result.totalKm.toFixed(1)} km`, sub: `${result.vehicles.length} routes` },
    { label: 'Avg SOC end-of-day', value: `${Math.round(result.avgEndSOC)}%`, sub: 'battery remaining' },
    { label: 'CO₂ avoided', value: `${result.co2Saved.toFixed(0)} kg`, sub: 'vs diesel baseline', tone: 'ok' },
    { label: 'Suggested chargers', value: result.suggestedChargers.length, sub: 'new sites' },
  ];
  return (
    <div className="kpi-strip">
      {kpis.map(k => (
        <div key={k.label} className={`kpi kpi-${k.tone || ''}`}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-sub">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- SUGGESTED CHARGERS ----------------
function SuggestedChargersPanel({ chargers }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`sc-panel ${open ? 'open' : 'closed'}`}>
      <div className="sc-head" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="sc-title">Suggested EV charger sites</div>
          <div className="sc-sub">Ranked by uncovered demand within a 3 km buffer</div>
        </div>
        <div className="sc-toggle">{open ? '▾' : '▸'}</div>
      </div>
      {open && (
        <div className="sc-body">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Proposed site</th>
                <th>Coords</th>
                <th>Score</th>
                <th>Gains</th>
                <th>Power</th>
              </tr>
            </thead>
            <tbody>
              {chargers.map((c, i) => (
                <tr key={c.id}>
                  <td><div className="rank">#{i + 1}</div></td>
                  <td>
                    <div className="site-name">{c.name}</div>
                    <div className="site-note">{c.note}</div>
                  </td>
                  <td className="mono">{c.lat.toFixed(4)}°N, {c.lon.toFixed(4)}°E</td>
                  <td>
                    <div className="score-bar"><div className="score-fill" style={{ width: `${c.score}%` }} /><span>{c.score}</span></div>
                  </td>
                  <td>+{c.buildingsServed} buildings</td>
                  <td><span className="power-chip">{c.power}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- TWEAKS ----------------
function TweaksPanel({ tweaks, apply, onClose }) {
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span>Tweaks</span>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="tweaks-body">
        <div className="tw-field">
          <label>Route palette</label>
          <div className="tw-pills">
            {['nordic', 'vibrant', 'mono'].map(p => (
              <button key={p} className={`tw-pill ${tweaks.paletteMode === p ? 'on' : ''}`} onClick={() => apply('paletteMode', p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="tw-field">
          <label>Accent hue <span className="mono">{tweaks.accentHue}°</span></label>
          <input type="range" min={0} max={360} value={tweaks.accentHue} onChange={e => apply('accentHue', +e.target.value)} />
        </div>
        <div className="tw-field">
          <label className="tw-check">
            <input type="checkbox" checked={tweaks.showRoads} onChange={e => apply('showRoads', e.target.checked)} />
            Show road network overlay
          </label>
        </div>
        <div className="tw-field">
          <label className="tw-check">
            <input type="checkbox" checked={tweaks.showBuildingsBefore} onChange={e => apply('showBuildingsBefore', e.target.checked)} />
            Show buildings before Run
          </label>
        </div>
        <div className="tw-field">
          <label>Rail width <span className="mono">{tweaks.railWidth}px</span></label>
          <input type="range" min={280} max={420} value={tweaks.railWidth} onChange={e => apply('railWidth', +e.target.value)} />
        </div>
      </div>
    </div>
  );
}

// ---------------- MOCK SOLVER ----------------
function buildMockResult(data, { numEV, evRange, startBattery, maxStops }) {
  const palette = ['#0B7A75', '#D97706', '#6D28D9', '#BE185D', '#0369A1', '#15803D', '#B45309', '#7C2D12'];
  const depot = data.depot;
  const buildings = data.buildings;

  // Cluster buildings by angle+distance from depot into numEV clusters (k-means lite)
  // seed centroids by angle
  const centroids = [];
  for (let i = 0; i < numEV; i++) {
    const ang = (i / numEV) * Math.PI * 2;
    centroids.push({ lon: depot.lon + Math.cos(ang) * 0.08, lat: depot.lat + Math.sin(ang) * 0.04 });
  }
  // assign
  const assign = buildings.map(b => {
    let best = 0, bd = Infinity;
    centroids.forEach((c, i) => {
      const d = (c.lon - b.lon) ** 2 + (c.lat - b.lat) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  });
  // recenter once
  for (let i = 0; i < numEV; i++) {
    let sx = 0, sy = 0, n = 0;
    buildings.forEach((b, idx) => { if (assign[idx] === i) { sx += b.lon; sy += b.lat; n++; } });
    if (n) centroids[i] = { lon: sx / n, lat: sy / n };
  }
  // reassign
  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k];
    let best = 0, bd = Infinity;
    centroids.forEach((c, i) => {
      const d = (c.lon - b.lon) ** 2 + (c.lat - b.lat) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    assign[k] = best;
  }

  // Distance helper (approx km)
  const km = (a, b) => {
    const dx = (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180);
    const dy = (a.lat - b.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Build routes: nearest-neighbor from depot, cap at maxStops
  const vehicles = [];
  const unreachable = [];
  for (let v = 0; v < numEV; v++) {
    const pool = buildings.filter((_, i) => assign[i] === v).slice();
    const route = [depot];
    let cur = depot;
    let dist = 0;
    const stops = [];
    while (pool.length && stops.length < maxStops) {
      pool.sort((a, b) => km(cur, a) - km(cur, b));
      const nxt = pool.shift();
      const d = km(cur, nxt);
      // Rough battery: effective range = evRange * startBattery/100 - need to return
      const effectiveRange = evRange * (startBattery / 100);
      if (dist + d + km(nxt, depot) > effectiveRange * 0.95) {
        // can't reach & return — mark as unreachable if truly too far
        if (km(depot, nxt) > effectiveRange * 0.5) unreachable.push(nxt);
        break;
      }
      route.push(nxt);
      stops.push(nxt);
      dist += d;
      cur = nxt;
    }
    // Unrouted remaining: if close to other clusters it's fine; else consider unreachable
    pool.forEach(b => {
      if (km(depot, b) > evRange * (startBattery / 100) * 0.5) unreachable.push(b);
    });
    dist += km(cur, depot);
    route.push(depot);
    vehicles.push({
      id: `EV-${String(v + 1).padStart(2, '0')}`,
      color: palette[v % palette.length],
      route,
      stops,
      distanceKm: dist,
      endSOC: Math.max(5, startBattery - (dist / evRange) * 100),
    });
  }

  const uniqueUnreachable = Array.from(new Map(unreachable.map(b => [b.id, b])).values());

  // Suggested charger sites: cluster unreachable points into K sites (farthest-point)
  const numSites = Math.min(5, Math.max(2, Math.ceil(uniqueUnreachable.length / 15)));
  const sites = [];
  const namePool = ['Napapiiri Arctic Circle lot', 'Ounasvaara trailhead', 'Saarenkylä Prisma', 'Nivavaara park-and-ride', 'Vikajärvi service area', 'Muurola crossroads', 'Sinettä church lot'];
  const notePool = ['Near tourist hub · high dwell time', 'Residential density · overnight charging', 'Suburban retail · mid-day top-up', 'Commuter node · evening charging', 'Highway layby · fast DC', 'Village center · community access'];
  const powers = ['50 kW DC', '150 kW DC', '22 kW AC', '150 kW DC', '50 kW DC'];
  for (let i = 0; i < numSites; i++) {
    // Pick a point far from existing sites + depot
    let best = null, bestScore = -Infinity;
    for (const u of uniqueUnreachable) {
      let s = km(u, depot);
      for (const existing of sites) s = Math.min(s, km(u, existing));
      if (s > bestScore) { bestScore = s; best = u; }
    }
    if (!best && uniqueUnreachable.length) best = uniqueUnreachable[i % uniqueUnreachable.length];
    if (!best) {
      // fallback: place near city edge
      const ang = (i / numSites) * Math.PI * 2;
      best = { lon: depot.lon + Math.cos(ang) * 0.12, lat: depot.lat + Math.sin(ang) * 0.06 };
    }
    const served = uniqueUnreachable.filter(b => km(best, b) < 3 / 111).length;
    sites.push({
      id: i,
      lon: best.lon + (Math.random() - 0.5) * 0.005,
      lat: best.lat + (Math.random() - 0.5) * 0.003,
      name: namePool[i % namePool.length],
      note: notePool[i % notePool.length],
      score: Math.max(52, 98 - i * 11 - Math.floor(Math.random() * 6)),
      buildingsServed: Math.max(served, 18 - i * 3),
      power: powers[i % powers.length],
    });
  }

  const totalKm = vehicles.reduce((s, v) => s + v.distanceKm, 0);
  const covered = vehicles.reduce((s, v) => s + v.stops.length, 0);
  const avgEndSOC = vehicles.reduce((s, v) => s + v.endSOC, 0) / vehicles.length;
  const co2Saved = totalKm * 0.21; // ~210g/km diesel equivalent
  return {
    vehicles,
    unreachable: uniqueUnreachable,
    suggestedChargers: sites,
    totalKm,
    covered,
    total: buildings.length,
    avgEndSOC,
    co2Saved,
  };
}

// -------- REAL SOLVER (road-network constrained) --------
// progress callback: (frac 0-1, optional msg, optional level)
async function solveOnRoadNetwork(data, { numEV, evRange, startBattery, workDay }, onProgress) {
  const palette = ['#0B7A75', '#D97706', '#6D28D9', '#BE185D', '#0369A1', '#15803D', '#B45309', '#7C2D12'];
  const graph = data.graph;
  const depot = data.depot;
  const buildings = data.buildings;

  // Time-budget parameters (fixed internal constants; tune here if needed)
  const AVG_SPEED_KMH = 40;
  const DELIVERY_STOP_MIN = 3;
  const shiftHours = (typeof workDay === 'number' && workDay > 0) ? workDay : 8;
  const shiftMinBudget = shiftHours * 60;

  // Snap depot + every building to nearest road node (one-shot, sync)
  const depotNode = graph.nearestNode(depot.lon, depot.lat);
  onProgress(0.02, `Snapped depot to road node #${depotNode}`);
  await yieldFrame();

  const bNodes = new Array(buildings.length);
  for (let i = 0; i < buildings.length; i++) bNodes[i] = graph.nearestNode(buildings[i].lon, buildings[i].lat);
  onProgress(0.08, `Snapped ${buildings.length.toLocaleString()} buildings to nearest road nodes`);
  await yieldFrame();

  // Dijkstra from depot — gives km-on-road distance to every reachable node
  const { dist: depotDist, prev: depotPrev } = window.dijkstraGraph(graph, depotNode);
  onProgress(0.22, `Dijkstra complete · ${countFinite(depotDist).toLocaleString()} nodes reachable`);
  await yieldFrame();

  // Effective range: need round trip, so 1-way cap = range * SOC/100 / 2 * 0.95
  const effRange = evRange * (startBattery / 100);
  const oneWayCap = effRange * 0.45; // 10% reserve

  // Partition buildings: reachable (within oneWayCap) vs unreachable
  const reachableIdx = [];
  const unreachable = [];
  for (let i = 0; i < buildings.length; i++) {
    const d = depotDist[bNodes[i]];
    if (isFinite(d) && d <= oneWayCap) reachableIdx.push(i);
    else unreachable.push(buildings[i]);
  }
  onProgress(0.3, `${reachableIdx.length.toLocaleString()} reachable, ${unreachable.length.toLocaleString()} out of range`);
  await yieldFrame();

  // Cluster reachable buildings into numEV zones by angle from depot (simple + fast)
  const angleOf = (b) => Math.atan2(b.lat - depot.lat, b.lon - depot.lon);
  const clusters = Array.from({ length: numEV }, () => []);
  for (const idx of reachableIdx) {
    const a = angleOf(buildings[idx]);
    let k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * numEV);
    if (k >= numEV) k = numEV - 1;
    if (k < 0) k = 0;
    clusters[k].push(idx);
  }

  // Balance clusters (rough) — move from biggest to smallest neighbor
  for (let pass = 0; pass < 3; pass++) {
    clusters.sort((a, b) => b.length - a.length);
    if (clusters[0].length - clusters[clusters.length - 1].length < 20) break;
    const extras = clusters[0].splice(Math.floor(clusters[0].length * 0.85));
    clusters[clusters.length - 1].push(...extras);
  }

  onProgress(0.36, `Clustered into ${numEV} service zones by angular sector`);
  await yieldFrame();

  // Per-vehicle routing: greedy nearest-neighbor using depotDist as heuristic,
  // then compute real road paths between consecutive stops via Dijkstra from each visited node.
  // A vehicle stops when it runs out of either (a) range for the round trip or
  // (b) time in the shift (driving + delivery stop time).
  const vehicles = [];
  const timedOutStops = []; // buildings we had to skip because the shift ended
  for (let v = 0; v < numEV; v++) {
    const pool = clusters[v].slice();
    // Sort by depot distance, then greedy NN
    pool.sort((a, b) => depotDist[bNodes[a]] - depotDist[bNodes[b]]);

    const stops = [];
    const routeCoords = []; // full [lon,lat] polyline

    // Start at depot
    let curNode = depotNode;
    let curPos = depot;
    let { dist: curDist, prev: curPrev } = { dist: depotDist, prev: depotPrev };
    let traveled = 0;
    let elapsedMin = 0;   // shift time used so far: driving + stop time

    routeCoords.push([depot.lon, depot.lat]);

    // Greedy: pick nearest from curNode, but ensure return trip feasible
    // AND that we can get back to the depot before the shift ends.
    while (pool.length) {
      let best = -1, bestD = Infinity, bestReturn = 0;
      for (let j = 0; j < pool.length; j++) {
        const bi = pool[j];
        const bn = bNodes[bi];
        const d = curDist[bn];
        if (!isFinite(d)) continue;
        const ret = depotDist[bn]; // distance back to depot via road
        // Range check
        if (traveled + d + ret > effRange * 0.92) continue;
        // Time check: driving (d + ret) at AVG_SPEED + delivery stop
        const driveMinAfter = ((d + ret) / AVG_SPEED_KMH) * 60;
        if (elapsedMin + driveMinAfter + DELIVERY_STOP_MIN > shiftMinBudget) continue;
        if (d < bestD) { bestD = d; best = j; bestReturn = ret; }
      }
      if (best === -1) break;

      const bi = pool.splice(best, 1)[0];
      const bn = bNodes[bi];

      // Path from curNode to bn
      const path = window.reconstructPath(graph, curPrev, bn);
      for (let p = 1; p < path.length; p++) routeCoords.push(path[p]);

      // Snap to actual building location (visual nicety)
      routeCoords.push([buildings[bi].lon, buildings[bi].lat]);
      routeCoords.push([graph.nodes[bn].lon, graph.nodes[bn].lat]);

      stops.push(buildings[bi]);
      traveled += bestD;
      elapsedMin += (bestD / AVG_SPEED_KMH) * 60 + DELIVERY_STOP_MIN;
      curNode = bn;
      curPos = buildings[bi];

      // Recompute Dijkstra from curNode (bounded)
      const res2 = window.dijkstraGraph(graph, curNode, effRange - traveled);
      curDist = res2.dist;
      curPrev = res2.prev;

      if (stops.length % 10 === 0) {
        onProgress(0.4 + 0.45 * (v / numEV), null);
        await yieldFrame();
      }
    }

    // Track what this vehicle couldn't finish due to range/time in its cluster
    for (const bi of pool) timedOutStops.push(buildings[bi]);

    // Return to depot
    const backPath = reconstructFromDepotPrev(graph, depotPrev, curNode);
    for (let p = 1; p < backPath.length; p++) routeCoords.push(backPath[p]);
    traveled += depotDist[curNode] || 0;

    onProgress(0.4 + 0.45 * ((v + 1) / numEV), `  ↳ ${`EV-${String(v + 1).padStart(2, '0')}`}: ${stops.length} stops, ${traveled.toFixed(1)} km`);
    await yieldFrame();

    vehicles.push({
      id: `EV-${String(v + 1).padStart(2, '0')}`,
      color: palette[v % palette.length],
      routeCoords,
      stops,
      distanceKm: traveled,
      endSOC: Math.max(5, startBattery - (traveled / evRange) * 100),
      driveTimeH: ((traveled / AVG_SPEED_KMH) + (stops.length * DELIVERY_STOP_MIN / 60)),
    });
  }

  // Anything in timedOutStops or unassigned-reachable = today's misses
  const assignedIds = new Set();
  vehicles.forEach(v => v.stops.forEach(s => assignedIds.add(s.id)));
  for (const idx of reachableIdx) {
    if (!assignedIds.has(buildings[idx].id)) unreachable.push(buildings[idx]);
  }

  onProgress(0.88, `Total road distance: ${vehicles.reduce((s, v) => s + v.distanceKm, 0).toFixed(1)} km`);
  await yieldFrame();

  // Suggested chargers: farthest-point sampling among unreachable buildings
  const numSites = Math.min(5, Math.max(2, Math.ceil(unreachable.length / 80)));
  const sites = [];
  const namePool = ['Napapiiri Arctic Circle lot', 'Ounasvaara trailhead', 'Saarenkylä Prisma', 'Nivavaara park-and-ride', 'Vikajärvi service area', 'Muurola crossroads', 'Sinettä church lot'];
  const notePool = ['Near tourist hub · high dwell time', 'Residential density · overnight charging', 'Suburban retail · mid-day top-up', 'Commuter node · evening charging', 'Highway layby · fast DC'];
  const powers = ['150 kW DC', '50 kW DC', '22 kW AC', '150 kW DC', '50 kW DC'];
  const km = (a, b) => {
    const dx = (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180);
    const dy = (a.lat - b.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  };
  for (let i = 0; i < numSites; i++) {
    let best = null, bestScore = -Infinity;
    for (const u of unreachable) {
      let s = Math.min(km(u, depot), 50);
      for (const ex of sites) s = Math.min(s, km(u, ex) * 2);
      if (s > bestScore) { bestScore = s; best = u; }
    }
    if (!best) {
      const ang = (i / numSites) * Math.PI * 2;
      best = { lon: depot.lon + Math.cos(ang) * 0.12, lat: depot.lat + Math.sin(ang) * 0.06 };
    }
    const served = unreachable.filter(b => km(best, b) < 3 / 111).length;
    sites.push({
      id: i,
      lon: best.lon,
      lat: best.lat,
      name: namePool[i % namePool.length],
      note: notePool[i % notePool.length],
      score: Math.max(52, 98 - i * 11 - Math.floor(Math.random() * 6)),
      buildingsServed: Math.max(served, 18 - i * 3),
      power: powers[i % powers.length],
    });
  }

  const totalKm = vehicles.reduce((s, v) => s + v.distanceKm, 0);
  const covered = vehicles.reduce((s, v) => s + v.stops.length, 0);
  const avgEndSOC = vehicles.reduce((s, v) => s + v.endSOC, 0) / vehicles.length;
  const co2Saved = totalKm * 0.21;

  return {
    vehicles,
    unreachable,
    suggestedChargers: sites,
    totalKm,
    covered,
    total: buildings.length,
    avgEndSOC,
    co2Saved,
  };
}

function yieldFrame() { return new Promise(r => requestAnimationFrame(() => r())); }
function countFinite(arr) { let n = 0; for (let i = 0; i < arr.length; i++) if (isFinite(arr[i])) n++; return n; }
function reconstructFromDepotPrev(graph, depotPrev, from) {
  // depotPrev was built from Dijkstra FROM depot, so following prev from `from` reaches depot.
  const pts = [];
  let cur = from;
  while (cur !== -1) { pts.push([graph.nodes[cur].lon, graph.nodes[cur].lat]); cur = depotPrev[cur]; }
  return pts; // from -> depot order; caller is appending after a "from" marker so this is correct direction
}

Object.assign(window, {
  TopBar, Sidebar, KPIStrip, SuggestedChargersPanel, TweaksPanel,
  solveOnRoadNetwork,
});
