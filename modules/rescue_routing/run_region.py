"""Satellite-driven rescue routing CLI for regional flood response."""

import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import sys
import numpy as np

from modules.rescue_routing import (
    RescueRouter,
    VehicleType,
    generate_tactical_briefing,
    assign_fleet,
    estimate_needs,
)

from ingest.roads import load_roads
from ingest.satellite import load_satellite_mask
from ingest.edge_state import populate_edge_state
from ingest.snapping import snap_sites


def compute_sha256(filepath: str | Path | None) -> str:
    """Compute sha256 checksum of a file."""
    if not filepath or not Path(filepath).exists():
        return ""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def extract_flood_extent_geojson(
    water_mask: np.ndarray,
    transform: any,
    crs: any,
    max_vertices: int = 5000,
) -> dict:
    """Extract simplified GeoJSON MultiPolygon of water mask in EPSG:4326."""
    import rasterio.features
    from rasterio.warp import transform_geom

    shapes_gen = rasterio.features.shapes(
        water_mask.astype(np.uint8),
        mask=water_mask,
        transform=transform,
    )
    is_proj = getattr(crs, "is_projected", False)
    polygons = []
    total_vertices = 0

    for geom, val in shapes_gen:
        if val != 1:
            continue
        if is_proj:
            geom = transform_geom(crs, "EPSG:4326", geom)

        coords = geom.get("coordinates", [])
        if coords:
            polygons.append(coords)
            for ring in coords:
                total_vertices += len(ring)

    if not polygons:
        return {"type": "MultiPolygon", "coordinates": []}

    if total_vertices > max_vertices:
        step = int(math.ceil(total_vertices / max_vertices))
        decimated = []
        for poly in polygons:
            new_poly = []
            for ring in poly:
                if len(ring) <= 4:
                    new_poly.append(ring)
                else:
                    sub = ring[:-1:step]
                    if len(sub) < 3:
                        sub = ring[:-1]
                    sub.append(sub[0])
                    new_poly.append(sub)
            decimated.append(new_poly)
        polygons = decimated

    return {"type": "MultiPolygon", "coordinates": polygons}


