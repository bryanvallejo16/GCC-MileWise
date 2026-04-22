"""
One-time data prep for GCC MileWise.

Reads the raw inputs (parquets + CSVs + kunta polygon) and produces the
static files the React app needs:

    docs/data.json                   — depot + chargers + boundary
    docs/data/buildings.geojson      — ~18k building points
    docs/data/roads.geojson          — ~10k road LineStrings

After running this once, the React app loads these files with plain
fetch().json() — no parquet parsing in the browser, no hyparquet dep.

Usage:
    python prepare_data.py

Requires the raw files at:
    raw/buildings_rovaniemi.parquet
    raw/road_network_rovaniemi.parquet
    raw/ev_charging_rovaniemi.csv
    raw/facilities_vehicles_available.csv
    raw/rovaniemi_kunta.geojson

Adjust RAW_DIR below if your files live elsewhere.
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

# Paths — adjust if your raw files live elsewhere
RAW_DIR = Path("raw")
OUT_DIR = Path("docs")
OUT_DATA = OUT_DIR / "data"
OUT_DIR.mkdir(exist_ok=True)
OUT_DATA.mkdir(exist_ok=True)


def write_data_json() -> None:
    """depot + chargers + boundary -> docs/data.json"""
    fac = pd.read_csv(RAW_DIR / "facilities_vehicles_available.csv")
    d = fac[fac["placename"].str.contains("Rovaniemi", case=False, na=False)].iloc[0]
    depot = {
        "name": "Rovaniemi Fleet Depot",
        "lon": float(round(d["longitude"], 6)),
        "lat": float(round(d["latitude"], 6)),
    }

    ev = pd.read_csv(RAW_DIR / "ev_charging_rovaniemi.csv")
    chargers = [
        {"lon": float(round(r["longitude"], 6)), "lat": float(round(r["latitude"], 6))}
        for _, r in ev.iterrows()
    ]

    kunta = gpd.read_file(RAW_DIR / "rovaniemi_kunta.geojson").to_crs("EPSG:4326")
    # Simplify a bit so data.json stays tiny (class-demo polygon, not survey-grade)
    poly = kunta.iloc[0].geometry.simplify(0.001, preserve_topology=True)
    boundary = [[round(x, 6), round(y, 6)] for x, y in poly.exterior.coords]

    out = {"depot": depot, "chargers": chargers, "boundary": boundary}
    (OUT_DIR / "data.json").write_text(json.dumps(out, indent=2))
    print(f"wrote docs/data.json ({len(chargers)} chargers, {len(boundary)} boundary pts)")


def write_buildings_geojson() -> None:
    """buildings parquet -> docs/data/buildings.geojson (Point features).
    Keeps only the longitude/latitude columns and strips everything else to
    keep the file as small as possible."""
    gdf = gpd.read_parquet(RAW_DIR / "buildings_rovaniemi.parquet")
    # Build a compact GeoJSON by hand — faster and smaller than gdf.to_json()
    feats = []
    for i, row in enumerate(gdf.itertuples(index=False)):
        lon = float(row.longitude)
        lat = float(row.latitude)
        if not (lon == lon and lat == lat):   # NaN check
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {"id": i},
        })
    fc = {"type": "FeatureCollection", "features": feats}
    path = OUT_DATA / "buildings.geojson"
    path.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"wrote {path} ({len(feats):,} points, {path.stat().st_size/1024:.0f} KB)")


def write_roads_geojson() -> None:
    """road network parquet -> docs/data/roads.geojson (LineString features).
    Rounds coords to 5 decimals (~1 m precision) — plenty for routing and
    cuts file size substantially."""
    gdf = gpd.read_parquet(RAW_DIR / "road_network_rovaniemi.parquet").to_crs("EPSG:4326")

    feats = []
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            continue
        if geom.geom_type == "LineString":
            coords = [[round(x, 5), round(y, 5)] for x, y in geom.coords]
            if len(coords) >= 2:
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {},
                })
        elif geom.geom_type == "MultiLineString":
            for sub in geom.geoms:
                coords = [[round(x, 5), round(y, 5)] for x, y in sub.coords]
                if len(coords) >= 2:
                    feats.append({
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": coords},
                        "properties": {},
                    })

    fc = {"type": "FeatureCollection", "features": feats}
    path = OUT_DATA / "roads.geojson"
    path.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"wrote {path} ({len(feats):,} linestrings, {path.stat().st_size/1024/1024:.1f} MB)")


def main():
    if not RAW_DIR.exists():
        raise SystemExit(f"Raw data folder not found: {RAW_DIR}. "
                         f"Put the parquet/CSV/geojson files there.")
    write_data_json()
    write_buildings_geojson()
    write_roads_geojson()
    print("\ndone — the docs/ folder is now self-contained.")


if __name__ == "__main__":
    main()
