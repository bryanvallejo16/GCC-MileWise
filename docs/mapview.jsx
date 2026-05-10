// MapView — MapLibre GL JS wrapper
const { useEffect, useRef, useState } = React;

function MapView({ data, result, tweaks, running }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const animRef = useRef({ raf: null, t0: 0 });

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      },
      center: [25.72, 66.50],
      zoom: 10.6,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.on('load', () => {
      mapRef.current = map;
      setReady(true);
    });
  }, []);

  // Push data sources + layers once data is loaded
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !data) return;

    // road network overlay
    if (!map.getSource('roads')) {
      map.addSource('roads', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: (data.roads || []).map((line, i) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: line },
            properties: { id: i },
          })),
        },
      });
      map.addLayer({
        id: 'roads-line',
        type: 'line',
        source: 'roads',
        paint: { 'line-color': '#94A3B8', 'line-width': 0.6, 'line-opacity': 0.35 },
      });
    }

    // boundary
    if (!map.getSource('boundary')) {
      map.addSource('boundary', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [data.boundary] },
          properties: {},
        },
      });
      map.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary',
        paint: { 'fill-color': '#0B7A75', 'fill-opacity': 0.04 },
      });
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': '#0B7A75', 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.6 },
      });
    }

    // buildings
    if (!map.getSource('buildings')) {
      map.addSource('buildings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'buildings-circle',
        type: 'circle',
        source: 'buildings',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3, 16, 5],
          'circle-color': ['case', ['==', ['get', 'state'], 'unreachable'], '#DC2626', ['==', ['get', 'state'], 'covered'], '#15803D', '#94A3B8'],
          'circle-opacity': ['case', ['==', ['get', 'state'], 'unreachable'], 0.95, 0.82],
          'circle-stroke-width': ['case', ['==', ['get', 'state'], 'unreachable'], 1.2, 0.4],
          'circle-stroke-color': ['case', ['==', ['get', 'state'], 'unreachable'], '#7F1D1D', '#FFFFFF'],
        },
      });
    }

    // routes source kept for data updates; layers removed per user request
    if (!map.getSource('routes')) {
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    // existing chargers
    if (!map.getSource('chargers')) {
      map.addSource('chargers', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: data.chargers.map(c => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
            properties: { kind: 'existing' },
          })),
        },
      });
      map.addLayer({
        id: 'chargers-existing',
        type: 'circle',
        source: 'chargers',
        paint: {
          'circle-radius': 5,
          'circle-color': '#0EA5E9',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    // suggested chargers
    if (!map.getSource('suggested')) {
      map.addSource('suggested', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'suggested-pulse',
        type: 'circle',
        source: 'suggested',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'pulse'], 0, 8, 1, 28],
          'circle-color': '#D97706',
          'circle-opacity': ['interpolate', ['linear'], ['get', 'pulse'], 0, 0.45, 1, 0],
        },
      });
      map.addLayer({
        id: 'suggested-core',
        type: 'circle',
        source: 'suggested',
        paint: {
          'circle-radius': 7,
          'circle-color': '#D97706',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    // depot
    if (!map.getSource('depot')) {
      map.addSource('depot', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [data.depot.lon, data.depot.lat] },
          properties: { name: data.depot.name },
        },
      });
      map.addLayer({
        id: 'depot-halo',
        type: 'circle',
        source: 'depot',
        paint: { 'circle-radius': 16, 'circle-color': '#0B7A75', 'circle-opacity': 0.12 },
      });
      map.addLayer({
        id: 'depot-dot',
        type: 'circle',
        source: 'depot',
        paint: { 'circle-radius': 7, 'circle-color': '#0B7A75', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' },
      });
    }

    // vehicle markers (animated)
    if (!map.getSource('vehicles')) {
      map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'vehicles-halo',
        type: 'circle',
        source: 'vehicles',
        paint: { 'circle-radius': 12, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 },
      });
      map.addLayer({
        id: 'vehicles-dot',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
  }, [ready, data]);

  // Toggle roads overlay based on tweaks
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer('roads-line')) {
      map.setLayoutProperty('roads-line', 'visibility', tweaks.showRoads ? 'visible' : 'none');
    }
  }, [tweaks.showRoads, ready]);

  // Update buildings layer based on pre/post run
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !data) return;
    const src = map.getSource('buildings');
    if (!src) return;

    if (!result) {
      // show placeholder buildings (before run)
      if (!tweaks.showBuildingsBefore) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      src.setData({
        type: 'FeatureCollection',
        features: data.buildings.map(b => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
          properties: { state: 'pending', color: '#94A3B8' },
        })),
      });
      return;
    }

    // post-run: green = covered, red = unreachable
    const unreachIds = new Set(result.unreachable.map(b => b.id));

    src.setData({
      type: 'FeatureCollection',
      features: data.buildings.map(b => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
        properties: { state: unreachIds.has(b.id) ? 'unreachable' : 'covered' },
      })),
    });
  }, [result, ready, data, tweaks.showBuildingsBefore]);

  // Update routes + suggested + fit after result
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !result) return;

    const routeSrc = map.getSource('routes');
    if (routeSrc) {
      routeSrc.setData({
        type: 'FeatureCollection',
        features: result.vehicles.map(v => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: v.routeCoords },
          properties: { color: v.color, id: v.id },
        })),
      });
    }

    const sugSrc = map.getSource('suggested');
    if (sugSrc) {
      sugSrc.setData({
        type: 'FeatureCollection',
        features: result.suggestedChargers.map(c => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: { pulse: 0, name: c.name },
        })),
      });
    }

    // fit bounds
    const bounds = new maplibregl.LngLatBounds();
    result.vehicles.forEach(v => v.routeCoords.forEach(p => bounds.extend(p)));
    result.suggestedChargers.forEach(c => bounds.extend([c.lon, c.lat]));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: { top: 80, bottom: 240, left: 40, right: 380 }, duration: 900, maxZoom: 12.5 });
    }
  }, [result, ready]);

  // Pulse suggested charger markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !result) return;
    const sugSrc = map.getSource('suggested');
    if (!sugSrc) return;
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      const t = (now - t0) / 1000;
      const pulse = (Math.sin(t * 1.8) + 1) / 2;
      sugSrc.setData({
        type: 'FeatureCollection',
        features: result.suggestedChargers.map(c => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: { pulse, name: c.name },
        })),
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [result, ready]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {!result && !running && (
        <div className="map-empty">
          <div className="map-empty-card">
            <div className="eyebrow">Ready to plan</div>
            <div className="map-empty-title">Configure parameters, then Run Analysis</div>
            <div className="map-empty-sub">{data ? `${data.buildings.length.toLocaleString()} delivery targets · ${data.chargers.length} existing chargers · Rovaniemi municipality` : 'Loading data…'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function MapLegend({ result }) {
  return (
    <div className="legend">
      <div className="legend-title">Legend</div>
      <div className="legend-row"><span className="dot depot" /> Depot</div>
      <div className="legend-row"><span className="dot existing" /> Existing charger</div>
      <div className="legend-row"><span className="dot suggested pulse" /> Suggested site</div>
      <div className="legend-row"><span className="dot" style={{ background: '#15803D' }} /> Delivered building</div>
      <div className="legend-row"><span className="dot unreachable" /> Unreachable (out of range)</div>
      {result && (
        <>
          <div className="legend-divider" />
          <div className="legend-title small">Coverage</div>
          <div className="legend-row">
            <span>{result.vehicles.length} EVs · {result.covered.toLocaleString()} buildings covered</span>
          </div>
        </>
      )}
    </div>
  );
}

window.MapView = MapView;
window.MapLegend = MapLegend;
