"""
EV Delivery Routing — Rovaniemi
================================

Computes one-day delivery routes for a fleet of electric vehicles starting
from a single depot, respecting battery range and shift-length constraints.
Identifies buildings that cannot be reached with existing charging
infrastructure and suggests new charger locations to close the gap.

Output: a single kepler.gl HTML with multiple scenarios (switchable via the
  layer panel), plus a summary JSON with per-scenario statistics.

Usage:
    python run_routing.py

Edit the SCENARIOS list below to try different parameter combinations.
"""

from __future__ import annotations

import json
import math
import pickle
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from shapely.geometry import LineString, Point
from sklearn.cluster import KMeans
from sklearn.neighbors import BallTree


# ---------------------------------------------------------------------------
# Parameters — edit these to explore different scenarios
# ---------------------------------------------------------------------------

@dataclass
class Scenario:
    name: str
    n_vehicles: int = 5
    range_km: float = 100.0
    shift_hours: float = 12.0
    avg_speed_kmh: float = 40.0
    delivery_stop_min: float = 3.0
    charging_stop_min: float = 45.0
    buildings_sample: int | None = 1000   # None = all 18k buildings
    random_seed: int = 42


SCENARIOS: list[Scenario] = [
    Scenario(name="Baseline",       n_vehicles=5, range_km=100, shift_hours=12),
    Scenario(name="Longer shift",   n_vehicles=5, range_km=100, shift_hours=16),
    Scenario(name="Bigger range",   n_vehicles=5, range_km=150, shift_hours=12),
]


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUTPUT = ROOT / "output"
OUTPUT.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data():
    """Load all inputs. Returns (buildings, depot, chargers, roads, kunta)."""
    print("Loading input data...")
    buildings = gpd.read_parquet(DATA / "buildings_rovaniemi.parquet")
    chargers = pd.read_csv(DATA / "ev_charging_rovaniemi.csv")
    facilities = pd.read_csv(DATA / "facilities_vehicles_available.csv")
    roads = gpd.read_parquet(DATA / "road_network_rovaniemi.parquet")
    kunta = gpd.read_file(DATA / "rovaniemi_kunta.geojson").to_crs("EPSG:4326")

    # The depot is the Rovaniemi facility entry
    depot_row = facilities[facilities["placename"].str.contains("Rovaniemi", case=False, na=False)].iloc[0]
    depot = {"longitude": depot_row["longitude"], "latitude": depot_row["latitude"]}

    print(f"  Buildings:       {len(buildings):>6}")
    print(f"  Chargers:        {len(chargers):>6}")
    print(f"  Road segments:   {len(roads):>6}")
    print(f"  Depot:           ({depot['longitude']:.4f}, {depot['latitude']:.4f})")
    return buildings, depot, chargers, roads, kunta


# ---------------------------------------------------------------------------
# Build a routable graph from the road-network parquet
# ---------------------------------------------------------------------------

def build_road_graph(roads: gpd.GeoDataFrame, cache: Path | None = None) -> nx.Graph:
    """Turn a GeoDataFrame of road LineStrings into a NetworkX graph with
    edge length in metres. Caches to pickle for subsequent runs."""
    if cache and cache.exists():
        print(f"Loading cached road graph from {cache.name}...")
        with open(cache, "rb") as f:
            return pickle.load(f)

    print("Building road graph from LineStrings...")
    t0 = time.time()
    G = nx.Graph()
    R = 6_371_000  # earth radius in metres

    for geom in roads.geometry:
        if geom is None or geom.is_empty:
            continue
        coords = list(geom.coords)
        for i in range(len(coords) - 1):
            # Snap to 6 decimals to merge near-duplicate endpoints
            a = (round(coords[i][0], 6), round(coords[i][1], 6))
            b = (round(coords[i + 1][0], 6), round(coords[i + 1][1], 6))
            if a == b:
                continue
            # Haversine distance
            lon1, lat1 = a
            lon2, lat2 = b
            phi1, phi2 = math.radians(lat1), math.radians(lat2)
            dphi = math.radians(lat2 - lat1)
            dlam = math.radians(lon2 - lon1)
            h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
            d = 2 * R * math.asin(math.sqrt(h))
            if G.has_edge(a, b):
                if G[a][b]["length"] > d:
                    G[a][b]["length"] = d
            else:
                G.add_edge(a, b, length=d)

    # Keep only the largest connected component (defensive)
    if not nx.is_connected(G):
        largest = max(nx.connected_components(G), key=len)
        G = G.subgraph(largest).copy()

    print(f"  Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges ({time.time()-t0:.1f}s)")
    if cache:
        with open(cache, "wb") as f:
            pickle.dump(G, f)
    return G


def snap_points_to_graph(G: nx.Graph, points: np.ndarray) -> list[tuple[float, float]]:
    """For each (lon, lat) in `points`, return the nearest graph node.
    Uses a BallTree with haversine metric for speed."""
    nodes = np.array(G.nodes)                     # shape (N, 2) in (lon, lat)
    nodes_rad = np.radians(nodes[:, [1, 0]])      # BallTree wants (lat, lon)
    tree = BallTree(nodes_rad, metric="haversine")
    pts_rad = np.radians(points[:, [1, 0]])
    _, idx = tree.query(pts_rad, k=1)
    return [tuple(nodes[i]) for i in idx.flatten()]


# ---------------------------------------------------------------------------
# Vehicle clustering — assign each building to one vehicle
# ---------------------------------------------------------------------------

def cluster_buildings(buildings: gpd.GeoDataFrame, depot: dict, n_vehicles: int,
                      seed: int) -> np.ndarray:
    """KMeans cluster buildings, then rebalance so every vehicle gets
    roughly the same number of buildings. Returns an array of cluster
    indices (one per building)."""
    coords = buildings[["longitude", "latitude"]].values
    km = KMeans(n_clusters=n_vehicles, random_state=seed, n_init=10)
    labels = km.fit_predict(coords)
    centers = km.cluster_centers_

    # Rebalance: target = ceil(N / k) per cluster. Move the farthest
    # points from oversized clusters to the nearest undersized cluster.
    target = math.ceil(len(coords) / n_vehicles)
    for _ in range(3):
        counts = np.bincount(labels, minlength=n_vehicles)
        over = np.where(counts > target)[0]
        under = np.where(counts < target)[0]
        if len(over) == 0 or len(under) == 0:
            break
        for o in over:
            excess = counts[o] - target
            if excess <= 0:
                continue
            members = np.where(labels == o)[0]
            d_own = np.linalg.norm(coords[members] - centers[o], axis=1)
            farthest = members[np.argsort(-d_own)]
            moved = 0
            for idx in farthest:
                if moved >= excess:
                    break
                d_to_under = np.linalg.norm(coords[idx] - centers[under], axis=1)
                dest = under[int(np.argmin(d_to_under))]
                labels[idx] = dest
                moved += 1
                if np.bincount(labels, minlength=n_vehicles)[dest] >= target:
                    under = np.setdiff1d(under, [dest])
                    if len(under) == 0:
                        break
    return labels


