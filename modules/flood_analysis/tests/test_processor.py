import json
import os
from pathlib import Path

import jsonschema
import pytest
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box

from flood_analysis import cli
from flood_analysis import processor as proc


def test_polygon_validity_after_union():
    from shapely.ops import unary_union

    p1 = box(0, 0, 10, 10)
    p2 = box(5, 5, 15, 15)
    merged = unary_union([p1, p2])
    assert merged.is_valid
    assert merged.area == pytest.approx(175.0)


def test_crs_conversion_to_lonlat_roundtrip():
    utm_epsg, fwd, inv = proc.to_utm_transformer(box(7.0, 50.5, 7.01, 50.51))
    lon, lat = 7.005, 50.505
    x, y = fwd.transform(lon, lat)
    lon2, lat2 = inv.transform(x, y)
    assert lon2 == pytest.approx(lon, abs=1e-6)
    assert lat2 == pytest.approx(lat, abs=1e-6)


def test_grid_zoning_skips_empty_cells():
    aoi = box(7.0, 50.5, 7.01, 50.51)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)
    building = proc.Feature(id="b1", kind="building", flooded=False, geometry=Point(7.0001, 50.5001).buffer(0.00005))
    zones = proc.build_zones([building], aoi, fwd, inv, None, cell_size_m=100.0)
    assert len(zones) == 1
    assert all(z["total_buildings"] + 0 >= 0 for z in zones)
    assert sum(z["total_buildings"] for z in zones) == 1


def test_accessibility_thresholds():
    assert proc.accessibility_for(None) == "UNKNOWN"
    assert proc.accessibility_for(0.05) == "ACCESSIBLE"
    assert proc.accessibility_for(0.5) == "PARTIAL"
    assert proc.accessibility_for(0.9) == "BLOCKED"
    assert proc.accessibility_for(0.09999) == "ACCESSIBLE"
    assert proc.accessibility_for(0.6) == "BLOCKED"


def test_derive_flood_extent_from_labelled_features():
    aoi = box(7.0, 50.5, 7.01, 50.51)
    _, fwd, inv = proc.to_utm_transformer(aoi)
    flooded_building = proc.Feature(
        id="b1", kind="building", flooded=True, geometry=Point(7.005, 50.505).buffer(0.0001)
    )
    dry_building = proc.Feature(
        id="b2", kind="building", flooded=False, geometry=Point(7.006, 50.506).buffer(0.0001)
    )
    flooded_road = proc.Feature(
        id="r1", kind="road", flooded=True, geometry=LineString([(7.002, 50.502), (7.003, 50.503)])
    )
    extent = proc.derive_flood_extent([flooded_building, dry_building, flooded_road], fwd)
    assert extent is not None
    assert extent.is_valid
    assert extent.area > 0


def test_derive_flood_extent_empty_when_nothing_flooded():
    aoi = box(7.0, 50.5, 7.01, 50.51)
    _, fwd, inv = proc.to_utm_transformer(aoi)
    dry_building = proc.Feature(
        id="b2", kind="building", flooded=False, geometry=Point(7.006, 50.506).buffer(0.0001)
    )
    assert proc.derive_flood_extent([dry_building], fwd) is None


