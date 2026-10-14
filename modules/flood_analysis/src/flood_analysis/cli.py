"""CLI: python -m flood_analysis.cli --input data/raw --out output"""
import argparse
import json
import os

from flood_analysis import processor as proc


DERNAU_TILE_IDS = [
    f"0_{row}_{col}" for row in range(36, 42) for col in range(59, 63)
]


def run(
    input_dir,
    out_dir,
    tile_ids=None,
    dataset_name=None,
    hazard="flood",
    mmi_building=7.0,
    mmi_road=8.0,
):
    """tile_ids: explicit tile id list (e.g. a user's drawn-box selection) overrides
    the dynamic AOI auto-selection; None keeps canonical Dernau tiles for data/raw
    or dynamic selection for other datasets."""
    os.makedirs(out_dir, exist_ok=True)

    if hazard == "earthquake":
        from flood_analysis import eq_loader

        features = eq_loader.load_eq_features(
            input_dir, mmi_building=mmi_building, mmi_road=mmi_road
        )
        if not features:
            raise RuntimeError(f"No building/road features found in {input_dir}")

        aoi = proc.build_aoi(features)
        utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)

        flood_extent_utm = proc.derive_flood_extent(features, fwd)
        zones = proc.build_zones(features, aoi, fwd, inv, flood_extent_utm)

        flood_extent_geojson = proc.flood_extent_to_geojson(flood_extent_utm, inv, hazard=hazard)
        roads_geojson = proc.features_to_geojson(features, "road", inv)
        buildings_geojson = proc.features_to_geojson(features, "building", inv)

        buildings = [f for f in features if f.kind == "building"]
        roads = [f for f in features if f.kind == "road"]
        flooded_buildings = sum(1 for f in buildings if f.flooded)
        flooded_roads = sum(1 for f in roads if f.flooded)

        with open(f"{out_dir}/flood_extent.geojson", "w") as fh:
            json.dump(flood_extent_geojson, fh)
        with open(f"{out_dir}/roads_status.geojson", "w") as fh:
            json.dump(roads_geojson, fh)
        with open(f"{out_dir}/buildings_exposed.geojson", "w") as fh:
            json.dump(buildings_geojson, fh)
        with open(f"{out_dir}/zones.json", "w") as fh:
            json.dump(
                {
                    "schema_version": "1.0",
                    "source": "USGS ShakeMap + OpenStreetMap",
                    "crs": "EPSG:4326",
                    "zones": zones,
                },
                fh,
                indent=2,
            )

        minlon, minlat, maxlon, maxlat = aoi.bounds
        metadata = {
            "hazard": "earthquake",
            "event_id": "us6000jllz",
            "source": "USGS ShakeMap + OpenStreetMap",
            "dataset": "USGS ShakeMap us6000jllz + OpenStreetMap",
            "license": "USGS ShakeMap data is public domain (USGS / US Government); OpenStreetMap data is licensed under the Open Database License (ODbL).",
            "thresholds": {
                "mmi_building": mmi_building,
                "mmi_road": mmi_road,
            },
            "aoi_bbox_lonlat": [minlon, minlat, maxlon, maxlat],
            "input_crs": "EPSG:4326 (OpenStreetMap GeoJSON features and USGS ShakeMap grid)",
            "output_crs": "EPSG:4326 for GeoJSON outputs; EPSG " + utm_epsg.split(":")[1] + " used internally for area/length calculations",
            "label_semantics": (
                f"MMI (Modified Mercalli Intensity) sampled from USGS ShakeMap grid. "
                f"For buildings, sampled at centroid with threshold mmi >= {mmi_building}. "
                f"For roads, max MMI sampled along vertices with threshold mmi >= {mmi_road}."
            ),
            "flooded_attribute_definition": "flooded = (mmi >= threshold), acting as an exposed-to-damaging-shaking proxy (not confirmed structural damage)",
            "flood_extent_method": (
                "Derived from flagged exposed buildings (polygons) and flagged exposed roads (buffered by "
                + str(proc.ROAD_BUFFER_M)
                + "m), unioned and simplified in UTM."
            ),
            "grid_config": {"cell_size_m": proc.GRID_CELL_SIZE_M, "crs_used_for_grid": utm_epsg},
            "accessibility_thresholds": {
                "ACCESSIBLE": f"flooded_road_length / road_length < {proc.ACCESSIBILITY_THRESHOLDS['ACCESSIBLE']}",
                "PARTIAL": f"< {proc.ACCESSIBILITY_THRESHOLDS['PARTIAL']}",
                "BLOCKED": f">= {proc.ACCESSIBILITY_THRESHOLDS['PARTIAL']}",
                "UNKNOWN": "no road data in zone",
            },
            "area_length_method": "Computed in UTM zone " + utm_epsg + " (local projected CRS), not in degrees",
            "counts": {
                "total_buildings": len(buildings),
                "flooded_buildings": flooded_buildings,
                "total_roads": len(roads),
                "flooded_roads": flooded_roads,
                "zone_count": len(zones),
            },
            "limitations": [
                "MMI is a modelled shaking intensity, not measured damage.",
                "'flooded' flag means exposed-to-shaking proxy (hazard proxy, not confirmed damage).",
                "Roads flagged by shaking are not confirmed blocked.",
                "Single event: us6000jllz (Pazarcik earthquake, Kahramanmaras sequence, Feb 2023).",
            ],
        }
        with open(f"{out_dir}/metadata.json", "w") as fh:
            json.dump(metadata, fh, indent=2)

        return metadata, zones

    is_dernau = os.path.exists(os.path.join(input_dir, "annotations", "0_36_59.geojson"))
    default_name = "Germany (Dernau)" if is_dernau else (
        os.path.basename(os.path.normpath(input_dir)).replace("raw_", "").replace("_", " ") or "SN8 dataset"
    )
    dataset_name = dataset_name or default_name

    if tile_ids:
        aoi_tile_ids = tile_ids
    elif is_dernau:
        aoi_tile_ids = DERNAU_TILE_IDS
    else:
        aoi_tile_ids = proc.select_aoi_tile_ids(input_dir)

    features = proc.load_tile_features(input_dir, aoi_tile_ids)
    if not features:
        raise RuntimeError(f"No building/road features found for tiles {aoi_tile_ids}")

    aoi = proc.build_aoi(features)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)

    flood_extent_utm = proc.derive_flood_extent(features, fwd)
    zones = proc.build_zones(features, aoi, fwd, inv, flood_extent_utm)

    flood_extent_geojson = proc.flood_extent_to_geojson(flood_extent_utm, inv)
    roads_geojson = proc.features_to_geojson(features, "road", inv)
    buildings_geojson = proc.features_to_geojson(features, "building", inv)

    buildings = [f for f in features if f.kind == "building"]
    roads = [f for f in features if f.kind == "road"]
    flooded_buildings = sum(1 for f in buildings if f.flooded)
    flooded_roads = sum(1 for f in roads if f.flooded)

    with open(f"{out_dir}/flood_extent.geojson", "w") as fh:
        json.dump(flood_extent_geojson, fh)
    with open(f"{out_dir}/roads_status.geojson", "w") as fh:
        json.dump(roads_geojson, fh)
    with open(f"{out_dir}/buildings_exposed.geojson", "w") as fh:
        json.dump(buildings_geojson, fh)
    with open(f"{out_dir}/zones.json", "w") as fh:
        json.dump(
            {
                "schema_version": "1.0",
                "source": f"SpaceNet 8 {dataset_name}",
                "crs": "EPSG:4326",
                "zones": zones,
            },
            fh,
            indent=2,
        )

    minlon, minlat, maxlon, maxlat = aoi.bounds
    metadata = {
        "dataset": f"SpaceNet 8 Flood Detection Challenge, {dataset_name} training set",
        "license": "CC BY-SA 4.0 (annotations); Maxar imagery stated as CC BY-NC 4.0 in the SN8 paper — imagery itself is not redistributed here, only small derived vector outputs",
        "attribution": "SpaceNet 8 (SpaceNet on Amazon Web Services), Maxar Technologies",
        "aoi_tiles": aoi_tile_ids,
        "aoi_selection_method": (
            "User-drawn custom selection (explicit tile list)." if tile_ids else (
                f"Dynamically selected: a {proc.AOI_WINDOW_ROWS}x{proc.AOI_WINDOW_COLS} tile window "
                f"(>= {proc.AOI_MIN_TILES_PRESENT} tiles present) maximizing building+road density, "
                "required to contain both flooded and non-flooded buildings/roads. Not hardcoded per dataset."
            )
        ),
        "aoi_bbox_lonlat": [minlon, minlat, maxlon, maxlat],
        "input_crs": "OGC:CRS84 (lon/lat, equivalent to EPSG:4326) — annotation geojson files",
        "input_resolution": "vector annotations (no fixed raster resolution); PRE/POST tif imagery in the raw data is ~0.3-0.4m/pixel RGB, not used in this derivation",
        "output_crs": "EPSG:4326 for GeoJSON outputs; EPSG " + utm_epsg.split(":")[1] + " used internally for area/length calculations",
        "label_semantics": "Each annotation feature has 'building' or 'highway' tag (not both); 'flooded' == 'yes' means flooded, missing/None means not flooded. These are human-labelled ground truth, not model predictions.",
        "flooded_attribute_definition": "flooded = (properties.flooded == 'yes'), read directly from SN8 annotation geojson",
        "flood_extent_method": "No flood-extent raster exists in this dataset (PRE/POST tifs are plain RGB imagery). flood_extent.geojson is DERIVED from labelled flooded buildings (polygons) and labelled flooded roads (lines buffered by "
        + str(proc.ROAD_BUFFER_M)
        + "m), unioned and simplified. It is not a measured water boundary.",
        "exposed_buildings_definition": "Count of buildings in a zone with labelled flooded == 'yes' (ground truth label, not a flood-extent intersection, to avoid circularity with the derived flood extent)",
        "grid_config": {"cell_size_m": proc.GRID_CELL_SIZE_M, "crs_used_for_grid": utm_epsg},
        "accessibility_thresholds": {
            "ACCESSIBLE": f"flooded_road_length / road_length < {proc.ACCESSIBILITY_THRESHOLDS['ACCESSIBLE']}",
            "PARTIAL": f"< {proc.ACCESSIBILITY_THRESHOLDS['PARTIAL']}",
            "BLOCKED": f">= {proc.ACCESSIBILITY_THRESHOLDS['PARTIAL']}",
            "UNKNOWN": "no road data in zone",
        },
        "area_length_method": "Computed in UTM zone " + utm_epsg + " (local projected CRS), not in degrees",
        "counts": {
            "total_buildings": len(buildings),
            "flooded_buildings": flooded_buildings,
            "total_roads": len(roads),
            "flooded_roads": flooded_roads,
            "zone_count": len(zones),
        },
        "limitations": [
            "flood_extent.geojson is derived from labelled flooded buildings/roads, not a measured water boundary (no flood raster in this dataset).",
            f"AOI is a dynamically-selected {proc.AOI_WINDOW_ROWS}x{proc.AOI_WINDOW_COLS} tile block chosen for a mix of flooded/non-flooded features, not the full dataset extent.",
            "Dataset covers a single flood event; not generalizable without re-running the AOI selection per dataset.",
        ],
    }
    with open(f"{out_dir}/metadata.json", "w") as fh:
        json.dump(metadata, fh, indent=2)

    return metadata, zones


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/raw")
    parser.add_argument("--out", default="output")
    parser.add_argument("--tiles", default=None, help="Comma-separated explicit tile ids; default: dynamic AOI auto-selection")
    parser.add_argument("--hazard", choices=["flood", "earthquake"], default="flood", help="Hazard type: flood or earthquake (default: flood)")
    parser.add_argument("--mmi-building", type=float, default=7.0, help="MMI threshold for exposed buildings (default: 7.0)")
    parser.add_argument("--mmi-road", type=float, default=8.0, help="MMI threshold for exposed roads (default: 8.0)")
    args = parser.parse_args()
    tile_ids = args.tiles.split(",") if args.tiles else None
    metadata, zones = run(
        args.input,
        args.out,
        tile_ids=tile_ids,
        hazard=args.hazard,
        mmi_building=args.mmi_building,
        mmi_road=args.mmi_road,
    )
    print(f"Wrote {len(zones)} zones, {metadata['counts']} to {args.out}")


if __name__ == "__main__":
    main()
