# Dernau Demo Dataset (SpaceNet 8)

This directory contains a contract-perfect, fully deterministic demonstration dataset generated from real SpaceNet 8 annotations covering the Dernau area (Ahr valley, Germany) following the June 2021 Western Europe floods.

## Source & Licensing

- **Dataset Source:** SpaceNet 8 Flood Detection Challenge, Germany training set (Dernau area).
- **Annotations License:** CC BY-SA 4.0.
- **Imagery:** Maxar Technologies imagery (CC BY-NC 4.0 in original dataset) is **not** redistributed here. Only derived vector outputs are included.
- **Attribution:** SpaceNet 8 (SpaceNet on Amazon Web Services), Maxar Technologies.

## Derivation Notes

- **Flood Extent (`flood_extent.geojson`):**
  There is no measured water boundary or flood raster in this dataset. The flood extent was derived by unioning and buffering (5.0m) ground-truth flooded building polygons and flooded road line segments.
- **Risk Scores & Levels (`zones.json`):**
  Risk scores and levels are **illustrative demo scores, not Member 3 (risk engine) outputs**.
  Derived using the documented demo formula:
  $$\text{score} = \left(0.40 \cdot \min\left(\frac{\text{flooded\_percent}}{20}, 1\right) + 0.35 \cdot \frac{\text{exposed\_buildings}}{\text{total\_buildings}} + 0.25 \cdot \frac{\text{flooded\_road\_length\_m}}{\text{road\_length\_m}}\right) \times 100$$
  Rounded to 1 decimal place.
  - `HIGH`: score $\ge 60$
  - `MEDIUM`: score $\ge 30$
  - `LOW`: score $< 30$
  - `UNKNOWN`: score is `null` when a zone has insufficient infrastructure data (e.g. no road data or no buildings).
- **Facilities (`facilities.geojson`):**
  Three simulated points (hospital, shelter, depot) placed in non-flooded areas inside the AOI. Provenance: `simulated`.
- **Routes (`routes.json`):**
  Two `OK` routes with geometry reused from real non-flooded road segments in `roads_status.geojson` with Haversine distance, and one `UNREACHABLE` route with `geometry: null`. `eta_minutes` is `null` (no fabricated speeds). Provenance: `simulated`.
- **AOI Location:**
  Dernau (Ahr valley), Rhineland-Palatinate, Germany (approx bbox `[7.015, 50.511]` to `[7.044, 50.531]`). The dashboard map must fit its bounds dynamically from the dataset.

## Required Edge Cases

1. **Zone with `geometry: null`:**
   - `zone-038` has `geometry: null` to verify that zones without spatial representation remain listed and selectable in the UI without crashing the Leaflet map.
2. **Zone with missing numeric field (`exposed_buildings: null`):**
   - `zone-005` has `exposed_buildings: null` to verify the UI displays "Not available" rather than falsely coercing missing data to 0.
3. **Zone with `UNKNOWN` risk level:**
   - `zone-018` has `risk_level: "UNKNOWN"` and `risk_score: null` because it contains no road data (`road_length_m === 0`, accessibility `UNKNOWN`).

## Dataset Statistics

- **Total Zones:** 38
  - `HIGH`: 4
  - `MEDIUM`: 4
  - `LOW`: 29
  - `UNKNOWN`: 1
- **Blocked Roads:** 45
- **Flood Polygons (valid inside AOI):** 194
- **Dropped Features:** 2 (2 flood polygons dropped for extending past the northern AOI bbox boundary)
- **Facilities:** 3
- **Routes:** 3 (2 OK, 1 UNREACHABLE)
- **Exposed Buildings:** 759
