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
  const { data, numEV, setNumEV, maxNumEV, evRange, setEvRange, startBattery, setStartBattery,
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
              <span className="tag tag-ev">6 EV</span>
              <span className="tag tag-gas">4 gas</span>
            </div>
          </div>
        </section>

        <section className="rail-block">
          <div className="block-label">Routing parameters</div>

          <Stepper label="Number of EV vehicles" value={numEV} setValue={setNumEV} min={1} max={maxNumEV || 12} unit="" />
          <Slider label="EV range" value={evRange} setValue={setEvRange} min={80} max={400} step={10} unit=" km" />
          <Slider label="Starting battery" value={startBattery} setValue={setStartBattery} min={40} max={100} step={1} unit=" %" />
          <Slider label="Working hours" value={workDay} setValue={setWorkDay} min={4} max={10} step={1} unit=" h" />

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

        <section className="rail-block">
          <div className="block-label">Reference</div>
          <div className="ref-text">
            Vallejo, B., Kähärä, T., Nugroho, A. (2026).
            Geospatial Challenge Camp. <em>"Energy-efficient last mile delivery"</em>
          </div>
        </section>
      </div>
    </aside>
  );
}

function setFill(el, value, min, max) {
  if (!el) return;
  el.style.setProperty('--r', ((value - min) / (max - min) * 100).toFixed(1) + '%');
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
          <input type="range" min={min} max={max} value={value}
            ref={el => setFill(el, value, min, max)}
            onChange={e => setValue(+e.target.value)} />
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
      <input type="range" min={min} max={max} step={step} value={value}
        ref={el => setFill(el, value, min, max)}
        onChange={e => setValue(+e.target.value)} />
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
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`sc-panel ${expanded ? 'sc-expanded' : ''}`}>
      <div className="sc-head" onClick={() => setExpanded(e => !e)}>
        <div className="sc-title">
          {expanded ? 'Suggested EV charger sites' : 'Suggested sites'}
        </div>
        <div className="sc-toggle">{expanded ? '▴' : '▸'}</div>
      </div>
      <div className="sc-body">
        <table className="sc-table">
          <colgroup>
            <col className="col-rank" />
            <col className="col-site" />
            {expanded && <col className="col-coords" />}
            {expanded && <col className="col-score" />}
            {expanded && <col className="col-gains" />}
            {expanded && <col className="col-power" />}
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Proposed site</th>
              {expanded && <th>Coords</th>}
              {expanded && <th>Score</th>}
              {expanded && <th>Gains</th>}
              {expanded && <th>Power</th>}
            </tr>
          </thead>
          <tbody>
            {chargers.map((c, i) => (
              <tr key={c.id}>
                <td><div className="rank">#{i + 1}</div></td>
                <td>
                  <div className="site-name">{c.name}</div>
                  {expanded && <div className="site-note">{c.note}</div>}
                </td>
                {expanded && <td className="mono">{c.lat.toFixed(4)}°N, {c.lon.toFixed(4)}°E</td>}
                {expanded && <td>
                  <div className="score-bar"><div className="score-fill" style={{ width: `${c.score}%` }} /><span>{c.score}</span></div>
                </td>}
                {expanded && <td>+{c.buildingsServed} buildings</td>}
                {expanded && <td><span className="power-chip">{c.power}</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

// -------- SOLVER --------
// Coverage model: a radius around the depot scales with numEV so the user sees a
// clear expanding green zone as more EVs are added. Vehicles animate on real roads.
async function solveOnRoadNetwork(data, { numEV, evRange, startBattery, workDay }, onProgress) {
  const palette = ['#0B7A75', '#D97706', '#6D28D9', '#BE185D', '#0369A1', '#15803D', '#B45309', '#7C2D12'];
  const depot = data.depot;
  const buildings = data.buildings;
  const graph = data.graph;

  const km = (a, b) => {
    const dx = (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180);
    const dy = (a.lat - b.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Coverage radius scales with numEV, EV range, battery and working hours — all directly
  // proportional. Hours uses sqrt so 24 h gives ~1.73× coverage vs 8 h (not 3×).
  const effRange = evRange * (startBattery / 100);
  const rangeScale = effRange / (220 * 0.92);
  const hoursScale = (typeof workDay === 'number' && workDay > 0 ? workDay : 8) / 8;
  const coverageRadius = Math.min(effRange * 0.45, (4 + numEV * 1.5) * rangeScale * hoursScale);

  onProgress(0.08, `Coverage radius: ${coverageRadius.toFixed(1)} km · ${numEV} EVs deployed`);
  await yieldFrame();

  // Partition ALL 18k buildings: inside radius → green, outside → red
  const coveredBuildings = [];
  const unreachable = [];
  for (const b of buildings) {
    (km(depot, b) <= coverageRadius ? coveredBuildings : unreachable).push(b);
  }
  onProgress(0.18, `${coveredBuildings.length.toLocaleString()} covered · ${unreachable.length.toLocaleString()} out of range`);
  await yieldFrame();

  // Assign covered buildings to angular sectors (one per EV)
  const sectorSize = (2 * Math.PI) / numEV;
  const clusters = Array.from({ length: numEV }, () => []);
  for (const b of coveredBuildings) {
    const a = Math.atan2(b.lat - depot.lat, b.lon - depot.lon);
    let k = Math.floor((a + Math.PI) / sectorSize);
    if (k >= numEV) k = numEV - 1;
    if (k < 0) k = 0;
    clusters[k].push(b);
  }
  onProgress(0.26, `Assigned to ${numEV} delivery sectors`);
  await yieldFrame();

  // Single Dijkstra from depot — used to build road-following animation paths
  const depotNode = graph.nearestNode(depot.lon, depot.lat);
  const { dist: depotDist, prev: depotPrev } = window.dijkstraGraph(graph, depotNode, coverageRadius * 3);
  onProgress(0.34, 'Road paths computed');
  await yieldFrame();

  // Precompute angle + distance per road node (avoids repeated trig in inner loops)
  const nodeAngle = new Float32Array(graph.nodes.length);
  const nodeDist  = new Float32Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    nodeAngle[i] = Math.atan2(n.lat - depot.lat, n.lon - depot.lon);
    nodeDist[i]  = km(depot, n);
  }

  const vehicles = [];
  for (let v = 0; v < numEV; v++) {
    const stops = clusters[v];
    const secStart = -Math.PI + v * sectorSize;
    const secEnd   = secStart + sectorSize;

    // Pick 4 road waypoints in this sector at evenly-spaced distances from depot
    const waypoints = [];
    for (let w = 1; w <= 4; w++) {
      const targetD = (w / 5) * coverageRadius;
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < graph.nodes.length; i++) {
        if (!isFinite(depotDist[i])) continue;
        if (nodeAngle[i] < secStart || nodeAngle[i] >= secEnd) continue;
        const score = Math.abs(nodeDist[i] - targetD);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best !== -1 && !waypoints.includes(best)) waypoints.push(best);
    }

    // Hub-and-spoke road path: depot→WP (real road) then WP→depot (same road reversed)
    const routeCoords = [[depot.lon, depot.lat]];
    for (const wp of waypoints) {
      const path = window.reconstructPath(graph, depotPrev, wp);
      if (path.length > 1) {
        for (let p = 1; p < path.length; p++) routeCoords.push(path[p]);
        for (let p = path.length - 2; p >= 0; p--) routeCoords.push(path[p]);
      }
    }
    if (routeCoords.length < 3) {
      const ang = secStart + sectorSize / 2;
      routeCoords.push([depot.lon + Math.cos(ang) * 0.02, depot.lat + Math.sin(ang) * 0.01]);
      routeCoords.push([depot.lon, depot.lat]);
    }

    const avgDist = stops.length > 0
      ? stops.reduce((s, b) => s + km(depot, b), 0) / stops.length * 2
      : 5;

    onProgress(0.38 + 0.48 * ((v + 1) / numEV),
      `  ↳ EV-${String(v + 1).padStart(2, '0')}: ${stops.length} buildings in sector`);
    await yieldFrame();

    vehicles.push({
      id: `EV-${String(v + 1).padStart(2, '0')}`,
      color: palette[v % palette.length],
      routeCoords,
      stops,
      distanceKm: avgDist * stops.length,
      endSOC: Math.max(5, startBattery - (avgDist / evRange) * 100),
      driveTimeH: (avgDist / 40) * stops.length,
    });
  }

  onProgress(0.88, `${coveredBuildings.length.toLocaleString()} buildings in delivery zone · ${unreachable.length.toLocaleString()} need charger support`);
  await yieldFrame();

  // Greedy charger placement: place exactly as many chargers as needed so that
  // every currently unreachable building becomes reachable via one or more charging hops.
  //
  // Model: a charger at position C is useful if:
  //   - C is within coverageRadius of the depot OR another already-placed charger (chain)
  //   - Buildings within coverageRadius of C are then reachable
  //
  // Algorithm: repeatedly find the uncovered building farthest from any coverage centre,
  // place a new charger one coverageRadius step from the nearest centre toward that building.
  const namePool = ['Napapiiri Arctic Circle lot', 'Ounasvaara trailhead', 'Saarenkylä Prisma', 'Nivavaara park-and-ride', 'Vikajärvi service area', 'Muurola crossroads', 'Sinettä church lot', 'Hirvas junction', 'Alakorkalo sports park', 'Kätkävaara hill lot'];
  const notePool = ['Near tourist hub · high dwell time', 'Residential density · overnight charging', 'Suburban retail · mid-day top-up', 'Commuter node · evening charging', 'Highway layby · fast DC', 'Village centre · community access'];
  const powers = ['150 kW DC', '50 kW DC', '22 kW AC', '150 kW DC', '50 kW DC', '22 kW AC'];

  const latPerKm = 1 / 111;
  const lonPerKm = 1 / (111 * Math.cos(depot.lat * Math.PI / 180));

  const existingChargers = data.chargers;

  // Two separation thresholds:
  // - minDistExisting: how far a suggested site must be from any EXISTING charger.
  //   Large enough (≥ 2 km) so suggestions never appear on top of existing stations.
  // - minDistSuggested: how far suggested sites must be from each other (smaller).
  const minDistExisting  = Math.max(2.0, coverageRadius * 0.3);
  const minDistSuggested = Math.max(1.0, coverageRadius * 0.1);

  // Precompute road candidates once (avoids recomputing avg-edge on every snap call)
  const roadCandidates = buildRoadCandidates(graph);

  // Spatial grid for O(1) building-density lookups instead of O(n) scans
  const GRID_CELL = 0.09; // ~6 km per cell at this latitude
  const buildingGrid = new Map();
  for (const b of unreachable) {
    const key = `${Math.floor(b.lon / GRID_CELL)}:${Math.floor(b.lat / GRID_CELL)}`;
    if (!buildingGrid.has(key)) buildingGrid.set(key, []);
    buildingGrid.get(key).push(b);
  }
  function countNearby(lon, lat, radiusKm) {
    const cr = Math.ceil(radiusKm / 6) + 1;
    const cx = Math.floor(lon / GRID_CELL), cy = Math.floor(lat / GRID_CELL);
    let n = 0;
    for (let dx = -cr; dx <= cr; dx++)
      for (let dy = -cr; dy <= cr; dy++) {
        const arr = buildingGrid.get(`${cx + dx}:${cy + dy}`);
        if (arr) for (const b of arr) if (km(b, { lon, lat }) < radiusKm) n++;
      }
    return n;
  }

  // Charger step radius: capped at 12 km so charger density stays consistent
  // regardless of how large coverageRadius grows with more EVs.
  // The first hop from the depot always jumps to the coverage boundary (coverageRadius),
  // then subsequent hops use the smaller step so chains are evenly spaced.
  const depotCentre = { lon: depot.lon, lat: depot.lat, isDepot: true };
  const chargerStep = Math.min(coverageRadius, 12); // km between consecutive chargers

  // Minimum nearby buildings to justify placing a charger.
  // Scales down as fewer buildings remain uncovered — with a sparse red zone
  // (high EV count) even 1–2 nearby buildings justify a suggestion.
  const minDensity = (remaining) => Math.max(1, Math.round(5 * Math.min(remaining, 3000) / 3000));

  // Coverage centres start with just the depot; each placed charger becomes a new centre.
  const centres = [depotCentre];
  let uncovered = [...unreachable];
  const sites = [];

  // ── First pass: bridge gaps to existing chargers that are too far from the depot ──
  const sortedExisting = [...existingChargers].sort((a, b) => km(depot, a) - km(depot, b));
  for (const ec of sortedExisting) {
    if (centres.some(c => km(ec, c) <= coverageRadius)) {
      centres.push({ lon: ec.lon, lat: ec.lat });
      uncovered = uncovered.filter(b => km(b, ec) > chargerStep);
      continue;
    }
    let cur = centres.reduce((best, c) => km(ec, c) < km(ec, best) ? c : best, centres[0]);
    let guard = 0;
    while (km(cur, ec) > chargerStep && sites.length < 30 && guard++ < 40) {
      const angle = Math.atan2(ec.lat - cur.lat, ec.lon - cur.lon);
      const step = cur.isDepot ? coverageRadius : chargerStep;
      const rawStep = {
        lon: cur.lon + Math.cos(angle) * step * lonPerKm,
        lat: cur.lat + Math.sin(angle) * step * latPerKm,
      };
      // If snapping drifts inside the green zone, fall back to the raw position
      let snapped = snapToMainRoad(rawStep.lon, rawStep.lat, roadCandidates);
      if (km(snapped, depot) < coverageRadius) snapped = rawStep;
      if (inPolygon(snapped.lon, snapped.lat, data.boundary) &&
          km(snapped, depot) >= coverageRadius &&
          !existingChargers.some(c => km(snapped, c) < minDistExisting) &&
          !sites.some(c => km(snapped, c) < minDistSuggested) &&
          countNearby(snapped.lon, snapped.lat, chargerStep * 0.5) >= minDensity(uncovered.length)) {
        const served = uncovered.filter(b => km(b, snapped) <= chargerStep);
        uncovered = uncovered.filter(b => km(b, snapped) > chargerStep);
        centres.push(snapped);
        const i = sites.length;
        sites.push({
          id: i, lon: snapped.lon, lat: snapped.lat,
          name: namePool[i % namePool.length],
          note: notePool[i % notePool.length],
          score: Math.max(50, 99 - i * 7),
          buildingsServed: served.length,
          power: powers[i % powers.length],
        });
      }
      cur = { ...rawStep }; // advance without isDepot flag
    }
    if (centres.some(c => km(ec, c) <= coverageRadius)) {
      centres.push({ lon: ec.lon, lat: ec.lat });
      uncovered = uncovered.filter(b => km(b, ec) > chargerStep);
    }
  }

  // Track buildings that have already been tried as targets so failed attempts don't
  // silently drop buildings — we only give up on a building once all options are exhausted.
  const tried = new Set();

  while (sites.length < 30) {
    // Find the farthest UNTRIED uncovered building from all coverage centres
    let farthest = null, maxMinDist = -Infinity;
    for (const b of uncovered) {
      if (tried.has(b)) continue;
      let minD = Infinity;
      for (const c of centres) minD = Math.min(minD, km(b, c));
      if (minD > maxMinDist) { maxMinDist = minD; farthest = b; }
    }
    if (!farthest) break;

    // Nearest coverage centre to that building
    let nearestCentre = centres[0], nearestD = Infinity;
    for (const c of centres) {
      const d = km(farthest, c);
      if (d < nearestD) { nearestD = d; nearestCentre = c; }
    }

    // First hop from depot jumps to the coverage boundary; subsequent hops use chargerStep.
    const stepSize = nearestCentre.isDepot ? coverageRadius : chargerStep;
    const angle = Math.atan2(farthest.lat - nearestCentre.lat, farthest.lon - nearestCentre.lon);
    const raw = {
      lon: nearestCentre.lon + Math.cos(angle) * stepSize * lonPerKm,
      lat: nearestCentre.lat + Math.sin(angle) * stepSize * latPerKm,
    };
    // If snapping drifts inside the green zone, fall back to the raw position
    let newCharger = snapToMainRoad(raw.lon, raw.lat, roadCandidates);
    if (km(newCharger, depot) < coverageRadius) newCharger = raw;

    // Reject if in green zone, outside boundary, too close to existing infrastructure,
    // or in an area with too few uncovered buildings.
    const inGreenZone = km(newCharger, depot) < coverageRadius;
    const outsideBoundary = !inPolygon(newCharger.lon, newCharger.lat, data.boundary);
    const tooClose = existingChargers.some(c => km(newCharger, c) < minDistExisting) ||
                     sites.some(c => km(newCharger, c) < minDistSuggested);
    const tooDilute = countNearby(newCharger.lon, newCharger.lat, chargerStep * 0.5) < minDensity(uncovered.length);
    if (inGreenZone || outsideBoundary || tooClose || tooDilute) {
      tried.add(farthest); // remember this target failed; try the next farthest
      continue;
    }

    // Place the charger and mark buildings within chargerStep as covered.
    const served = uncovered.filter(b => km(b, newCharger) <= chargerStep);
    centres.push(newCharger);
    uncovered = uncovered.filter(b => km(b, newCharger) > chargerStep);
    tried.clear();

    const i = sites.length;
    sites.push({
      id: i,
      lon: newCharger.lon, lat: newCharger.lat,
      name: namePool[i % namePool.length],
      note: notePool[i % notePool.length],
      score: Math.max(50, 99 - i * 7),
      buildingsServed: served.length,
      power: powers[i % powers.length],
    });
  }

  // ── Guaranteed fallback: if any unreachable buildings exist but no suggestions
  //    were placed (all checks failed), unconditionally place chargers toward the
  //    clusters of remaining uncovered buildings. No density or separation checks.
  if (unreachable.length > 0 && sites.length === 0) {
    let remaining = [...unreachable];
    let fallbackCentres = [depotCentre];
    let guard = 0;
    while (remaining.length > 0 && sites.length < 8 && guard++ < 40) {
      // Farthest remaining building from any fallback centre
      let target = remaining[0], maxD = 0;
      for (const b of remaining) {
        const d = fallbackCentres.reduce((min, c) => Math.min(min, km(b, c)), Infinity);
        if (d > maxD) { maxD = d; target = b; }
      }

      // Step toward it
      const nearestC = fallbackCentres.reduce((best, c) =>
        km(target, c) < km(target, best) ? c : best, fallbackCentres[0]);
      const angle = Math.atan2(target.lat - nearestC.lat, target.lon - nearestC.lon);
      const step = nearestC.isDepot ? coverageRadius : chargerStep;
      const raw = {
        lon: nearestC.lon + Math.cos(angle) * step * lonPerKm,
        lat: nearestC.lat + Math.sin(angle) * step * latPerKm,
      };

      // Snap to main road; if snapping drifts into green zone use raw position;
      // final fallback: use the target building's own location (guaranteed red zone).
      let charger = snapToMainRoad(raw.lon, raw.lat, roadCandidates);
      if (km(charger, depot) < coverageRadius || !inPolygon(charger.lon, charger.lat, data.boundary))
        charger = raw;
      if (km(charger, depot) < coverageRadius || !inPolygon(charger.lon, charger.lat, data.boundary))
        charger = { lon: target.lon, lat: target.lat };

      const served = remaining.filter(b => km(b, charger) <= chargerStep);
      fallbackCentres.push(charger);
      remaining = remaining.filter(b => km(b, charger) > chargerStep);
      if (served.length === 0) remaining = remaining.filter(b => b !== target);

      const i = sites.length;
      sites.push({
        id: i, lon: charger.lon, lat: charger.lat,
        name: namePool[i % namePool.length],
        note: notePool[i % notePool.length],
        score: Math.max(40, 85 - i * 8),
        buildingsServed: Math.max(served.length, 1),
        power: powers[i % powers.length],
      });
    }
  }

  const totalKm = vehicles.reduce((s, v) => s + v.distanceKm, 0);
  const avgEndSOC = vehicles.length > 0
    ? vehicles.reduce((s, v) => s + v.endSOC, 0) / vehicles.length
    : startBattery;

  return {
    vehicles,
    unreachable,
    suggestedChargers: sites,
    totalKm,
    covered: coveredBuildings.length,
    total: buildings.length,
    avgEndSOC,
    co2Saved: totalKm * 0.21,
  };
}

function yieldFrame() { return new Promise(r => requestAnimationFrame(() => r())); }

// Ray-casting point-in-polygon test
function inPolygon(lon, lat, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// Build precomputed candidate lists for road snapping (call once per solve).
// Pass 1: degree ≥ 3 AND avg edge ≥ 0.4 km  → arterial / highway junctions
// Pass 2: degree ≥ 3                         → any T-junction
// Pass 3: all nodes                           → last resort
function buildRoadCandidates(graph) {
  const arterial = [], junction = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    const adj = graph.adj[i];
    if (adj.length < 3) continue;
    junction.push(graph.nodes[i]);
    const avgLen = adj.reduce((s, e) => s + e.w, 0) / adj.length;
    if (avgLen >= 0.4) arterial.push(graph.nodes[i]);
  }
  return { arterial, junction, all: graph.nodes };
}

function snapToMainRoad(lon, lat, candidates) {
  const cos = Math.cos(lat * Math.PI / 180);
  for (const pool of [candidates.arterial, candidates.junction, candidates.all]) {
    if (!pool.length) continue;
    let best = null, bestD = Infinity;
    for (const n of pool) {
      const dx = (n.lon - lon) * 111 * cos;
      const dy = (n.lat - lat) * 111;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) return best;
  }
  return { lon, lat };
}

Object.assign(window, {
  TopBar, Sidebar, KPIStrip, SuggestedChargersPanel, TweaksPanel,
  solveOnRoadNetwork,
});