def test_load_tile_features_synthetic(tmp_path):
    ann_dir = tmp_path / "annotations"
    ann_dir.mkdir(parents=True)

    features_t1 = [
        {
            "type": "Feature",
            "properties": {"id": "b1", "building": "residential", "flooded": "yes"},
            "geometry": {"type": "Polygon", "coordinates": [[[7.0, 50.5], [7.001, 50.5], [7.001, 50.501], [7.0, 50.501], [7.0, 50.5]]]}
        },
        {
            "type": "Feature",
            "properties": {"id": "b2", "building": "commercial", "flooded": "no"},
            "geometry": {"type": "Polygon", "coordinates": [[[7.002, 50.5], [7.003, 50.5], [7.003, 50.501], [7.002, 50.501], [7.002, 50.5]]]}
        },
        {
            "type": "Feature",
            "properties": {"id": "b3", "building": "industrial", "flooded": None},
            "geometry": {"type": "Polygon", "coordinates": [[[7.004, 50.5], [7.005, 50.5], [7.005, 50.501], [7.004, 50.501], [7.004, 50.5]]]}
        },
        {
            "type": "Feature",
            "properties": {"id": "empty_feat", "building": "house"},
            "geometry": {"type": "GeometryCollection", "geometries": []}
        },
        {
            "type": "Feature",
            "properties": {"id": "poi1", "amenity": "parking"},
            "geometry": {"type": "Point", "coordinates": [7.006, 50.506]}
        },
        {
            "type": "Feature",
            "properties": {"highway": "primary", "flooded": "yes"},
            "geometry": {"type": "LineString", "coordinates": [[7.001, 50.501], [7.002, 50.502]]}
        }
    ]
    with open(ann_dir / "tile_1.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": features_t1}, f)

    features_t2 = [
        {
            "type": "Feature",
            "properties": {"id": "b1", "building": "duplicate", "flooded": "no"},
            "geometry": {"type": "Polygon", "coordinates": [[[7.0, 50.5], [7.001, 50.5], [7.001, 50.501], [7.0, 50.501], [7.0, 50.5]]]}
        }
    ]
    with open(ann_dir / "tile_2.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": features_t2}, f)

    loaded = proc.load_tile_features(str(tmp_path), ["tile_1", "tile_2"])

    b1_list = [f for f in loaded if f.id == "b1"]
    assert len(b1_list) == 1
    assert b1_list[0].flooded is True

    b2_list = [f for f in loaded if f.id == "b2"]
    assert len(b2_list) == 1
    assert b2_list[0].flooded is False

    b3_list = [f for f in loaded if f.id == "b3"]
    assert len(b3_list) == 1
    assert b3_list[0].flooded is False

    assert not any(f.id == "empty_feat" for f in loaded)
    assert not any(f.id == "poi1" for f in loaded)

    wkb_roads = [f for f in loaded if f.kind == "road"]
    assert len(wkb_roads) == 1
    assert wkb_roads[0].id.startswith("road-")
    assert wkb_roads[0].flooded is True


def test_build_zones_synthetic():
    aoi = box(7.00, 50.50, 7.02, 50.52)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)

    # Zone with buildings but NO roads -> accessibility == "UNKNOWN"
    b_no_roads = proc.Feature(
        id="b_noroad",
        kind="building",
        flooded=False,
        geometry=box(7.001, 50.501, 7.002, 50.502)
    )

    # Verify accessibility at exact 0.10 and 0.60 boundaries
    assert proc.accessibility_for(0.10) == "PARTIAL"
    assert proc.accessibility_for(0.0999) == "ACCESSIBLE"
    assert proc.accessibility_for(0.60) == "BLOCKED"
    assert proc.accessibility_for(0.5999) == "PARTIAL"
    assert proc.accessibility_for(None) == "UNKNOWN"

    b_flooded = proc.Feature(
        id="b_fl",
        kind="building",
        flooded=True,
        geometry=box(7.010, 50.510, 7.011, 50.511)
    )
    b_dry = proc.Feature(
        id="b_dry",
        kind="building",
        flooded=False,
        geometry=box(7.012, 50.510, 7.013, 50.511)
    )
    r1 = proc.Feature(
        id="r1",
        kind="road",
        flooded=False,
        geometry=LineString([(7.010, 50.510), (7.015, 50.510)])
    )

    flood_extent_utm = proc.derive_flood_extent([b_flooded], fwd)
    features = [b_no_roads, b_flooded, b_dry, r1]

    zones = proc.build_zones(features, aoi, fwd, inv, flood_extent_utm, cell_size_m=500.0)

    assert len(zones) >= 2
    for z in zones:
        # exposed_buildings <= total_buildings
        assert z["exposed_buildings"] <= z["total_buildings"]
        # 0 <= flooded_percent <= 100
        assert 0.0 <= z["flooded_percent"] <= 100.0
        # Edge cells clipped to the AOI: zone bbox coordinates stay within AOI bounds (0.0005 deg UTM reprojection tolerance)
        minlon, minlat, maxlon, maxlat = z["bbox"]
        assert minlon >= aoi.bounds[0] - 0.0005
        assert minlat >= aoi.bounds[1] - 0.0005
        assert maxlon <= aoi.bounds[2] + 0.0005
        assert maxlat <= aoi.bounds[3] + 0.0005

    # UNKNOWN when a zone has buildings but no roads
    zone_no_roads = [z for z in zones if z["total_buildings"] > 0 and z["road_length_m"] == 0]
    assert len(zone_no_roads) >= 1
    for z in zone_no_roads:
        assert z["accessibility"] == "UNKNOWN"

    # Empty cells skipped: grid has ~15 potential cells, but only occupied ones are returned
    assert len(zones) < 15


