// GCC MileWise — EV Delivery Routing Platform
// Main React app. Loads MapLibre basemap (Carto Positron), manages analysis state.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// -------- TWEAKS (persisted) --------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentHue": 172,
  "paletteMode": "nordic",
  "showRoads": true,
  "showBuildingsBefore": true,
  "railWidth": 340
}/*EDITMODE-END*/;

// Palettes (route colors) — vary by mode
const PALETTES = {
  nordic:  ['#0B7A75', '#D97706', '#6D28D9', '#BE185D', '#0369A1', '#15803D', '#B45309', '#7C2D12'],
  vibrant: ['#EC4899', '#06B6D4', '#A855F7', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#F97316'],
  mono:    ['#111827', '#374151', '#6B7280', '#9CA3AF', '#4B5563', '#1F2937', '#111827', '#374151'],
};

// ---------------- APP ----------------
function App() {
  const [data, setData] = useState(null);
  const [tweaks, setTweaks] = useState(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Inputs
  const [numEV, setNumEV] = useState(6);
  const [evRange, setEvRange] = useState(220);
  const [startBattery, setStartBattery] = useState(92);

  // Max EVs needed to cover every building — derived from range/battery and the furthest building.
  // Mirrors the solver formula: coverageRadius = (4 + numEV * 1.5) * rangeScale >= maxBuildingDist
  const maxNumEV = useMemo(() => {
    if (!data) return 12;
    const { depot, buildings } = data;
    let maxDist = 0;
    for (const b of buildings) {
      const dx = (b.lon - depot.lon) * 111 * Math.cos(depot.lat * Math.PI / 180);
      const dy = (b.lat - depot.lat) * 111;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    }
    const effRange = evRange * (startBattery / 100);
    const rangeScale = effRange / (220 * 0.92);
    const hoursScale = (workDay > 0 ? workDay : 8) / 8;
    return Math.max(12, Math.ceil((maxDist / (rangeScale * hoursScale) - 4) / 1.5));
  }, [data, evRange, startBattery, workDay]);

  const [depotId, setDepotId] = useState('rovaniemi-main');
  const [workDay, setWorkDay] = useState(8);

  // Analysis state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('idle');
  const [logLines, setLogLines] = useState([]);
  const [result, setResult] = useState(null);

  // Load data (real parquets + boundary)
  const [loadState, setLoadState] = useState({ stage: 'init', msg: 'Initializing…' });
  useEffect(() => {
    (async () => {
      try {
        setLoadState({ stage: 'parquet', msg: 'Reading buildings_rovaniemi.parquet…' });
        const d = await window.loadRealData();
        setLoadState({ stage: 'graph', msg: `Built road graph · ${d.graph.nodes.length.toLocaleString()} nodes` });
        await new Promise(r => setTimeout(r, 200));
        setData(d);
        setLoadState({ stage: 'ready', msg: 'Ready' });
      } catch (e) {
        console.error(e);
        setLoadState({ stage: 'error', msg: String(e.message || e) });
      }
    })();
  }, []);

  // Tweaks protocol
  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const applyTweak = (k, v) => {
    setTweaks(t => ({ ...t, [k]: v }));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*');
  };

  // Run analysis (mock solver with streaming status)
  const runAnalysis = useCallback(async () => {
    if (!data || running) return;
    setRunning(true);
    setProgress(0);
    setLogLines([]);
    setResult(null);

    const push = (msg, level = 'info') => {
      setLogLines(prev => [...prev, { t: new Date(), msg, level }]);
    };
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    setStage('clustering');
    push('Initializing OR-tools VRP solver…');
    await wait(300);
    push(`Reading ${data.buildings.length.toLocaleString()} delivery targets from buildings_rovaniemi.parquet`);
    setProgress(0.06);
    await wait(250);
    push(`Loaded road network: ${data.graph.nodes.length.toLocaleString()} nodes, ${data.roads.length.toLocaleString()} edges`);
    setProgress(0.12);
    await wait(300);
    push('Running Dijkstra from depot across road graph…');
    setProgress(0.18);
    await wait(100);

    // Run real solver
    const res = await solveOnRoadNetwork(data, { numEV, evRange, startBattery, workDay }, (p, msg, level) => {
      setProgress(0.18 + p * 0.7);
      if (msg) push(msg, level);
    });

    setStage('coverage');
    push(`Battery SOC computed · range ${evRange} km @ ${startBattery}% SOC · shift ${workDay} h`);
    setProgress(0.9);
    await wait(200);
    push(`${res.vehicles.reduce((s, v) => s + v.stops.length, 0)} deliveries scheduled, ${res.unreachable.length} out of range`, res.unreachable.length ? 'warn' : 'info');

    setStage('gaps');
    push('Ranking candidate charger sites by coverage gain…');
    await wait(300);
    push(`Suggested ${res.suggestedChargers.length} new charger locations`);
    setProgress(1);
    await wait(150);

    push('Analysis complete.', 'ok');
    setResult(res);
    setStage('done');
    setRunning(false);
  }, [data, running, numEV, evRange, startBattery, workDay]);

  return (
    <div className="app">
      <Sidebar
        data={data}
        numEV={numEV} setNumEV={setNumEV} maxNumEV={maxNumEV}
        evRange={evRange} setEvRange={setEvRange}
        startBattery={startBattery} setStartBattery={setStartBattery}
        depotId={depotId} setDepotId={setDepotId}
        workDay={workDay} setWorkDay={setWorkDay}
        loadState={loadState}
        running={running}
        progress={progress}
        stage={stage}
        logLines={logLines}
        result={result}
        onRun={runAnalysis}
        railWidth={tweaks.railWidth}
      />
      <main className="stage">
        <TopBar result={result} running={running} progress={progress} />
        <MapView data={data} result={result} tweaks={tweaks} running={running} />
        {result && <KPIStrip result={result} />}
        <div className="right-col">
          <MapLegend result={result} />
          {result && <SuggestedChargersPanel chargers={result.suggestedChargers} />}
        </div>
      </main>

      {tweaksOpen && (
        <TweaksPanel tweaks={tweaks} apply={applyTweak} onClose={() => setTweaksOpen(false)} />
      )}
    </div>
  );
}

window.GCCApp = App;
