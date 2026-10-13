# Chapter 08: Data Normalization Adapter & API Service Architecture

---

### 8.1 The Ingestion Challenge in Multi-Member Disaster Pipelines

In a multi-agent or multi-developer disaster response hackathon, four distinct technical workflows run concurrently:
* **Member 1 (Frontend):** Builds the dashboard shell, Leaflet map, and analytics.
* **Member 2 (Earth Observation / ML):** Produces flood inundation masks from SAR or optical satellite imagery (`flood_extent.geojson`).
* **Member 3 (Risk Prioritization Engine):** Runs multi-criteria decision algorithms, scoring vulnerability and population density (`zones.json`).
* **Member 4 (Routing & Logistics):** Computes graph traversals on OpenStreetMap networks, identifying closures and evacuation corridors (`blocked_roads.geojson`, `routes.json`, `facilities.geojson`).

#### The Problem:
Upstream backend payloads change frequently during active development. A teammate might rename `risk_score` to `score`, deliver coordinates as strings `"13.08, 80.27"`, or output unexpected risk labels like `"Severe"` or `"Catastrophic"`.
If frontend UI components consume raw backend payloads directly, a single schema change causes dozens of components to crash.

#### The Solution: The Anti-Corruption Adapter Pattern
```
[ Mock Local Fixtures ] ──┐
                          ├─► [ dashboardApi.js ] ──► [ dataAdapter.js ] ──► [ Immutable UI Model ]
[ Teammate REST / WS ]  ──┘                                                   │
                                                                              ├─► Summary Cards
                                                                              ├─► Leaflet Map
                                                                              ├─► Zone Table & Drawer
                                                                              └─► Recharts Analytics
```
The **Adapter Pattern** enforces strict separation: UI components only consume guaranteed, strongly-typed internal interfaces. The adapter absorbs all upstream schema instability.

---

### 8.2 Data Normalization Pipeline (`src/services/dataAdapter.js`)

```javascript
/**
 * Defensive Normalization Adapter for Disaster Feeds
 */

import { isValidLatLng, validatePolygonCoordinates } from '@/utils/coordinateValidator';

/**
 * Normalizes categorical risk strings to strict Enum: HIGH | MEDIUM | LOW | UNKNOWN
 */
export function normalizeRiskLevel(rawRisk) {
  if (!rawRisk || typeof rawRisk !== 'string') return 'UNKNOWN';
  const clean = rawRisk.trim().toUpperCase();

  if (['HIGH', 'CRITICAL', 'SEVERE', 'RED'].includes(clean)) return 'HIGH';
  if (['MEDIUM', 'MODERATE', 'ELEVATED', 'AMBER', 'YELLOW'].includes(clean)) return 'MEDIUM';
  if (['LOW', 'MINIMAL', 'GUARDED', 'GREEN'].includes(clean)) return 'LOW';

  return 'UNKNOWN';
}

/**
 * Normalizes numeric scores to a consistent 0 - 100 integer scale.
 * Detects 0.0 - 1.0 probability inputs and scales accordingly.
 */
export function normalizeScore(rawScore) {
  if (rawScore == null) return null;
  const num = typeof rawScore === 'string' ? parseFloat(rawScore) : Number(rawScore);
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;

  // If score is normalized between 0.0 and 1.0, convert to percentage
  if (num >= 0 && num <= 1.0 && num % 1 !== 0) {
    return Math.round(num * 100);
  }

  return Math.min(100, Math.max(0, Math.round(num)));
}

/**
 * Normalizes an array of zones or raw GeoJSON feature collection into UI entities
 */
export function normalizeZones(rawPayload) {
  if (!rawPayload) return { zonesList: [], zonesGeoJson: { type: 'FeatureCollection', features: [] } };

  // Handle both raw array of zone objects and GeoJSON FeatureCollection
  const items = Array.isArray(rawPayload) 
    ? rawPayload 
    : rawPayload.features 
      ? rawPayload.features 
      : [];

  const zonesList = [];
  const validFeatures = [];

  for (const item of items) {
    // Extract properties whether item is a GeoJSON feature or a raw record
    const props = item.properties || item;
    const geometry = item.geometry || props.geometry || null;

    const zone_id = String(props.zone_id || props.id || `ZONE-${Math.random().toString(36).substr(2, 6)}`);
    const name = props.name || props.zone_name || `Zone ${zone_id}`;
    const risk_level = normalizeRiskLevel(props.risk_level || props.risk || props.severity);
    const score = normalizeScore(props.score ?? props.risk_score);
    const exposed_buildings = typeof props.exposed_buildings === 'number' && props.exposed_buildings >= 0 
      ? props.exposed_buildings 
      : typeof props.building_count === 'number' 
        ? props.building_count 
        : null;

    const flooded_area_sqkm = typeof props.flooded_area_sqkm === 'number' ? props.flooded_area_sqkm : null;
    const flood_percentage = typeof props.flood_percentage === 'number' 
      ? Math.round(props.flood_percentage) 
      : null;

    const accessibility_status = ['ACCESSIBLE', 'CUT_OFF', 'CAUTION'].includes(props.accessibility_status)
      ? props.accessibility_status
      : 'UNKNOWN';

    const reasons = Array.isArray(props.reasons) 
      ? props.reasons.filter((r) => typeof r === 'string') 
      : [];

    let has_geometry = false;

    // Validate geometry if present
    if (geometry && geometry.type === 'Polygon' && geometry.coordinates) {
      const ringCheck = validatePolygonCoordinates(geometry.coordinates);
      if (ringCheck.valid) {
        has_geometry = true;
        validFeatures.push({
          type: 'Feature',
          geometry,
          properties: { zone_id, name, risk_level, score },
        });
      } else {
        console.warn(`Zone [${zone_id}] geometry discarded: ${ringCheck.error}`);
      }
    }

    zonesList.push({
      zone_id,
      name,
      risk_level,
      score,
      exposed_buildings,
      flooded_area_sqkm,
      flood_percentage,
      accessibility_status,
      reasons,
      has_geometry,
      provenance: props.provenance || 'DERIVED',
      lat: props.lat || null,
      lng: props.lng || null,
    });
  }

  return {
    zonesList,
    zonesGeoJson: {
      type: 'FeatureCollection',
      features: validFeatures,
    },
  };
}

/**
 * Normalizes Flood Extent GeoJSON
 */
export function normalizeFloodExtent(rawGeoJson) {
  if (!rawGeoJson || typeof rawGeoJson !== 'object') {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = (rawGeoJson.features || []).filter((f) => {
    return f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type);
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}
```

