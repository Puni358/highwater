# Member 1 Mock Fixtures Specification: Bengaluru Disaster Scenario
## Public Mock Datasets for Standalone Frontend Development (`public/mock-data/`)

---

### Overview

To ensure that Member 1 can build, test, and demonstrate the entire HighWater dashboard without waiting for backend services or other team members, deterministic mock fixtures representing a flood scenario in **Bengaluru, Karnataka** (Bellandur and Varthur lake overflow) are provided below.

These fixtures cover every edge case specified in the Member 1 product requirements:
1. At least one **HIGH**, **MEDIUM**, **LOW**, and **UNKNOWN** priority zone.
2. At least one zone with **no geometry** (tabular list only).
3. At least one zone with a **missing numeric field** (`null` values).
4. Strictly valid GeoJSON polygons (closed linear rings with `[longitude, latitude]` ordering).
5. Blocked road segments, rescue facilities, and evacuation routes.

---

### Fixture 1: `public/mock-data/zones.json`

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-10-13T10:00:00Z",
  "data_mode": "demo",
  "study_area": "Bengaluru, Karnataka",
  "summary_metrics": {
    "total_inundated_km2": 12.4,
    "high_priority_count": 8,
    "exposed_buildings_count": 1240,
    "blocked_roads_count": 5
  },
  "zones": [
    {
      "zone_id": "zone-001",
      "name": "Zone 001 - Bellandur Basin",
      "risk_level": "HIGH",
      "risk_score": 82,
      "flooded_percent": 68,
      "flooded_area_km2": 2.4,
      "exposed_buildings": 34,
      "accessibility": "LIMITED",
      "reasons": [
        "High flood coverage (68%)",
        "Many exposed buildings (34)",
        "Restricted arterial road accessibility"
      ]
    },
    {
      "zone_id": "zone-002",
      "name": "Zone 002 - Varthur Outflow",
      "risk_level": "MEDIUM",
      "risk_score": 54,
      "flooded_percent": 31,
      "flooded_area_km2": 1.1,
      "exposed_buildings": 12,
      "accessibility": "OPEN",
      "reasons": [
        "Moderate flood coverage along spillway",
        "Agricultural buffer absorbing runoff"
      ]
    },
    {
      "zone_id": "zone-003",
      "name": "Zone 003 - Indiranagar North",
      "risk_level": "LOW",
      "risk_score": 18,
      "flooded_percent": 8,
      "flooded_area_km2": 0.3,
      "exposed_buildings": 4,
      "accessibility": "OPEN",
      "reasons": [
        "Storm drains operating normally",
        "Minimal localized street water"
      ]
    },
    {
      "zone_id": "zone-004",
      "name": "Zone 004 - Outer Ring East",
      "risk_level": "UNKNOWN",
      "risk_score": null,
      "flooded_percent": null,
      "flooded_area_km2": null,
      "exposed_buildings": null,
      "accessibility": "UNKNOWN",
      "reasons": [
        "Telemetry link offline; awaiting drone recon flight"
      ]
    },
    {
      "zone_id": "zone-005",
      "name": "Zone 005 - Mahadevapura Lowlands",
      "risk_level": "HIGH",
      "risk_score": 91,
      "flooded_percent": 74,
      "flooded_area_km2": 3.8,
      "exposed_buildings": 68,
      "accessibility": "CUT_OFF",
      "reasons": [
        "Major residential inundation",
        "Access road completely submerged (> 1.2m)",
        "Elderly population density"
      ]
    },
    {
      "zone_id": "zone-006",
      "name": "Zone 006 - HSR Layout Sector 7",
      "risk_level": "MEDIUM",
      "risk_score": 48,
      "flooded_percent": 22,
      "flooded_area_km2": 0.8,
      "exposed_buildings": 19,
      "accessibility": "LIMITED",
      "reasons": [
        "Basement flooding in multi-story apartments",
        "Power substation precautionary shutdown"
      ]
    },
    {
      "zone_id": "zone-007",
      "name": "Zone 007 - Sarjapur Road Junction",
      "risk_level": "HIGH",
      "risk_score": 86,
      "flooded_percent": 58,
      "flooded_area_km2": 1.9,
      "exposed_buildings": 45,
      "accessibility": "CUT_OFF",
      "reasons": [
        "Key transport junction submerged",
        "Multiple stranded civilian vehicles"
      ]
    },
    {
      "zone_id": "zone-008",
      "name": "Zone 008 - Koramangala Valley",
      "risk_level": "LOW",
      "risk_score": 25,
      "flooded_percent": 12,
      "flooded_area_km2": 0.5,
      "exposed_buildings": 8,
      "accessibility": "OPEN",
      "reasons": [
        "Pumping stations operating at capacity",
        "Water receding"
      ]
    },
    {
      "zone_id": "zone-009",
      "name": "Zone 009 - Devanahalli Heights (Non-Spatial)",
      "risk_level": "LOW",
      "risk_score": 10,
      "flooded_percent": 0,
      "flooded_area_km2": 0.0,
      "exposed_buildings": 0,
      "accessibility": "OPEN",
      "reasons": [
        "High ground staging area; no GIS polygon shape"
      ]
    }
  ]
}
```

---

### Fixture 2: `public/mock-data/flood_extent.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "feature_id": "flood-001",
        "zone_id": "zone-001",
        "flood_status": "FLOODED",
        "water_depth_m": 1.4,
        "area_sqkm": 2.4
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [77.6600, 12.9300],
            [77.6850, 12.9300],
            [77.6850, 12.9550],
            [77.6600, 12.9550],
            [77.6600, 12.9300]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "feature_id": "flood-002",
        "zone_id": "zone-002",
        "flood_status": "FLOODED",
        "water_depth_m": 0.8,
        "area_sqkm": 1.1
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [77.7100, 12.9400],
            [77.7400, 12.9400],
            [77.7400, 12.9600],
            [77.7100, 12.9600],
            [77.7100, 12.9400]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "feature_id": "flood-003",
        "zone_id": "zone-005",
        "flood_status": "FLOODED",
        "water_depth_m": 1.8,
        "area_sqkm": 3.8
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [77.6800, 12.9800],
            [77.7150, 12.9800],
            [77.7150, 13.0050],
            [77.6800, 13.0050],
            [77.6800, 12.9800]
          ]
        ]
      }
    }
  ]
}
```

---

### Fixture 3: `public/mock-data/blocked_roads.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "road_id": "road-001",
        "road_name": "Outer Ring Road (EcoSpace Underpass)",
        "status": "BLOCKED",
        "water_depth_m": 1.5,
        "length_km": 1.8,
        "reason": "Underpass completely submerged"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [77.6750, 12.9250],
          [77.6820, 12.9320],
          [77.6880, 12.9380]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "road_id": "road-002",
        "road_name": "Sarjapur Main Road (Wipro Gate)",
        "status": "BLOCKED",
        "water_depth_m": 0.9,
        "length_km": 1.2,
        "reason": "Overflowing storm canal across roadway"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [77.6850, 12.9100],
          [77.6950, 12.9140]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "road_id": "road-003",
        "road_name": "Varthur Lake Spillway Road",
        "status": "BLOCKED",
        "water_depth_m": 1.1,
        "length_km": 2.0,
        "reason": "Embankment breach"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [77.7150, 12.9450],
          [77.7300, 12.9520]
        ]
      }
    }
  ]
}
```

---

### Fixture 4: `public/mock-data/facilities.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "facility_id": "fac-001",
        "name": "Command Post Alpha (HAL Sports Club)",
        "type": "COMMAND_POST",
        "capacity": 500,
        "occupancy": 120,
        "status": "ACTIVE"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [77.6650, 12.9600]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "facility_id": "fac-002",
        "name": "Community Relief Shelter #2 (Indiranagar)",
        "type": "SHELTER",
        "capacity": 800,
        "occupancy": 340,
        "status": "ACTIVE"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [77.6400, 12.9780]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "facility_id": "fac-003",
        "name": "Emergency Medical Staging (Whitefield)",
        "type": "MEDICAL",
        "capacity": 250,
        "occupancy": 95,
        "status": "ACTIVE"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [77.7500, 12.9700]
      }
    }
  ]
}
```

---

### Fixture 5: `public/mock-data/routes.json`

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-10-13T10:00:00Z",
  "active_routes": {
    "zone-001": {
      "route_id": "route-z001-to-fac001",
      "destination_facility_id": "fac-001",
      "destination_name": "Command Post Alpha (HAL Sports Club)",
      "status": "CLEAR",
      "distance_km": 4.8,
      "eta_minutes": 14,
      "coordinates": [
        [12.9300, 77.6600],
        [12.9380, 77.6620],
        [12.9480, 77.6630],
        [12.9600, 77.6650]
      ]
    },
    "zone-002": {
      "route_id": "route-z002-to-fac003",
      "destination_facility_id": "fac-003",
      "destination_name": "Emergency Medical Staging (Whitefield)",
      "status": "CLEAR",
      "distance_km": 3.2,
      "eta_minutes": 9,
      "coordinates": [
        [12.9400, 77.7100],
        [12.9550, 77.7300],
        [12.9700, 77.7500]
      ]
    },
    "zone-005": null,
    "zone-007": null
  }
}
```
*Notice:* For `zone-005` and `zone-007`, the route is `null` because they are marked `CUT_OFF`. The UI handles this cleanly by rendering an alert in the detail panel and drawing no polyline on the map.