def main():
    parser = argparse.ArgumentParser(description="Regional satellite-driven rescue routing pipeline")
    parser.add_argument("--mask", type=str, help="Path to water mask GeoTIFF/PNG/JPG")
    parser.add_argument("--sar", type=str, help="Path to Sentinel-1 VV backscatter GeoTIFF")
    parser.add_argument("--bounds", type=str, help="Bounding box W,S,E,N in WGS84")
    parser.add_argument("--permanent-water", type=str, help="Path to permanent water mask")
    parser.add_argument("--dem", type=str, help="Path to elevation GeoTIFF (Copernicus/SRTM)")
    parser.add_argument("--roads", type=str, required=True, help="Path to GeoJSON or .osm road network")
    parser.add_argument("--sites", type=str, required=True, help="Path to sites JSON")
    parser.add_argument("--acquired", type=str, help="Observation ISO8601 timestamp")
    parser.add_argument("--as-of", type=str, help="Planning ISO8601 timestamp")
    parser.add_argument("--out", type=str, default="routes.json", help="Output routes.json path")
    parser.add_argument("--rainfall", type=float, default=15.0, help="Rainfall rate in mm/h")
    parser.add_argument("--region", type=str, default="regional_deployment", help="Region identifier")

    args = parser.parse_args()

    # parse bounds if provided
    bounds = None
    if args.bounds:
        bounds = [float(x.strip()) for x in args.bounds.split(",")]

    # 1. Ingest roads and snap sites
    graph = load_roads(args.roads)
    site_map = snap_sites(graph, args.sites)

    # 2. Ingest satellite flood mask or SAR
    water_mask, nodata_mask, transform, crs, pixel_size_m, mask_source = load_satellite_mask(
        mask_path=args.mask,
        sar_path=args.sar,
        bounds=bounds,
    )

    # 3. Populate edge state (depth, distance to water, elevation, coverage)
    depth_method, risk_model = populate_edge_state(
        graph,
        water_mask,
        nodata_mask,
        transform,
        crs,
        pixel_size_m,
        dem_path=args.dem,
        permanent_water_path=args.permanent_water,
    )

    # 4. Data freshness computation
    depth_age_min = None
    data_freshness = "UNKNOWN"
    if args.acquired and args.as_of:
        try:
            t_acq = datetime.fromisoformat(args.acquired)
            t_asof = datetime.fromisoformat(args.as_of)
            depth_age_min = max(0.0, (t_asof - t_acq).total_seconds() / 60.0)
            data_freshness = "FRESH" if depth_age_min <= 180.0 else "STALE"
            depth_age_min = round(depth_age_min, 1)
        except Exception:
            data_freshness = "UNKNOWN"

    router = RescueRouter(graph)

    # 5. Scenarios execution
    bases = [s_id for s_id, s in site_map.items() if s.get("kind") == "base"]
    zones = [s_id for s_id, s in site_map.items() if s.get("kind") == "zone"]
    ramps = [s_id for s_id, s in site_map.items() if s.get("kind") == "ramp"]
    if not bases:
        bases = [list(site_map.keys())[0]]
    if not zones:
        zones = [s_id for s_id in site_map.keys() if s_id not in bases and s_id not in ramps]

    features = []
    scenarios = []

    def record_feature(res: dict, sc_id: str) -> int:
        geom = res.get("geojson_geometry")
        props = {k: v for k, v in res.items() if k != "geojson_geometry"}
        props["scenario_id"] = sc_id
        if "depth_source" not in props:
            props["depth_source"] = depth_method
        props["data_freshness"] = data_freshness
        if depth_age_min is not None:
            props["depth_age_min"] = depth_age_min
        feat = {
            "type": "Feature",
            "geometry": geom,
            "properties": props,
        }
        features.append(feat)
        return len(features) - 1

    # Baseline scenario: ambulance from each base to each zone at --rainfall
    for b in bases:
        for z in zones:
            res_base = router.find_route(
                b,
                z,
                VehicleType.AMBULANCE,
                rainfall_rate=args.rainfall,
                depth_source=depth_method,
                depth_age_min=depth_age_min,
            )
            sc_id = "scenario_1_baseline" if not scenarios else f"scenario_1_baseline_{b}_{z}"
            b_text, b_src = generate_tactical_briefing(res_base)
            idx_b = record_feature(res_base, sc_id)
            scenarios.append({
                "id": sc_id,
                "title": f"Baseline Ambulance Route ({args.rainfall:.0f} mm/h)",
                "feature_indices": [idx_b],
                "briefing": b_text,
                "briefing_source": b_src,
            })

    # Predictive scenario: rainfall 45, show detour if route flips
    for b in bases:
        for z in zones:
            res_pred = router.find_route(
                b,
                z,
                VehicleType.AMBULANCE,
                rainfall_rate=45.0,
                depth_source=depth_method,
                depth_age_min=depth_age_min,
            )
            sc_id = "scenario_2a_predictive_detour" if not any(s["id"].startswith("scenario_2a") for s in scenarios) else f"scenario_2a_predictive_{b}_{z}"
            b_text, b_src = generate_tactical_briefing(res_pred)
            idx_p = record_feature(res_pred, sc_id)
            scenarios.append({
                "id": sc_id,
                "title": "Predictive Flood Routing Detour (45 mm/h)",
                "feature_indices": [idx_p],
                "briefing": b_text,
                "briefing_source": b_src,
            })

    # Satellite cutoff: any zone unreachable for ambulance and truck gets boat/helicopter cascade
    for z in zones:
        for b in bases:
            res_amb = router.find_route(b, z, VehicleType.AMBULANCE, rainfall_rate=args.rainfall, depth_source=depth_method, depth_age_min=depth_age_min)
            res_trk = router.find_route(b, z, VehicleType.TRUCK_4X4, rainfall_rate=args.rainfall, depth_source=depth_method, depth_age_min=depth_age_min)
            if res_amb["status"] == "UNREACHABLE" and res_trk["status"] == "UNREACHABLE":
                sc_id = "scenario_5_full_cascade" if not any(s["id"] == "scenario_5_full_cascade" for s in scenarios) else f"scenario_cascade_{z}"
                cascade = router.plan_cascade(destination=z, rainfall_rate=args.rainfall, origin=b)
                f_indices = []
                attempts = []

                stg = 1
                res_amb["stage"] = stg
                res_amb["stage_title"] = "Ambulance"
                idx_amb = record_feature(res_amb, sc_id)
                f_indices.append(idx_amb)
                attempts.append({"vehicle_type": "AMBULANCE", "status": "UNREACHABLE", "reason": res_amb.get("reason", "Corridor blocked"), "feature_index": idx_amb, "stage": stg, "stage_title": "Ambulance", "blocked_edges": []})

                stg += 1
                res_trk["stage"] = stg
                res_trk["stage_title"] = "4x4 Truck"
                idx_trk = record_feature(res_trk, sc_id)
                f_indices.append(idx_trk)
                attempts.append({"vehicle_type": "TRUCK_4X4", "status": "UNREACHABLE", "reason": res_trk.get("reason", "Corridor blocked"), "feature_index": idx_trk, "stage": stg, "stage_title": "4x4 Truck", "blocked_edges": []})

                boat_r = cascade.get("routes", {}).get("RESCUE_BOAT")
                if boat_r and boat_r.get("status") == "OK":
                    stg += 1
                    boat_r["stage"] = stg
                    boat_r["stage_title"] = "Rescue Boat"
                    idx_boat = record_feature(boat_r, sc_id)
                    f_indices.append(idx_boat)
                    attempts.append({"vehicle_type": "RESCUE_BOAT", "status": "OK", "eta_minutes": boat_r.get("eta_minutes"), "feature_index": idx_boat, "stage": stg, "stage_title": "Rescue Boat", "blocked_edges": []})

                heli_r = cascade.get("routes", {}).get("HELICOPTER")
                if heli_r:
                    stg += 1
                    heli_r["stage"] = stg
                    heli_r["stage_title"] = "Helicopter"
                    idx_heli = record_feature(heli_r, sc_id)
                    f_indices.append(idx_heli)
                    attempts.append({"vehicle_type": "HELICOPTER", "status": heli_r.get("status"), "eta_minutes": heli_r.get("eta_minutes"), "feature_index": idx_heli, "stage": stg, "stage_title": "Helicopter", "selected": True, "blocked_edges": []})

                selected_idx = f_indices[-1] if f_indices else None
                b_text, b_src = generate_tactical_briefing(cascade.get("selected_route") or res_amb)
                scenarios.append({
                    "id": sc_id,
                    "title": f"Surface Corridors Cutoff - Cascade Dispatch to {z}",
                    "feature_indices": f_indices,
                    "selected_feature_index": selected_idx,
                    "attempts": attempts,
                    "briefing": b_text,
                    "briefing_source": b_src,
                })

    # Slider dataset across rainfall steps
    slider_queries = []
    for b in bases[:1]:
        for z in zones[:2]:
            slider_queries.append({"id": f"ambulance_{b}_{z}", "vehicle_type": "AMBULANCE", "origin": b, "destination": z, "multimodal": False})
            slider_queries.append({"id": f"truck_{b}_{z}", "vehicle_type": "TRUCK_4X4", "origin": b, "destination": z, "multimodal": False})
    if not slider_queries:
        slider_queries = [{"id": f"ambulance_{bases[0]}_{zones[0]}", "vehicle_type": "AMBULANCE", "origin": bases[0], "destination": zones[0], "multimodal": False}]

    slider_data = router.build_slider_dataset(
        queries=slider_queries,
        rainfall_steps=[0.0, 15.0, 30.0, 45.0, 60.0],
    )

    # Needs and dispatch for resident zones
    resident_zones = {s_id: s for s_id, s in site_map.items() if s.get("residents") is not None}
    if resident_zones:
        needs_data = {}
        incidents = []
        for s_id, s in resident_zones.items():
            c_pop = {s_id: {"residents": s["residents"], "share_elderly": 0.20, "share_infants": 0.08}}
            needs_data[s_id] = estimate_needs(s_id, exposure_fraction=0.5, days=3.0, custom_pop=c_pop)
            central = needs_data[s_id]["scenarios"]["central"]
            incidents.append({
                "id": s_id,
                "node": s_id,
                "priority": 5,
                "people": central["in_need"],
                "required_kg": central["total_payload_kg"],
                "deadline_min": 60,
            })
        fleet = [
            {"id": f"AMB_{b}", "vehicle_type": "AMBULANCE", "start_node": b} for b in bases
        ] + [
            {"id": f"TRUCK_{b}", "vehicle_type": "TRUCK_4X4", "start_node": b} for b in bases
        ]
        dispatch_res = assign_fleet(incidents, fleet, router, rainfall_rate=args.rainfall)
    else:
        needs_data = None
        dispatch_res = None

    # Top-level flood extent MultiPolygon
    flood_extent = extract_flood_extent_geojson(water_mask, transform, crs, max_vertices=5000)

    # Top-level network capped at 20000 features
    network_fc = router.export_network_geojson()

    # Provenance
    input_mask = args.mask if args.mask else args.sar
    provenance = {
        "generated_by": "HighWater Rescue Routing Engine Person 4",
        "code_version": "2.2.1",
        "network": f"osm_region_{args.region}",
        "coordinates_verified": False,
        "risk_model": risk_model,
        "geometry_quality": "osm_polyline",
        "benchmark": "none",
        "population": "local_sites_census" if resident_zones else "unspecified",
        "input_files": {
            "roads": compute_sha256(args.roads),
            "sites": compute_sha256(args.sites),
            "mask": compute_sha256(input_mask),
        },
        "deterministic_seed": 42,
        "region": args.region,
        "mask_source": mask_source,
        "mask_sha256": compute_sha256(input_mask),
        "dem_used": bool(args.dem and Path(args.dem).exists()),
        "depth_method": depth_method,
        "roads_source": str(Path(args.roads).name),
        "roads_sha256": compute_sha256(args.roads),
    }
    if args.acquired:
        provenance["acquired"] = args.acquired
    if args.as_of:
        provenance["as_of"] = args.as_of

    routes_out = {
        "schema_version": "2.3",
        "verified": False,
        "provenance": provenance,
        "type": "FeatureCollection",
        "features": features,
        "scenarios": scenarios,
        "flood_extent": flood_extent,
        "network": network_fc,
        "slider": slider_data,
        "dispatch": dispatch_res,
        "benchmark": None,
        "needs": needs_data,
    }

    out_p = Path(args.out)
    with open(out_p, "w", encoding="utf-8") as f:
        json.dump(routes_out, f, indent=2)

    print(f"SUCCESS: Regional rescue routes exported to {out_p} (schema 2.3, region: {args.region})")


if __name__ == "__main__":
    main()
