# GCC MileWise — Deployment Guide

A browser-based EV fleet planning tool for Rovaniemi municipality. No backend, no build step — just static files served from the `docs/` folder.

---

## Repository structure

```
GCC-MileWise/
├── README.md
├── DEPLOY.md
├── prepare_data.py           ← one-time data pre-processing (Python)
├── requirements.txt
├── raw/                      ← raw source data (parquets, CSVs, GeoJSON)
└── docs/                     ← everything GitHub Pages serves
    ├── index.html            ← entry point
    ├── app.jsx               ← main React app + state
    ├── components.jsx        ← UI components + routing solver
    ├── mapview.jsx           ← MapLibre GL map wrapper
    ├── dataloader.jsx        ← fetches GeoJSON, builds road graph
    ├── styles.css
    ├── data.json             ← depot location + existing chargers + boundary
    └── data/
        ├── buildings.geojson   (~1.9 MB, 18 k building points)
        └── roads.geojson       (~3.1 MB, 10 k road LineStrings)
```

Total served weight: **~5 MB** — well within GitHub Pages limits.

---

## How it works (technical summary)

- **Python runs once, offline.** `prepare_data.py` reads the raw parquet and CSV files and produces the static GeoJSON files in `docs/data/`.
- **Everything else runs in the browser.** The React app fetches the GeoJSON, builds an in-memory road graph, and runs the coverage and charger-suggestion algorithm whenever the user clicks *Run Analysis*.
- **No server required.** GitHub Pages serves only static files.

---

## Step 1 — Generate the data files (one time only)

```bash
pip install -r requirements.txt
python prepare_data.py
```

This reads `raw/*` and writes `docs/data.json` and `docs/data/*.geojson`.

Only needs to be re-run if the raw source data changes. The generated files are committed to the repo so GitHub Pages can serve them without any server-side processing.

---

## Step 2 — Run locally

Browsers block `fetch()` on `file://` URLs, so you must use a local server:

```bash
python -m http.server 8080 --directory docs
```

Then open **http://localhost:8080** in Chrome, Edge, or Firefox.

**Expected behaviour:**
- Sidebar shows "Loading data…" briefly, then "Ready".
- Map centres on Rovaniemi with the depot marker visible.
- Adjust the sliders and click **Run Analysis** — results appear in 3–10 seconds.
- Green buildings = reachable by the configured fleet.
- Red buildings = outside current coverage (need more EVs or chargers).
- Orange markers = suggested new charging stations.

---

## Step 3 — Push to GitHub

```bash
git add .
git commit -m "GCC MileWise"
git branch -M main
git remote add origin https://github.com/YOUR_USER/GCC-MileWise.git
git push -u origin main
```

---

## Step 4 — Enable GitHub Pages

1. Go to your repo on github.com → **Settings** → **Pages**
2. Under *Build and deployment*:
   - **Source**: Deploy from a branch
   - **Branch**: `main` / **Folder**: `/docs`
3. Click **Save**
4. Wait ~1 minute — a green banner shows your live URL
5. Visit `https://YOUR_USER.github.io/GCC-MileWise/`

Every `git push` to `main` updates the live site automatically within about a minute.

---

## Changing default parameter values

Edit the `useState` initialisers near the top of `docs/app.jsx`:

```js
const [numEV, setNumEV]             = useState(6);    // number of EV vehicles
const [evRange, setEvRange]         = useState(220);  // km
const [startBattery, setStartBattery] = useState(92); // %
const [workDay, setWorkDay]         = useState(8);    // hours
```

Internal solver constants are in `docs/components.jsx` inside `solveOnRoadNetwork`:

```js
const AVG_SPEED_KMH    = 40;   // average driving speed
const DELIVERY_STOP_MIN = 3;   // minutes per delivery stop
const chargerStep       = ...  // km between consecutive suggested chargers
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `data.json failed to load (404)` | `docs/data/` is incomplete | Re-run `python prepare_data.py` |
| Map loads but *Run Analysis* crashes | Solver edge case | Open DevTools → Console for details |
| Blank page, console says `GCCApp is not defined` | A JSX file failed to load | Check Network tab for 404s |
| Blank map tile, no basemap | CDN blocked or offline | Check internet connection; MapLibre loads from `cdn.jsdelivr.net` |

If in doubt, open DevTools (F12) → Console and look for the first red error.

---

## Reference

Vallejo, B., Kähärä, T., Nugroho, A. (2026). Geospatial Challenge Camp. *"Energy-efficient last mile delivery"*