def test_flood_extent_to_geojson_synthetic():
    aoi = box(7.0, 50.5, 7.01, 50.51)
    _, _, inv = proc.to_utm_transformer(aoi)

    # Empty extent (None)
    fc_none = proc.flood_extent_to_geojson(None, inv)
    assert fc_none["type"] == "FeatureCollection"
    assert fc_none["features"] == []

    # Empty Polygon
    fc_empty = proc.flood_extent_to_geojson(Polygon(), inv)
    assert fc_empty["type"] == "FeatureCollection"
    assert fc_empty["features"] == []

    # Polygon
    poly_utm = box(358000, 5596000, 358500, 5596500)
    fc_poly = proc.flood_extent_to_geojson(poly_utm, inv)
    assert fc_poly["type"] == "FeatureCollection"
    assert len(fc_poly["features"]) == 1
    assert fc_poly["features"][0]["geometry"]["type"] == "Polygon"
    assert fc_poly["features"][0]["properties"]["label_class"] == "derived_flood_extent"

    # MultiPolygon
    p1 = box(358000, 5596000, 358200, 5596200)
    p2 = box(358300, 5596300, 358500, 5596500)
    mp_utm = MultiPolygon([p1, p2])
    fc_mp = proc.flood_extent_to_geojson(mp_utm, inv)
    assert fc_mp["type"] == "FeatureCollection"
    assert len(fc_mp["features"]) == 2
    for feat in fc_mp["features"]:
        assert feat["geometry"]["type"] == "Polygon"


def test_select_aoi_tile_ids_synthetic(tmp_path):
    ann_dir = tmp_path / "annotations"
    ann_dir.mkdir(parents=True)

    # Case 1: Window with flooded/dry mix
    with open(ann_dir / "0_0_0.geojson", "w") as f:
        json.dump({
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"building": "yes", "flooded": "no"}, "geometry": {"type": "Point", "coordinates": [7.0, 50.5]}}]
        }, f)
    with open(ann_dir / "0_0_1.geojson", "w") as f:
        json.dump({
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"building": "yes", "flooded": "yes"}, "geometry": {"type": "Point", "coordinates": [7.01, 50.5]}}]
        }, f)
    with open(ann_dir / "0_1_0.geojson", "w") as f:
        json.dump({
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"highway": "yes", "flooded": "no"}, "geometry": {"type": "LineString", "coordinates": [[7.0, 50.5], [7.01, 50.5]]}}]
        }, f)
    with open(ann_dir / "0_1_1.geojson", "w") as f:
        json.dump({
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"building": "yes", "flooded": "no"}, "geometry": {"type": "Point", "coordinates": [7.01, 50.51]}}]
        }, f)

    picked = proc.select_aoi_tile_ids(str(tmp_path), window_rows=2, window_cols=2, min_tiles_present=3)
    assert len(picked) == 4
    assert "0_0_0" in picked
    assert "0_0_1" in picked

    # Case 2: No mix (all dry) -> raises RuntimeError
    dry_dir = tmp_path / "all_dry"
    (dry_dir / "annotations").mkdir(parents=True)
    for r in range(2):
        for c in range(2):
            with open(dry_dir / "annotations" / f"0_{r}_{c}.geojson", "w") as f:
                json.dump({
                    "type": "FeatureCollection",
                    "features": [{"type": "Feature", "properties": {"building": "yes", "flooded": "no"}, "geometry": {"type": "Point", "coordinates": [7.0, 50.5]}}]
                }, f)
    with pytest.raises(RuntimeError, match="No 2x2 tile window"):
        proc.select_aoi_tile_ids(str(dry_dir), window_rows=2, window_cols=2, min_tiles_present=3)