---

### 8.3 Data Service & Request Deduplication (`src/services/dashboardApi.js`)

Prevents redundant network traffic and race conditions when users repeatedly click the "Refresh" action:

```javascript
/**
 * Unified Dashboard API Service
 * Ingests mock fixtures or live teammate endpoints with deduplication.
 */

import { normalizeZones, normalizeFloodExtent } from './dataAdapter';

let inFlightPromise = null;

export const dashboardApi = {
  async fetchDashboardData() {
    // If a request is already in-flight, return the existing promise (Deduplication)
    if (inFlightPromise) {
      return inFlightPromise;
    }

    inFlightPromise = (async () => {
      try {
        const dataSource = import.meta.env.VITE_DATA_SOURCE || 'mock';
        let rawZones, rawFlood, rawRoads, rawFacilities, rawRoutes;

        if (dataSource === 'mock') {
          // Ingest local fixtures
          const [zonesRes, floodRes, roadsRes, facRes, routesRes] = await Promise.all([
            fetch('/mock/zones.json'),
            fetch('/mock/flood_extent.geojson'),
            fetch('/mock/blocked_roads.geojson'),
            fetch('/mock/facilities.geojson'),
            fetch('/mock/routes.json'),
          ]);

          rawZones = await zonesRes.json();
          rawFlood = await floodRes.json();
          rawRoads = await roadsRes.json();
          rawFacilities = await facRes.json();
          rawRoutes = await routesRes.json();
        } else {
          // Live API integration with teammate microservices
          const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
          const [zonesRes, floodRes, roadsRes, facRes, routesRes] = await Promise.all([
            fetch(`${baseUrl}/zones`),
            fetch(`${baseUrl}/flood-extent`),
            fetch(`${baseUrl}/roads/blocked`),
            fetch(`${baseUrl}/facilities`),
            fetch(`${baseUrl}/routes`),
          ]);

          rawZones = await zonesRes.json();
          rawFlood = await floodRes.json();
          rawRoads = await roadsRes.json();
          rawFacilities = await facRes.json();
          rawRoutes = await routesRes.json();
        }

        // Run through normalization adapter
        const { zonesList, zonesGeoJson } = normalizeZones(rawZones);
        const floodGeoJson = normalizeFloodExtent(rawFlood);

        // Compute telemetry age & freshness
        const generatedAt = rawZones.generated_at || new Date().toISOString();
        const staleThresholdMinutes = Number(import.meta.env.VITE_STALE_MINUTES) || 15;
        const ageMinutes = Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000);
        const isStale = ageMinutes > staleThresholdMinutes;

        return {
          dataMode: rawZones.data_mode || (import.meta.env.VITE_DATA_SOURCE === 'mock' ? 'demo' : 'live'),
          generatedAt,
          isStale,
          ageMinutes,
          zonesList,
          zonesGeoJson,
          floodGeoJson,
          blockedRoadsGeoJson: rawRoads,
          facilities: Array.isArray(rawFacilities) ? rawFacilities : rawFacilities.facilities || [],
          routes: rawRoutes || {},
        };
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  },
};
```
