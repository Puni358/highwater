# Chapter 05: Zone Interactions & Bidirectional State Synchronization

---

### 5.1 The Two-Way Synchronization Paradigm

In geospatial command dashboards, spatial data (the map) and tabular data (the list) represent two views of the exact same operational entities.

```
       [ Click Map Polygon ]                           [ Click Table Row ]
                 │                                               │
                 ▼                                               ▼
       dispatch(selectZone)                            dispatch(selectZone)
                 │                                               │
                 └──────────────► [ selectedZoneId ] ◄───────────┘
                                         │
                    ┌────────────────────┴───────────────────┐
                    ▼                                        ▼
           [ Table / List View ]                     [ Map Engine ]
      - Highlight selected row                  - Thicken polygon border
      - Auto-scroll row into view               - Elevate polygon zIndex
      - Open detail drawer                      - flyToBounds(zoneGeometry)
```

To maintain high performance and prevent infinite loop rerenders, all components must share a single source of truth (`selectedZoneId`).

---

### 5.2 Map Center Controller Component (`MapCenterController.jsx`)

React Leaflet's `MapContainer` does not automatically react to prop changes for center and zoom after mounting. Instead, an imperative helper component placed inside `<MapContainer>` listens to `selectedZoneId` changes and smoothly animates the camera.

```jsx
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * Controller to fly map camera to the selected zone
 */
export function MapCenterController({ selectedZoneId, zonesGeoJson, zonesList }) {
  const map = useMap();
  const prevSelectedIdRef = useRef(null);

  useEffect(() => {
    // Only animate when the selection actually changes
    if (!selectedZoneId || selectedZoneId === prevSelectedIdRef.current) {
      prevSelectedIdRef.current = selectedZoneId;
      return;
    }

    prevSelectedIdRef.current = selectedZoneId;

    // Check if the zone has a spatial polygon in the GeoJSON
    if (zonesGeoJson?.features?.length) {
      const feature = zonesGeoJson.features.find(
        (f) => f.properties?.zone_id === selectedZoneId
      );

      if (feature && feature.geometry) {
        try {
          const geoJsonLayer = L.geoJSON(feature);
          const bounds = geoJsonLayer.getBounds();

          if (bounds.isValid()) {
            map.flyToBounds(bounds, {
              padding: [50, 50],
              maxZoom: 15,
              duration: 0.9,
              easeLinearity: 0.3,
            });
            return;
          }
        } catch (err) {
          console.warn(`Could not compute bounds for zone ${selectedZoneId}:`, err);
        }
      }
    }

    // Check if zone has lat/lng centroid point in the normalized list
    const zoneItem = zonesList.find((z) => z.zone_id === selectedZoneId);
    if (zoneItem?.lat != null && zoneItem?.lng != null) {
      map.flyTo([zoneItem.lat, zoneItem.lng], 14, { duration: 0.9 });
      return;
    }

    // Zone has NO geometry: Gracefully do nothing (no map crash)
    // The details panel will still display "No map shape"
  }, [selectedZoneId, zonesGeoJson, zonesList, map]);

  return null;
}
```

---

### 5.3 Auto-Scrolling List on Map Click

When an operator clicks a polygon on the map, the list row must highlight and automatically scroll into the operator's viewport:

```jsx
import React, { useEffect, useRef } from 'react';

export function ZoneRow({ zone, isSelected, onSelect }) {
  const rowRef = useRef(null);

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [isSelected]);

  return (
    <tr
      ref={rowRef}
      onClick={() => onSelect(zone.zone_id)}
      className={`cursor-pointer border-b transition-colors ${
        isSelected
          ? 'bg-blue-50 font-medium border-l-4 border-l-blue-600'
          : 'hover:bg-slate-50'
      }`}
    >
      {/* Row cells */}
    </tr>
  );
}
```

---

### 5.4 Search, Filter & Multi-Criteria Sorting Engine

In high-density floods with dozens or hundreds of sub-sectors, operators require instant filtering by risk level, search by ID or name, and sorting by severity or impact.

```javascript
/**
 * Filters and sorts zones deterministically with strict null-safety
 */
export function filterAndSortZones(zones, { searchQuery = '', riskFilter = 'ALL', sortBy = 'score' }) {
  if (!Array.isArray(zones)) return [];

  const query = searchQuery.trim().toLowerCase();

  // 1. Filtering Stage
  const filtered = zones.filter((zone) => {
    // Risk Level Match
    const level = (zone.risk_level || 'UNKNOWN').toUpperCase();
    if (riskFilter !== 'ALL' && level !== riskFilter) {
      return false;
    }

    // Text Search Match (Matches ID, Name, or Priority Reasons)
    if (query) {
      const idMatch = zone.zone_id?.toLowerCase().includes(query);
      const nameMatch = zone.name?.toLowerCase().includes(query);
      const reasonMatch = Array.isArray(zone.reasons) && zone.reasons.some((r) => r.toLowerCase().includes(query));

      if (!idMatch && !nameMatch && !reasonMatch) {
        return false;
      }
    }

    return true;
  });

  // 2. Sorting Stage (Null-safe: nulls and NaNs sort LAST)
  return filtered.sort((a, b) => {
    if (sortBy === 'score') {
      const scoreA = typeof a.score === 'number' && !Number.isNaN(a.score) ? a.score : -Infinity;
      const scoreB = typeof b.score === 'number' && !Number.isNaN(b.score) ? b.score : -Infinity;
      return scoreB - scoreA; // Descending
    }

    if (sortBy === 'buildings') {
      const bldA = typeof a.exposed_buildings === 'number' ? a.exposed_buildings : -Infinity;
      const bldB = typeof b.exposed_buildings === 'number' ? b.exposed_buildings : -Infinity;
      return bldB - bldA;
    }

    if (sortBy === 'flooded_area') {
      const areaA = typeof a.flooded_area_sqkm === 'number' ? a.flooded_area_sqkm : -Infinity;
      const areaB = typeof b.flooded_area_sqkm === 'number' ? b.flooded_area_sqkm : -Infinity;
      return areaB - areaA;
    }

    if (sortBy === 'name') {
      return (a.name || a.zone_id).localeCompare(b.name || b.zone_id);
    }

    return 0;
  });
}
```

---

### 5.5 Handling Non-Spatial Zones (FR-26)

In real disasters, emergency reports or satellite survey data often list newly identified zones (e.g., `"Sector-14B: Industrial Park"`) with operational metrics, but the vector GIS polygon has not yet been processed by the drone mapping pipeline.

#### Operational Rules:
1. **Never Drop from List:** A zone without geometry MUST remain fully visible, searchable, and sortable in the zone list.
2. **Visual Indicator:** The row displays a `"No map shape"` badge.
3. **Safe Interactivity:** Selecting the non-spatial zone opens the detail panel, highlights the row, and leaves the map view intact without firing null-pointer exceptions.