# ---------------------------------------------------------------------------
# The routing core — greedy nearest-neighbour with range + shift awareness
# ---------------------------------------------------------------------------

@dataclass
class Leg:
    """A single movement between two points with metadata for animation."""
    vehicle_id: int
    kind: str                 # 'drive' | 'charging_detour' | 'return'
    coords: list[tuple[float, float, float]]  # [lon, lat, timestamp_seconds]
    distance_m: float
    start_time_s: float
    end_time_s: float


@dataclass
class VehicleResult:
    vehicle_id: int
    legs: list[Leg] = field(default_factory=list)
    delivered_building_ids: list[int] = field(default_factory=list)
    missed_building_ids: list[int] = field(default_factory=list)
    total_distance_m: float = 0.0
    total_drive_time_s: float = 0.0
    total_stop_time_s: float = 0.0
    total_charging_time_s: float = 0.0
    num_charges: int = 0
    shift_end_reason: str = ""


def _precompute_facility_distances(G: nx.Graph, sources: list) -> dict:
    """Single-source shortest-distance (no path reconstruction, so memory stays
    reasonable) from each source. Returns {source: dist_dict}."""
    out = {}
    for s in sources:
        out[s] = nx.single_source_dijkstra_path_length(G, s, weight="length")
    return out


def route_vehicle(
    *,
    vehicle_id: int,
    assigned_buildings: pd.DataFrame,
    G: nx.Graph,
    depot_node: tuple[float, float],
    charger_nodes: list[tuple[float, float]],
    building_nodes: dict[int, tuple[float, float]],
    scenario: Scenario,
    facility_dists: dict,     # {facility_node: dist_dict} — distance only
) -> VehicleResult:
    """Plan one vehicle's day. Greedy nearest-unvisited loop with battery
    and shift-time checks. Returns all animation legs + stats.

    Path caching strategy:
      - facility_dists: distances-only SSSP from depot + every charger
        (precomputed once per scenario; used for both 'reverse' queries
        like "what's the distance from building X to charger C" via
        symmetry on undirected graph, and for "can we reach a charger
        from here" checks).
      - sssp_cache: full (dist, path) SSSP from the vehicle's current
        node, recomputed each time the vehicle moves to a new node.
    """

    result = VehicleResult(vehicle_id=vehicle_id)
    range_m = scenario.range_km * 1000
    speed_mps = scenario.avg_speed_kmh * 1000 / 3600
    shift_s = scenario.shift_hours * 3600
    delivery_s = scenario.delivery_stop_min * 60
    charging_s = scenario.charging_stop_min * 60

    clock = 0.0
    battery_m = range_m
    current = depot_node
    remaining = assigned_buildings.copy().reset_index(drop=True)

    def haversine_m(a, b):
        """Metres between two (lon, lat) tuples — used only for ranking
        candidate buildings, not for authoritative distance decisions."""
        R = 6_371_000
        lon1, lat1 = a
        lon2, lat2 = b
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
        return 2 * R * math.asin(math.sqrt(h))

    def sp(a, b):
        """Shortest path + distance on graph. Returns (nodes, distance_m) or (None, inf)."""
        try:
            d, nodes = nx.single_source_dijkstra(
                G, a, target=b, cutoff=2 * range_m, weight="length")
            return nodes, d
        except nx.NetworkXNoPath:
            return None, float("inf")

    while len(remaining) > 0 and clock < shift_s:
        # 1) Rank remaining buildings by *straight-line* distance (cheap)
        cur_lonlat = current
        sl_dists = np.array([haversine_m(cur_lonlat, building_nodes[int(b)])
                             for b in remaining["building_id"]])
        order = np.argsort(sl_dists)

        # 2) Walk candidates in straight-line order; for each, do ONE
        #    graph shortest-path to check exact distance and reachability
        chosen_pos = None
        chosen_dist = None
        chosen_nodes = None
        chosen_node = None
        for cand_pos in order[:5]:      # try top 5 nearest
            cand_node = building_nodes[int(remaining.iloc[cand_pos]["building_id"])]
            nodes, d = sp(current, cand_node)
            if nodes is None or math.isinf(d):
                continue
            chosen_pos = int(cand_pos)
            chosen_dist = float(d)
            chosen_node = cand_node
            chosen_nodes = nodes
            break

        if chosen_pos is None:
            result.shift_end_reason = "no_reachable_building"
            break

        # 3) Can we reach it AND have enough battery to reach some facility after?
        need_charge = False
        if chosen_dist > battery_m:
            need_charge = True
        else:
            # Only worry about the "return to facility" check when we're
            # using >80% of the tank on this single leg. Otherwise we'd
            # force charging detours for every single delivery in remote
            # areas where one charger is the closest thing by miles, which
            # causes pointless oscillation.
            post_battery = battery_m - chosen_dist
            if post_battery < 0.2 * range_m:
                post_min = min(
                    facility_dists[depot_node].get(chosen_node, float("inf")),
                    *(facility_dists[c].get(chosen_node, float("inf")) for c in charger_nodes),
                )
                if post_min > post_battery:
                    need_charge = True

        if need_charge:
            # Find nearest charger on current battery — use facility_dists
            # (symmetric on undirected graph, indexed by facility node).
            best_c = None
            best_cd = float("inf")
            for c in charger_nodes:
                if c == current:
                    continue
                # Distance from current to charger c (facility_dists[c] gives
                # distances from c to everywhere — symmetric)
                d = facility_dists[c].get(current, float("inf"))
                if d > battery_m:
                    continue
                if d < best_cd:
                    best_cd = d
                    best_c = c

            if best_c is None:
                result.shift_end_reason = "no_reachable_charger"
                break

            # Check: after charging at best_c, can we reach chosen_node?
            d_after = facility_dists[best_c].get(chosen_node, float("inf"))
            if d_after > range_m:
                # Building out of reach even from best charger — drop & continue
                remaining = remaining.drop(remaining.index[chosen_pos]).reset_index(drop=True)
                continue

            drive_t = best_cd / speed_mps
            if clock + drive_t + charging_s > shift_s:
                result.shift_end_reason = "shift_ended_en_route_to_charger"
                break

            # We need the actual path to draw the leg — one more SP call
            nodes_path, _ = sp(current, best_c)
            if nodes_path is None:
                result.shift_end_reason = "stranded_path_failure"
                break

            leg_coords = [(n[0], n[1], clock + (i / max(len(nodes_path) - 1, 1)) * drive_t)
                          for i, n in enumerate(nodes_path)]
            result.legs.append(Leg(
                vehicle_id=vehicle_id, kind="charging_detour",
                coords=leg_coords, distance_m=best_cd,
                start_time_s=clock, end_time_s=clock + drive_t,
            ))
            clock += drive_t
            result.total_drive_time_s += drive_t
            result.total_distance_m += best_cd
            clock += charging_s
            result.total_charging_time_s += charging_s
            result.num_charges += 1
            battery_m = range_m
            current = best_c
            continue

        # 4) Deliver
        drive_t = chosen_dist / speed_mps
        if clock + drive_t + delivery_s > shift_s:
            result.shift_end_reason = "shift_ended"
            break

        leg_coords = [(n[0], n[1], clock + (i / max(len(chosen_nodes) - 1, 1)) * drive_t)
                      for i, n in enumerate(chosen_nodes)]
        result.legs.append(Leg(
            vehicle_id=vehicle_id, kind="drive",
            coords=leg_coords, distance_m=chosen_dist,
            start_time_s=clock, end_time_s=clock + drive_t,
        ))
        clock += drive_t
        battery_m -= chosen_dist
        result.total_drive_time_s += drive_t
        result.total_distance_m += chosen_dist

        b_idx = int(remaining.iloc[chosen_pos]["building_id"])
        result.delivered_building_ids.append(b_idx)
        clock += delivery_s
        result.total_stop_time_s += delivery_s
        current = chosen_node
        remaining = remaining.drop(remaining.index[chosen_pos]).reset_index(drop=True)

    if len(remaining) == 0 and not result.shift_end_reason:
        result.shift_end_reason = "all_delivered"
    if not result.shift_end_reason:
        result.shift_end_reason = "shift_ended"
    result.missed_building_ids = remaining["building_id"].astype(int).tolist()
    return result


