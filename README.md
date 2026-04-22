# EV Delivery Routing — Rovaniemi

One-day EV delivery routing for the Rovaniemi municipality with an animated
MapLibre web front-end.

## What it does

1. Loads buildings, depot, charging stations, and the Rovaniemi road network.
2. Assigns buildings to 5 EVs using geographically balanced KMeans clustering.
3. Routes each vehicle greedily with battery range + shift-time constraints,
   detouring to chargers when needed.
4. Marks buildings the fleet couldn't reach during a 12-hour shift.
5. Suggests new charger locations (cluster centroids of missed buildings
   that are far from any existing charger).
6. Renders everything in a single standalone HTML file using MapLibre GL JS,
   with animated vehicles, a scenario selector, time slider, layer panel,
   legend, and live stats.

## Project layout

```
ev_routing_rovaniemi/
├── data/
│   ├── buildings_rovaniemi.parquet
│   ├── ev_charging_rovaniemi.csv
│   ├── facilities_vehicles_available.csv
│   ├── rovaniemi_kunta.geojson
│   ├── road_network_rovaniemi.parquet
│   └── road_graph.pkl            (generated on first run — cached)
├── output/
│   ├── routing_map.html          (the deliverable — upload this anywhere)
│   └── summary.json              (per-scenario statistics)
├── run_routing.py
├── requirements.txt
└── README.md
```

## Installation

The deps are mostly geospatial (geopandas, shapely, networkx). keplergl is
**not** required.

```bash
pip install -r requirements.txt
```

If `pip install` gives you build errors on Windows, use conda for the
geospatial stack:

```bash
conda install -c conda-forge geopandas pandas numpy networkx scikit-learn shapely pyarrow
```

## Run it

```bash
python run_routing.py
```

First run takes ~5 seconds longer because it builds and caches the road
graph. Subsequent runs are ~10-20 seconds total for all three scenarios.

Then open `output/routing_map.html` in any browser. That's it.

## Editing scenarios

Near the top of `run_routing.py`:

```python
SCENARIOS: list[Scenario] = [
    Scenario(name="Baseline",     n_vehicles=5, range_km=100, shift_hours=12),
    Scenario(name="Longer shift", n_vehicles=5, range_km=100, shift_hours=16),
    Scenario(name="Bigger range", n_vehicles=5, range_km=150, shift_hours=12),
]
```

Each `Scenario` takes:

| Parameter           | Default | Meaning                                |
|---------------------|---------|----------------------------------------|
| `n_vehicles`        | 5       | Number of EVs dispatched from the depot|
| `range_km`          | 100     | Battery range on a full charge         |
| `shift_hours`       | 12      | Length of the working day              |
| `avg_speed_kmh`     | 40      | Average driving speed                  |
| `delivery_stop_min` | 3       | Time spent per building stop           |
| `charging_stop_min` | 45      | Time spent per charger visit           |
| `buildings_sample`  | 1000    | One-day workload (None = all 18,045)   |
| `random_seed`       | 42      | Reproducibility                        |

## Deploying online

`routing_map.html` is fully self-contained (~2 MB with all 3 scenarios).
MapLibre and CartoDB basemap tiles load from CDNs. Any static host works:

- **GitHub Pages:** commit the HTML to a repo, enable Pages.
- **Netlify:** drag-and-drop the HTML onto their dashboard.
- **Any static server:** upload and open.

## How the algorithm decides charging

For each delivery step:

1. Pick the nearest unvisited assigned building by straight-line distance,
   then verify the exact road-network distance with Dijkstra.
2. If that distance exceeds the remaining battery, route to the nearest
   charger first, recharge (time cost), continue.
3. Before committing, check the shift clock — if the delivery + drive
   can't fit before the 12-hour cutoff, stop the vehicle.
4. If a building is unreachable even from the best charger (too far from
   any existing infrastructure), mark it as missed and move on.

Missed buildings surface in red on the map. Suggested charger locations
(orange stars) are KMeans centroids of missed buildings >30 km from any
existing charger, snapped to the nearest road node.

## Known limitations (class-project scope)

- Greedy nearest-neighbor is not optimal. A proper VRP solver (OR-Tools)
  would reduce total distance ~20–40%.
- The "suggest new chargers" step uses cluster centroids, not set-cover
  optimization. Works for demonstrating the gap, not for production siting.
- Charger capacity (throughput) is not modeled — we assume no queuing.
- All vehicles start simultaneously at t=0 and animate in parallel on the
  map.
