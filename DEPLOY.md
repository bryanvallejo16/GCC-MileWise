# GCC MileWise — Deployment Guide

One-page React app that computes EV delivery routes for Rovaniemi
entirely in the browser. No backend, no build step — just static files.

## What's in the box

```
gcc-milewise/
├── prepare_data.py           ← one-time data converter (Python)
├── raw/                      ← your raw inputs (parquets, CSVs, geojson)
├── DEPLOY.md
├── .gitignore
└── docs/                     ← GitHub Pages serves from here
    ├── index.html            ← entry point
    ├── app.jsx               ← main React component
    ├── components.jsx        ← UI + routing solver
    ├── mapview.jsx           ← MapLibre map
    ├── dataloader.jsx        ← fetches GeoJSON, builds road graph
    ├── styles.css
    ├── data.json             ← depot + chargers + boundary
    └── data/
        ├── buildings.geojson (~1.9 MB, 18k points)
        └── roads.geojson     (~3.1 MB, 10k LineStrings)
```

Total served weight: **~5 MB**. All well within GitHub Pages limits.

## Architecture at a glance

- **Python runs once, offline.** `prepare_data.py` reads the parquets
  and CSVs and produces the static GeoJSON files in `docs/data/`.
- **Everything else is in the browser.** The React app fetches the
  GeoJSON, builds a routing graph in memory, and runs Dijkstra on it
  whenever the user clicks "Run analysis."
- **No server.** GitHub Pages just serves static files.

## Step 1 — Generate the data files (once)

From the repo root:

```bash
pip install geopandas pandas pyarrow shapely
python prepare_data.py
```

This reads `raw/*` and writes `docs/data.json` + `docs/data/*.geojson`.

You only need to re-run this if the raw inputs change. The generated
files are committed to the repo so that GitHub Pages can serve them.

## Step 2 — Test locally

You cannot just double-click `index.html` — browsers block `fetch()` on
`file://` URLs. Use a tiny local server:

```bash
cd docs
python3 -m http.server 8000
```

Open **http://localhost:8000/** in Chrome, Edge, or Firefox.

Expected behavior:
- Sidebar briefly shows loading steps, then "Ready".
- Map centers on Rovaniemi with the depot marker.
- Clicking "Run analysis" computes routes in 5–15 seconds.

If anything errors, open DevTools (F12) → Console.

## Step 3 — Push to GitHub

```bash
cd <gcc-milewise root>
git init
git add .
git commit -m "GCC MileWise: initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USER/gcc-milewise.git
git push -u origin main
```

## Step 4 — Enable GitHub Pages

1. Go to your repo on github.com → **Settings** → **Pages**
2. Under "Build and deployment":
   - **Source**: Deploy from a branch
   - **Branch**: `main`, **Folder**: `/docs`
3. Click **Save**
4. Wait ~1 minute — a green banner will show your live URL.
5. Visit `https://YOUR_USER.github.io/gcc-milewise/`

Every `git push` updates the live site in about a minute.

## Changing defaults

Users interact via sliders. If you want to change the initial values,
edit `app.jsx` near the top:

```js
const [numEV, setNumEV] = useState(6);
const [evRange, setEvRange] = useState(220);
const [startBattery, setStartBattery] = useState(92);
const [workDay, setWorkDay] = useState(8);
```

Internal solver constants live in `components.jsx` inside
`solveOnRoadNetwork`:

```js
const AVG_SPEED_KMH = 40;
const DELIVERY_STOP_MIN = 3;
```

## Troubleshooting

### "data.json failed to load (404)"

Your `docs/data/` folder is incomplete. Re-run `python prepare_data.py`.

### Map loads but "Run analysis" crashes

Check the Console. Most likely an edge case in the solver with your
particular slider values. Lower `numEV` or raise `evRange` to see if it
clears.

### "Cannot read properties of undefined (reading 'appendChild')"

WSL-specific WebGL issue. Use a regular browser outside WSL, or enable
hardware acceleration. Not a problem on GitHub Pages (the issue is the
viewer's browser, not the host).

### Blank page, Console says "GCCApp is not defined"

One of the JSX files failed to load. Check Network tab for 404s.

## What the app computes

For the parameters you set:
- Snaps depot + every building to the nearest road-network node.
- Runs Dijkstra from the depot on the road graph.
- Drops buildings beyond one-way range as "unreachable."
- Splits reachable buildings into angular sectors, one per EV.
- Greedily picks the nearest unvisited stop per vehicle that fits both
  the remaining range AND remaining shift time.
- Buildings not served are flagged red.
- Suggests new charger sites via farthest-point sampling of the red set.

Everything runs in the browser. First run is ~5–15 seconds (road graph
has to build); subsequent runs with different sliders are ~1–3 seconds.