# ---------------------------------------------------------------------------
# Suggest new charger locations
# ---------------------------------------------------------------------------

def suggest_chargers(
    missed_buildings: gpd.GeoDataFrame,
    existing_chargers: pd.DataFrame,
    G: nx.Graph,
    min_gap_km: float = 30.0,
    max_new: int = 10,
    seed: int = 42,
) -> gpd.GeoDataFrame:
    """For missed buildings, cluster those that are far from any existing
    charger and place a suggested charger at each cluster centroid, snapped
    to the nearest road node."""
    if len(missed_buildings) == 0:
        return gpd.GeoDataFrame(columns=["longitude", "latitude", "geometry"], crs="EPSG:4326")

    # Drop missed buildings that are close to an existing charger (charger
    # exists, so problem is capacity/time, not location — adding another
    # charger at the same spot won't help)
    existing_coords_rad = np.radians(existing_chargers[["latitude", "longitude"]].values)
    tree = BallTree(existing_coords_rad, metric="haversine")
    miss_rad = np.radians(missed_buildings[["latitude", "longitude"]].values)
    dists, _ = tree.query(miss_rad, k=1)
    dist_km = dists.flatten() * 6371
    far = missed_buildings[dist_km > min_gap_km].copy()
    if len(far) == 0:
        return gpd.GeoDataFrame(columns=["longitude", "latitude", "geometry"], crs="EPSG:4326")

    # Choose k: one candidate per ~300 missed buildings, capped
    k = max(1, min(max_new, math.ceil(len(far) / 300)))
    km = KMeans(n_clusters=k, random_state=seed, n_init=10)
    far["cluster"] = km.fit_predict(far[["longitude", "latitude"]].values)

    centroids = far.groupby("cluster")[["longitude", "latitude"]].mean().reset_index()
    # Snap each centroid to the nearest road node
    cent_arr = centroids[["longitude", "latitude"]].values
    snapped = snap_points_to_graph(G, cent_arr)
    centroids["longitude"] = [s[0] for s in snapped]
    centroids["latitude"] = [s[1] for s in snapped]
    centroids["geometry"] = [Point(lon, lat) for lon, lat in snapped]
    centroids["serves_buildings"] = far.groupby("cluster").size().values
    return gpd.GeoDataFrame(centroids[["longitude", "latitude", "serves_buildings", "geometry"]],
                            crs="EPSG:4326")


# ---------------------------------------------------------------------------
# Run one scenario
# ---------------------------------------------------------------------------