def test_cli_run_end_to_end_and_schema(tmp_path):
    input_dir = tmp_path / "synthetic_raw"
    ann_dir = input_dir / "annotations"
    ann_dir.mkdir(parents=True)
    out_dir = tmp_path / "out"

    features = [
        {
            "type": "Feature",
            "properties": {"id": "b1", "building": "yes", "flooded": "yes"},
            "geometry": {"type": "Polygon", "coordinates": [[[7.001, 50.501], [7.003, 50.501], [7.003, 50.503], [7.001, 50.503], [7.001, 50.501]]]}
        },
        {
            "type": "Feature",
            "properties": {"id": "b2", "building": "yes", "flooded": "no"},
            "geometry": {"type": "Polygon", "coordinates": [[[7.005, 50.505], [7.007, 50.505], [7.007, 50.507], [7.005, 50.507], [7.005, 50.505]]]}
        },
        {
            "type": "Feature",
            "properties": {"id": "r1", "highway": "residential", "flooded": "yes"},
            "geometry": {"type": "LineString", "coordinates": [[7.001, 50.501], [7.005, 50.505]]}
        },
        {
            "type": "Feature",
            "properties": {"id": "r2", "highway": "residential", "flooded": "no"},
            "geometry": {"type": "LineString", "coordinates": [[7.005, 50.505], [7.009, 50.509]]}
        }
    ]
    with open(ann_dir / "syn_0_0.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)

    metadata, zones = cli.run(str(input_dir), str(out_dir), tile_ids=["syn_0_0"], dataset_name="Synthetic Test")

    assert os.path.exists(out_dir / "flood_extent.geojson")
    assert os.path.exists(out_dir / "roads_status.geojson")
    assert os.path.exists(out_dir / "buildings_exposed.geojson")
    assert os.path.exists(out_dir / "zones.json")
    assert os.path.exists(out_dir / "metadata.json")

    with open(out_dir / "zones.json") as f:
        zones_data = json.load(f)

    schema_path = Path(__file__).resolve().parent.parent / "contracts" / "zones.schema.json"
    assert schema_path.exists(), "contracts/zones.schema.json must exist"
    with open(schema_path) as f:
        schema = json.load(f)

    jsonschema.validate(instance=zones_data, schema=schema)


def test_building_double_counting_straddling_cells():
    aoi = box(7.000, 50.500, 7.004, 50.502)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)
    aoi_utm = proc._reproject(aoi, fwd)
    minx, miny, maxx, maxy = aoi_utm.bounds

    boundary_x = minx + 100.0
    center_y = miny + 50.0
    b_poly_utm = box(boundary_x - 20.0, center_y - 20.0, boundary_x + 20.0, center_y + 20.0)
    b_poly_lonlat = proc._reproject(b_poly_utm, inv)

    building = proc.Feature(id="straddling_b", kind="building", flooded=False, geometry=b_poly_lonlat)
    zones = proc.build_zones([building], aoi, fwd, inv, None, cell_size_m=100.0)

    # 1 unique building: sum of total_buildings across all zones must equal 1
    assert sum(z["total_buildings"] for z in zones) == 1


def test_straddling_road_length_split_across_cells():
    aoi = box(7.000, 50.500, 7.004, 50.502)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)
    aoi_utm = proc._reproject(aoi, fwd)
    minx, miny, maxx, maxy = aoi_utm.bounds

    boundary_x = minx + 100.0
    center_y = miny + 50.0
    road_poly_utm = LineString([(boundary_x - 30.0, center_y), (boundary_x + 30.0, center_y)])
    road_lonlat = proc._reproject(road_poly_utm, inv)

    road = proc.Feature(id="straddling_r", kind="road", flooded=False, geometry=road_lonlat)
    zones = proc.build_zones([road], aoi, fwd, inv, None, cell_size_m=100.0)

    # Road spans 2 zones
    assert len(zones) == 2
    for z in zones:
        assert z["road_length_m"] > 0
    # Clipped lengths sum to the full 60m road length
    assert sum(z["road_length_m"] for z in zones) == pytest.approx(60.0, abs=0.1)


def test_flooded_area_and_percent_consistent_zero_when_no_flood():
    aoi = box(7.000, 50.500, 7.002, 50.502)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)
    dry_b = proc.Feature(id="dry1", kind="building", flooded=False, geometry=Point(7.001, 50.501).buffer(0.0001))

    flood_extent_utm = proc.derive_flood_extent([dry_b], fwd)
    assert flood_extent_utm is None

    zones = proc.build_zones([dry_b], aoi, fwd, inv, flood_extent_utm, cell_size_m=100.0)
    assert len(zones) >= 1
    for z in zones:
        assert z["flooded_percent"] == 0.0
        assert z["flooded_area_m2"] == 0.0


def test_reproject_coordinates_accuracy():
    from shapely.ops import transform as old_shp_transform
    import warnings

    aoi = box(7.000, 50.500, 7.020, 50.520)
    utm_epsg, fwd, inv = proc.to_utm_transformer(aoi)

    # 20 fixed coordinates across the test region
    coords = [
        (7.000 + i * 0.001, 50.500 + i * 0.001) for i in range(20)
    ]
    assert len(coords) == 20

    for lon, lat in coords:
        pt = Point(lon, lat)
        # Suppress deprecation warning only inside the legacy reference comparison
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=DeprecationWarning)
            old_utm = old_shp_transform(fwd.transform, pt)
        new_utm = proc._reproject(pt, fwd)

        assert abs(old_utm.x - new_utm.x) < 1e-6
        assert abs(old_utm.y - new_utm.y) < 1e-6

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=DeprecationWarning)
            old_lonlat = old_shp_transform(inv.transform, old_utm)
        new_lonlat = proc._reproject(new_utm, inv)

        assert abs(old_lonlat.x - new_lonlat.x) < 1e-6
        assert abs(old_lonlat.y - new_lonlat.y) < 1e-6