def run_scenario(
    scenario: Scenario,
    buildings: gpd.GeoDataFrame,
    depot: dict,
    chargers: pd.DataFrame,
    G: nx.Graph,
) -> dict:
    print(f"\n=== Scenario: {scenario.name} ===")
    print(f"  {scenario.n_vehicles} vehicles  |  {scenario.range_km} km range  |  "
          f"{scenario.shift_hours} h shift  |  {scenario.avg_speed_kmh} km/h")

    # Sample buildings for a one-day plan
    rng = np.random.default_rng(scenario.random_seed)
    if scenario.buildings_sample and scenario.buildings_sample < len(buildings):
        idx = rng.choice(len(buildings), size=scenario.buildings_sample, replace=False)
        day_buildings = buildings.iloc[idx].reset_index(drop=True).copy()
    else:
        day_buildings = buildings.reset_index(drop=True).copy()
    day_buildings["building_id"] = day_buildings.index

    # Cluster across vehicles
    day_buildings["vehicle_id"] = cluster_buildings(
        day_buildings, depot, scenario.n_vehicles, scenario.random_seed)

    # Snap all relevant points to graph nodes
    print("  Snapping depot / chargers / buildings to road nodes...")
    depot_node = snap_points_to_graph(G, np.array([[depot["longitude"], depot["latitude"]]]))[0]
    charger_nodes = snap_points_to_graph(G, chargers[["longitude", "latitude"]].values)
    # Deduplicate in case two chargers snap to the same node
    charger_nodes = list(dict.fromkeys(charger_nodes))
    b_nodes = snap_points_to_graph(G, day_buildings[["longitude", "latitude"]].values)
    building_nodes = {int(bid): node for bid, node in zip(day_buildings["building_id"], b_nodes)}

    # Precompute distances from depot + every charger (queried constantly)
    print(f"  Precomputing distances from {1 + len(charger_nodes)} facilities...")
    t0 = time.time()
    facility_dists = _precompute_facility_distances(G, [depot_node] + charger_nodes)
    print(f"    done ({time.time()-t0:.1f}s)")

    # Route each vehicle
    all_results: list[VehicleResult] = []
    for v in range(scenario.n_vehicles):
        print(f"  Routing vehicle {v}...", end=" ", flush=True)
        t0 = time.time()
        assigned = day_buildings[day_buildings["vehicle_id"] == v].copy()
        res = route_vehicle(
            vehicle_id=v,
            assigned_buildings=assigned,
            G=G,
            depot_node=depot_node,
            charger_nodes=charger_nodes,
            building_nodes=building_nodes,
            scenario=scenario,
            facility_dists=facility_dists,
        )
        all_results.append(res)
        print(f"delivered={len(res.delivered_building_ids)}/{len(assigned)} "
              f"dist={res.total_distance_m/1000:.0f}km charges={res.num_charges} "
              f"({time.time()-t0:.1f}s)")

    # Collect delivered and missed
    delivered_ids: set[int] = set()
    missed_ids: set[int] = set()
    for r in all_results:
        delivered_ids.update(r.delivered_building_ids)
        missed_ids.update(r.missed_building_ids)
    day_buildings["status"] = day_buildings["building_id"].apply(
        lambda i: "delivered" if i in delivered_ids else ("missed" if i in missed_ids else "unassigned"))

    missed_gdf = day_buildings[day_buildings["status"] == "missed"].copy()
    suggested = suggest_chargers(missed_gdf, chargers, G, seed=scenario.random_seed)

    # Stats
    stats = {
        "scenario": scenario.name,
        "n_vehicles": scenario.n_vehicles,
        "range_km": scenario.range_km,
        "shift_hours": scenario.shift_hours,
        "buildings_in_day": int(len(day_buildings)),
        "buildings_delivered": int(len(delivered_ids)),
        "buildings_missed": int(len(missed_ids)),
        "coverage_pct": round(100 * len(delivered_ids) / max(len(day_buildings), 1), 1),
        "total_distance_km": round(sum(r.total_distance_m for r in all_results) / 1000, 1),
        "total_charging_stops": int(sum(r.num_charges for r in all_results)),
        "suggested_new_chargers": int(len(suggested)),
        "per_vehicle": [
            {
                "vehicle_id": r.vehicle_id,
                "delivered": len(r.delivered_building_ids),
                "missed": len(r.missed_building_ids),
                "distance_km": round(r.total_distance_m / 1000, 1),
                "drive_time_h": round(r.total_drive_time_s / 3600, 2),
                "charging_time_h": round(r.total_charging_time_s / 3600, 2),
                "num_charges": r.num_charges,
                "shift_end_reason": r.shift_end_reason,
            }
            for r in all_results
        ],
    }
    print(f"  => delivered {stats['buildings_delivered']} / {stats['buildings_in_day']} "
          f"({stats['coverage_pct']}%)  missed {stats['buildings_missed']}  "
          f"suggested chargers: {stats['suggested_new_chargers']}")

    return {
        "stats": stats,
        "day_buildings": day_buildings,
        "results": all_results,
        "suggested_chargers": suggested,
    }


# ---------------------------------------------------------------------------
# Build a single JSON payload with every scenario's data for the HTML
# ---------------------------------------------------------------------------

# Vehicle colors — hex strings for direct use in MapLibre paint properties
VEHICLE_COLORS = [
    "#e74c3c",  # red
    "#3498db",  # blue
    "#2ecc71",  # green
    "#f1c40f",  # yellow
    "#9b59b6",  # purple
    "#1abc9c",  # teal
    "#e67e22",  # orange
    "#ec7063",  # salmon
    "#34495e",  # dark blue
    "#16a085",  # dark teal
]


def scenario_to_payload(
    scenario: Scenario,
    scenario_result: dict,
    depot: dict,
    chargers: pd.DataFrame,
) -> dict[str, Any]:
    """Build a compact dict of everything the web map needs for one scenario.
    Lat/lon rounded to 6 decimals, timestamps in seconds. Suitable for
    JSON-embedding directly in the HTML file."""
    # Per-vehicle timestamped trips — one entry per vehicle with the full
    # sequence of (lon, lat, t_seconds) coordinates including charger
    # "pause" markers (consecutive identical points with gap in t).
    trips = []
    for r in scenario_result["results"]:
        if not r.legs:
            continue
        coords = []  # list of [lon, lat, t]
        for leg in r.legs:
            if not leg.coords:
                continue
            # Append all coords; consecutive legs may share endpoints,
            # dedupe the obvious repeats without losing timing.
            for lon, lat, t in leg.coords:
                if coords and coords[-1][0] == lon and coords[-1][1] == lat:
                    # Same point — keep the earlier one, but if this leg's
                    # time is later we update it so the "pause" duration
                    # (e.g. at a charger) is preserved.
                    if t > coords[-1][2]:
                        coords[-1][2] = t
                else:
                    coords.append([round(lon, 6), round(lat, 6), round(t, 1)])
        if len(coords) < 2:
            continue
        trips.append({
            "vehicle_id": r.vehicle_id,
            "color": VEHICLE_COLORS[r.vehicle_id % len(VEHICLE_COLORS)],
            "total_distance_km": round(r.total_distance_m / 1000, 1),
            "num_charges": r.num_charges,
            "coords": coords,  # [[lon, lat, t], ...]
        })

    # Buildings — split by status, only what's needed for rendering
    b = scenario_result["day_buildings"]
    delivered = [
        {"lon": round(r["longitude"], 6), "lat": round(r["latitude"], 6),
         "vehicle_id": int(r["vehicle_id"])}
        for _, r in b[b["status"] == "delivered"].iterrows()
    ]
    missed = [
        {"lon": round(r["longitude"], 6), "lat": round(r["latitude"], 6)}
        for _, r in b[b["status"] == "missed"].iterrows()
    ]

    # Suggested chargers for this scenario
    sug = scenario_result["suggested_chargers"]
    suggested = [
        {"lon": round(r["longitude"], 6), "lat": round(r["latitude"], 6),
         "serves_buildings": int(r["serves_buildings"])}
        for _, r in sug.iterrows()
    ] if len(sug) > 0 else []

    return {
        "name": scenario.name,
        "params": {
            "n_vehicles": scenario.n_vehicles,
            "range_km": scenario.range_km,
            "shift_hours": scenario.shift_hours,
            "avg_speed_kmh": scenario.avg_speed_kmh,
        },
        "stats": scenario_result["stats"],
        "trips": trips,
        "delivered": delivered,
        "missed": missed,
        "suggested_chargers": suggested,
    }


def _html_template() -> str:
    """Return the HTML template (no f-string substitution here to avoid
    escaping a mountain of braces; we use a __DATA_JSON__ placeholder)."""
    return HTML_TEMPLATE


# ---------------------------------------------------------------------------
# The web front-end (MapLibre GL JS). Single self-contained HTML file.
# Data for all scenarios is injected as JSON where __DATA_JSON__ appears.
# ---------------------------------------------------------------------------

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>EV Delivery Routing — Rovaniemi</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  :root {
    --bg: #0f1419;
    --panel: rgba(20, 28, 38, 0.92);
    --border: rgba(255, 255, 255, 0.08);
    --text: #e6ebf0;
    --muted: #8b95a3;
    --accent: #3498db;
    --good: #2ecc71;
    --bad: #e74c3c;
    --warn: #e67e22;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); }
  #map { position: absolute; inset: 0; }

  .panel {
    position: absolute; background: var(--panel); backdrop-filter: blur(12px);
    border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); padding: 14px 16px;
    font-size: 13px; line-height: 1.45;
  }
  .panel h3 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--muted); font-weight: 600; }

  /* Controls (top-left) */
  #controls { top: 12px; left: 12px; width: 320px; }
  #controls select, #controls input[type=range] {
    width: 100%; margin-bottom: 10px; background: #1a232e; color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px;
  }
  #controls .btn-row { display: flex; gap: 6px; margin-bottom: 10px; }
  #controls button {
    flex: 1; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border);
    background: #1a232e; color: var(--text); cursor: pointer; font-size: 13px;
  }
  #controls button:hover { background: #243040; }
  #controls button.primary { background: var(--accent); border-color: var(--accent); color: white; }
  #controls button.primary:hover { background: #2980b9; }
  #controls .speed-row { display: flex; gap: 4px; margin-bottom: 10px; }
  #controls .speed-row button { padding: 5px; font-size: 12px; }
  #controls .speed-row button.active { background: var(--accent); border-color: var(--accent); color: white; }
  #controls .time-display { font-size: 12px; color: var(--muted); text-align: center; margin-top: -4px; margin-bottom: 8px; font-variant-numeric: tabular-nums; }
  #controls .param-summary { font-size: 11px; color: var(--muted); margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--border); }

  /* Layers (top-right) */
  #layers { top: 12px; right: 12px; width: 220px; }
  #layers label { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; font-size: 12px; }
  #layers input[type=checkbox] { accent-color: var(--accent); }
  #layers .swatch { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
  #layers .swatch-round { border-radius: 50%; }

  /* Stats (bottom-left) */
  #stats { bottom: 12px; left: 12px; width: 340px; }
  #stats .stat-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
  #stats .stat-row .v { color: var(--text); font-variant-numeric: tabular-nums; font-weight: 500; }
  #stats .stat-row .k { color: var(--muted); }
  #stats .coverage { margin: 8px 0; height: 6px; background: #1a232e; border-radius: 3px; overflow: hidden; }
  #stats .coverage-bar { height: 100%; background: linear-gradient(90deg, var(--good), var(--accent)); transition: width 0.3s; }

  /* Legend (bottom-right) */
  #legend { bottom: 12px; right: 12px; width: 220px; }
  #legend .item { display: flex; align-items: center; gap: 10px; padding: 3px 0; font-size: 12px; color: var(--muted); }
  #legend .swatch { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; }
  #legend .swatch-round { border-radius: 50%; }
  #legend .swatch-star { background: var(--warn); clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); }
  #legend .swatch-depot { background: gold; clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); }

  /* Per-vehicle colors in the legend */
  .v0 { background: #e74c3c; } .v1 { background: #3498db; } .v2 { background: #2ecc71; }
  .v3 { background: #f1c40f; } .v4 { background: #9b59b6; } .v5 { background: #1abc9c; }
  .v6 { background: #e67e22; } .v7 { background: #ec7063; } .v8 { background: #34495e; } .v9 { background: #16a085; }

  /* Title banner */
  #title { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: var(--panel); backdrop-filter: blur(12px); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 18px; font-weight: 600; font-size: 14px;
    letter-spacing: 0.3px; z-index: 1; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  #title .sub { color: var(--muted); font-weight: 400; font-size: 11px; margin-left: 8px; }
</style>
</head>
<body>
<div id="map"></div>
<div id="title">EV Delivery Routing — Rovaniemi <span class="sub">1-day plan</span></div>

<div class="panel" id="controls">
  <h3>Scenario &amp; Playback</h3>
  <select id="scenario-select"></select>
  <div class="btn-row">
    <button id="play-btn" class="primary">▶ Play</button>
    <button id="reset-btn">⟲ Reset</button>
  </div>
  <input type="range" id="time-slider" min="0" max="1" step="0.001" value="0">
  <div class="time-display" id="time-display">0:00 / 0:00</div>
  <div class="speed-row">
    <button data-speed="1">1×</button>
    <button data-speed="5">5×</button>
    <button data-speed="20" class="active">20×</button>
    <button data-speed="100">100×</button>
  </div>
  <div class="param-summary" id="param-summary"></div>
</div>

<div class="panel" id="layers">
  <h3>Layers</h3>
  <label><input type="checkbox" id="lyr-trips" checked><span class="swatch" style="background: linear-gradient(90deg, #e74c3c, #3498db, #2ecc71);"></span>Animated Vehicles</label>
  <label><input type="checkbox" id="lyr-routes"><span class="swatch" style="background: #5a6978;"></span>Full Routes</label>
  <label><input type="checkbox" id="lyr-delivered" checked><span class="swatch swatch-round" style="background: #2ecc71;"></span>Delivered Buildings</label>
  <label><input type="checkbox" id="lyr-missed" checked><span class="swatch swatch-round" style="background: #e74c3c;"></span>Missed Buildings</label>
  <label><input type="checkbox" id="lyr-chargers" checked><span class="swatch swatch-round" style="background: #3498db;"></span>Existing Chargers</label>
  <label><input type="checkbox" id="lyr-suggested" checked><span class="swatch swatch-round" style="background: #e67e22;"></span>Suggested Chargers</label>
</div>

<div class="panel" id="stats">
  <h3>Scenario Stats</h3>
  <div class="stat-row"><span class="k">Delivered</span><span class="v" id="s-delivered">—</span></div>
  <div class="coverage"><div class="coverage-bar" id="s-coverage" style="width: 0;"></div></div>
  <div class="stat-row"><span class="k">Missed</span><span class="v" id="s-missed">—</span></div>
  <div class="stat-row"><span class="k">Total distance</span><span class="v" id="s-distance">—</span></div>
  <div class="stat-row"><span class="k">Charging stops</span><span class="v" id="s-charges">—</span></div>
  <div class="stat-row"><span class="k">Suggested new chargers</span><span class="v" id="s-suggested">—</span></div>
</div>

<div class="panel" id="legend">
  <h3>Legend</h3>
  <div class="item"><span class="swatch-depot" style="width:14px;height:14px;flex-shrink:0;"></span>Depot</div>
  <div class="item"><span class="swatch swatch-round v0"></span>Vehicle 0</div>
  <div class="item"><span class="swatch swatch-round v1"></span>Vehicle 1</div>
  <div class="item"><span class="swatch swatch-round v2"></span>Vehicle 2</div>
  <div class="item"><span class="swatch swatch-round v3"></span>Vehicle 3</div>
  <div class="item"><span class="swatch swatch-round v4"></span>Vehicle 4</div>
  <div class="item"><span class="swatch swatch-star" style="width:14px;height:14px;flex-shrink:0;"></span>Suggested charger</div>
</div>

<script>
// ---------------------------------------------------------------------------
// Embedded data — all scenarios in one payload (generated by run_routing.py)
// ---------------------------------------------------------------------------
const DATA = __DATA_JSON__;

// ---------------------------------------------------------------------------
// Defensive: if MapLibre didn't load (CDN blocked, offline, etc.) or the
// map container is missing, show a visible error instead of silently failing.
// ---------------------------------------------------------------------------
(function checkPrereqs() {
  const problems = [];
  if (typeof maplibregl === 'undefined') {
    problems.push('MapLibre library failed to load (CDN blocked or offline?).');
  }
  const mapDiv = document.getElementById('map');
  if (!mapDiv) problems.push('Map container <div id="map"> not found.');
  if (problems.length) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;color:#fff;background:#0f1419;height:100vh;">' +
      '<h2 style="color:#e74c3c">Map failed to initialize</h2>' +
      '<ul>' + problems.map(p => '<li>' + p + '</li>').join('') + '</ul>' +
      '<p>Try: opening the file via a local web server ' +
      '(<code>python -m http.server 8000</code> then ' +
      '<a style="color:#3498db" href="http://localhost:8000/">http://localhost:8000</a>), ' +
      'or check your internet connection (MapLibre loads from cdn.jsdelivr.net).</p>' +
      '</div>';
    throw new Error('Prerequisites not met: ' + problems.join(' '));
  }
})();

// ---------------------------------------------------------------------------
// Map setup (MapLibre with a free dark vector basemap from CARTO)
// ---------------------------------------------------------------------------
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [DATA.depot.lon, DATA.depot.lat],
  zoom: 8.5,
  attributionControl: true,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'right');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentScenarioIdx = 0;
let shiftDurationSec = 12 * 3600;   // updated from scenario params
let animSpeed = 20;                  // real seconds of shift per real second of playback
let playing = false;
let lastFrameTs = 0;
let currentTimeSec = 0;

// ---------------------------------------------------------------------------
// Source / layer management: we rebuild a few sources when the user switches
// scenarios. Static layers (depot, existing chargers) are loaded once.
// ---------------------------------------------------------------------------

function scenarioData() { return DATA.scenarios[currentScenarioIdx]; }

function tripsToLineStrings(trips) {
  // One Feature per vehicle: full route as a LineString with no time info
  return {
    type: 'FeatureCollection',
    features: trips.map(t => ({
      type: 'Feature',
      properties: { vehicle_id: t.vehicle_id, color: t.color,
                    distance_km: t.total_distance_km, num_charges: t.num_charges },
      geometry: { type: 'LineString',
                  coordinates: t.coords.map(c => [c[0], c[1]]) },
    })),
  };
}

// For the animated trail: partial LineString clipped to current time.
// Interpolates between the two coords bracketing `t` for a smooth head.
function trailUpTo(trip, t) {
  const out = [];
  const c = trip.coords;
  for (let i = 0; i < c.length; i++) {
    if (c[i][2] <= t) {
      out.push([c[i][0], c[i][1]]);
    } else {
      if (i === 0) break;
      const a = c[i-1], b = c[i];
      const dt = b[2] - a[2];
      if (dt > 0) {
        const r = Math.max(0, Math.min(1, (t - a[2]) / dt));
        out.push([a[0] + (b[0]-a[0])*r, a[1] + (b[1]-a[1])*r]);
      }
      break;
    }
  }
  return out;
}

function headAt(trip, t) {
  const c = trip.coords;
  if (t <= c[0][2]) return [c[0][0], c[0][1]];
  if (t >= c[c.length-1][2]) return [c[c.length-1][0], c[c.length-1][1]];
  for (let i = 1; i < c.length; i++) {
    if (c[i][2] >= t) {
      const a = c[i-1], b = c[i];
      const dt = b[2] - a[2];
      if (dt === 0) return [a[0], a[1]];
      const r = (t - a[2]) / dt;
      return [a[0] + (b[0]-a[0])*r, a[1] + (b[1]-a[1])*r];
    }
  }
  return [c[c.length-1][0], c[c.length-1][1]];
}

function buildTrailsGeoJSON(t) {
  const sd = scenarioData();
  return {
    type: 'FeatureCollection',
    features: sd.trips.map(trip => ({
      type: 'Feature',
      properties: { vehicle_id: trip.vehicle_id, color: trip.color },
      geometry: { type: 'LineString', coordinates: trailUpTo(trip, t) },
    })).filter(f => f.geometry.coordinates.length >= 2),
  };
}

function buildHeadsGeoJSON(t) {
  const sd = scenarioData();
  return {
    type: 'FeatureCollection',
    features: sd.trips.map(trip => ({
      type: 'Feature',
      properties: { vehicle_id: trip.vehicle_id, color: trip.color },
      geometry: { type: 'Point', coordinates: headAt(trip, t) },
    })),
  };
}

function pointsGeoJSON(arr, extraProps = () => ({})) {
  return {
    type: 'FeatureCollection',
    features: arr.map(p => ({
      type: 'Feature',
      properties: extraProps(p),
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
}

// ---------------------------------------------------------------------------
// Set up sources/layers once the map has loaded
// ---------------------------------------------------------------------------
map.on('load', () => {
  // Static sources (depot, existing chargers)
  map.addSource('depot', { type: 'geojson',
    data: pointsGeoJSON([DATA.depot]) });
  map.addSource('existing-chargers', { type: 'geojson',
    data: pointsGeoJSON(DATA.existing_chargers) });

  // Per-scenario sources — empty placeholders, filled in loadScenario()
  const emptyFC = { type: 'FeatureCollection', features: [] };
  map.addSource('full-routes', { type: 'geojson', data: emptyFC });
  map.addSource('trails',      { type: 'geojson', data: emptyFC });
  map.addSource('heads',       { type: 'geojson', data: emptyFC });
  map.addSource('delivered',   { type: 'geojson', data: emptyFC });
  map.addSource('missed',      { type: 'geojson', data: emptyFC });
  map.addSource('suggested',   { type: 'geojson', data: emptyFC });

  // Layers — bottom to top
  map.addLayer({
    id: 'delivered-lyr', type: 'circle', source: 'delivered',
    paint: { 'circle-radius': 2.5, 'circle-color': '#2ecc71',
             'circle-opacity': 0.75, 'circle-stroke-width': 0 },
  });
  map.addLayer({
    id: 'missed-lyr', type: 'circle', source: 'missed',
    paint: { 'circle-radius': 4, 'circle-color': '#e74c3c',
             'circle-opacity': 0.9, 'circle-stroke-width': 1,
             'circle-stroke-color': '#fff', 'circle-stroke-opacity': 0.4 },
  });

  // Full (static) routes, dim grey — off by default
  map.addLayer({
    id: 'full-routes-lyr', type: 'line', source: 'full-routes',
    layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.2,
      'line-opacity': 0.35,
    },
  });

  // Animated trails (glowing line)
  map.addLayer({
    id: 'trails-glow', type: 'line', source: 'trails',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 8,
      'line-opacity': 0.25,
      'line-blur': 6,
    },
  });
  map.addLayer({
    id: 'trails-lyr', type: 'line', source: 'trails',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2.5,
      'line-opacity': 0.95,
    },
  });

  // Chargers & depot
  map.addLayer({
    id: 'existing-chargers-lyr', type: 'circle', source: 'existing-chargers',
    paint: { 'circle-radius': 6, 'circle-color': '#3498db',
             'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
             'circle-opacity': 0.9 },
  });
  map.addLayer({
    id: 'suggested-lyr', type: 'circle', source: 'suggested',
    paint: { 'circle-radius': 10, 'circle-color': '#e67e22',
             'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
             'circle-opacity': 0.95,
             'circle-blur': 0 },
  });
  // Glow under suggested chargers
  map.addLayer({
    id: 'suggested-glow', type: 'circle', source: 'suggested',
    paint: { 'circle-radius': 18, 'circle-color': '#e67e22',
             'circle-opacity': 0.25, 'circle-blur': 1 },
  }, 'suggested-lyr');

  // Head dots (moving vehicles)
  map.addLayer({
    id: 'heads-glow', type: 'circle', source: 'heads',
    paint: { 'circle-radius': 12, 'circle-color': ['get', 'color'],
             'circle-opacity': 0.35, 'circle-blur': 1 },
  });
  map.addLayer({
    id: 'heads-lyr', type: 'circle', source: 'heads',
    paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'],
             'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
             'circle-opacity': 1 },
  });

  // Depot on top
  map.addLayer({
    id: 'depot-lyr', type: 'circle', source: 'depot',
    paint: { 'circle-radius': 10, 'circle-color': '#ffd700',
             'circle-stroke-color': '#000', 'circle-stroke-width': 2,
             'circle-opacity': 1 },
  });

  // Tooltip on hover
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'maplibregl-popup' });
  map.on('mouseenter', 'missed-lyr', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    popup.setLngLat(e.features[0].geometry.coordinates)
         .setHTML('<b>Missed building</b><br>Not reached within shift')
         .addTo(map);
  });
  map.on('mouseleave', 'missed-lyr', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
  map.on('mouseenter', 'suggested-lyr', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const n = e.features[0].properties.serves;
    popup.setLngLat(e.features[0].geometry.coordinates)
         .setHTML(`<b>Suggested charger</b><br>Serves ~${n} missed buildings`)
         .addTo(map);
  });
  map.on('mouseleave', 'suggested-lyr', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
  map.on('mouseenter', 'existing-chargers-lyr', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'existing-chargers-lyr', () => { map.getCanvas().style.cursor = ''; });

  // Now load the first scenario
  initUI();
  loadScenario(0);
  // Kick the anim loop
  requestAnimationFrame(tick);
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function initUI() {
  const sel = document.getElementById('scenario-select');
  DATA.scenarios.forEach((s, i) => {
    const o = document.createElement('option'); o.value = i; o.textContent = s.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change', (e) => loadScenario(parseInt(e.target.value)));

  document.getElementById('play-btn').addEventListener('click', togglePlay);
  document.getElementById('reset-btn').addEventListener('click', reset);

  const slider = document.getElementById('time-slider');
  slider.addEventListener('input', (e) => {
    currentTimeSec = parseFloat(e.target.value) * shiftDurationSec;
    refreshAnimated();
    updateTimeDisplay();
  });

  document.querySelectorAll('.speed-row button').forEach(b => {
    b.addEventListener('click', () => {
      animSpeed = parseInt(b.dataset.speed);
      document.querySelectorAll('.speed-row button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  // Layer toggles
  const layerMap = {
    'lyr-trips':     ['trails-lyr', 'trails-glow', 'heads-lyr', 'heads-glow'],
    'lyr-routes':    ['full-routes-lyr'],
    'lyr-delivered': ['delivered-lyr'],
    'lyr-missed':    ['missed-lyr'],
    'lyr-chargers':  ['existing-chargers-lyr'],
    'lyr-suggested': ['suggested-lyr', 'suggested-glow'],
  };
  Object.entries(layerMap).forEach(([id, layers]) => {
    const el = document.getElementById(id);
    // Initial: 'lyr-routes' is off by default
    if (id === 'lyr-routes') el.checked = false;
    el.addEventListener('change', () => {
      const vis = el.checked ? 'visible' : 'none';
      layers.forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', vis));
    });
  });
}

function loadScenario(idx) {
  currentScenarioIdx = idx;
  const s = scenarioData();
  shiftDurationSec = s.params.shift_hours * 3600;
  currentTimeSec = 0;
  document.getElementById('time-slider').value = 0;

  // Parameter summary
  document.getElementById('param-summary').innerHTML =
    `<b>${s.params.n_vehicles}</b> vehicles · <b>${s.params.range_km}</b> km range · ` +
    `<b>${s.params.shift_hours}</b> h shift · <b>${s.params.avg_speed_kmh}</b> km/h`;

  // Stats
  document.getElementById('s-delivered').textContent = `${s.stats.buildings_delivered} / ${s.stats.buildings_in_day} (${s.stats.coverage_pct}%)`;
  document.getElementById('s-coverage').style.width = s.stats.coverage_pct + '%';
  document.getElementById('s-missed').textContent = s.stats.buildings_missed;
  document.getElementById('s-distance').textContent = s.stats.total_distance_km.toLocaleString() + ' km';
  document.getElementById('s-charges').textContent = s.stats.total_charging_stops;
  document.getElementById('s-suggested').textContent = s.stats.suggested_new_chargers;

  // Update sources
  map.getSource('full-routes').setData(tripsToLineStrings(s.trips));
  map.getSource('delivered').setData(pointsGeoJSON(s.delivered));
  map.getSource('missed').setData(pointsGeoJSON(s.missed));
  map.getSource('suggested').setData(pointsGeoJSON(s.suggested_chargers,
      p => ({ serves: p.serves_buildings })));
  refreshAnimated();
  updateTimeDisplay();
}

function refreshAnimated() {
  map.getSource('trails').setData(buildTrailsGeoJSON(currentTimeSec));
  map.getSource('heads').setData(buildHeadsGeoJSON(currentTimeSec));
}

function togglePlay() {
  playing = !playing;
  document.getElementById('play-btn').textContent = playing ? '❚❚ Pause' : '▶ Play';
  lastFrameTs = 0;
}

function reset() {
  currentTimeSec = 0;
  document.getElementById('time-slider').value = 0;
  refreshAnimated();
  updateTimeDisplay();
}

function updateTimeDisplay() {
  const cur = fmtTime(currentTimeSec);
  const tot = fmtTime(shiftDurationSec);
  document.getElementById('time-display').textContent = `${cur} / ${tot}`;
  document.getElementById('time-slider').value = currentTimeSec / shiftDurationSec;
}
function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function tick(ts) {
  if (playing) {
    if (lastFrameTs) {
      const dt = (ts - lastFrameTs) / 1000;
      currentTimeSec += dt * animSpeed;
      if (currentTimeSec >= shiftDurationSec) {
        currentTimeSec = shiftDurationSec;
        playing = false;
        document.getElementById('play-btn').textContent = '▶ Play';
      }
      refreshAnimated();
      updateTimeDisplay();
    }
    lastFrameTs = ts;
  } else {
    lastFrameTs = 0;
  }
  requestAnimationFrame(tick);
}
</script>
</body>
</html>
"""


def build_maplibre_html(
    scenarios_payloads: list[dict],
    depot: dict,
    chargers: pd.DataFrame,
    out_path: Path,
):
    """Write a single self-contained HTML file with all scenarios embedded."""
    data = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "depot": {"lon": depot["longitude"], "lat": depot["latitude"]},
        "existing_chargers": [
            {"lon": round(row["longitude"], 6), "lat": round(row["latitude"], 6)}
            for _, row in chargers.iterrows()
        ],
        "scenarios": scenarios_payloads,
    }
    data_json = json.dumps(data, separators=(",", ":"))
    html = _html_template().replace("__DATA_JSON__", data_json)
    out_path.write_text(html, encoding="utf-8")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    buildings, depot, chargers, roads, kunta = load_data()
    G = build_road_graph(roads, cache=DATA / "road_graph.pkl")

    all_scenarios_results = []
    scenarios_payloads: list[dict] = []

    for sc in SCENARIOS:
        r = run_scenario(sc, buildings, depot, chargers, G)
        all_scenarios_results.append(r)
        scenarios_payloads.append(scenario_to_payload(sc, r, depot, chargers))

    # Summary JSON
    summary = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "scenarios": [r["stats"] for r in all_scenarios_results],
    }
    summary_path = OUTPUT / "summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSummary written to {summary_path}")

    # Build the MapLibre HTML
    print("Building MapLibre HTML...")
    html_path = OUTPUT / "routing_map.html"
    build_maplibre_html(scenarios_payloads, depot, chargers, html_path)
    print(f"Map written to {html_path}")

    # Print final stats
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for s in summary["scenarios"]:
        print(f"\n{s['scenario']}:")
        print(f"  buildings: {s['buildings_delivered']}/{s['buildings_in_day']} delivered ({s['coverage_pct']}%)")
        print(f"  total distance: {s['total_distance_km']} km")
        print(f"  charging stops: {s['total_charging_stops']}")
        print(f"  suggested new chargers: {s['suggested_new_chargers']}")


if __name__ == "__main__":
    main()
