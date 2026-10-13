# Chapter 02: Interactive Leaflet GIS Map Engine

---

### 2.1 WebGIS Foundations & Cartographic Standards

Building an emergency map interface requires strict adherence to geographic data standards and defensiveness against dirty telemetry.

#### Coordinate Reference Systems (CRS) & Projections
* **EPSG:4326 (WGS 84):** The standard coordinate representation for GPS telemetry, drone feeds, and GeoJSON. Units are decimal degrees. Latitude ranges from $[-90.0, 90.0]$ and Longitude ranges from $[-180.0, 180.0]$.
* **EPSG:3857 (Web Mercator):** The projected coordinate system used by web map tile servers (OpenStreetMap, Carto, Google Maps, Bing). Distance is projected in spherical meters.
* Leaflet handles the projection from EPSG:4326 to EPSG:3857 internally, **provided coordinates are passed in the correct format**.

#### The Latitude / Longitude Inversion Trap
* **GeoJSON Standard (RFC 7946):** Mandates coordinates in order `[Longitude, Latitude, Elevation]`, following Cartesian $(X, Y, Z)$ convention.
* **Leaflet Standard:** Mandates coordinates in order `[Latitude, Longitude]` or `L.latLng(lat, lng)`.
* **Risk:** Passing raw GeoJSON coordinate arrays into Leaflet utility functions (`L.polygon`, `L.latLngBounds`, `map.panTo`) without inversion results in coordinates swapping hemispheres (e.g., coordinates in India `[80.27, 13.08]` rendering in Antarctica/Indian Ocean `[80.27° N, 13.08° E]`).
* When using React Leaflet's `<GeoJSON />` component, Leaflet parses GeoJSON internally. However, for programmatic camera navigation (`flyToBounds`, custom markers, bounding box calculations), coordinate extraction must be strictly normalized.

---

### 2.2 Defensive Coordinate Validation (`src/utils/coordinateValidator.js`)

Before geometries reach map layers, an automated sanitizer inspects every point and ring:

```javascript
/**
 * GIS Coordinate Sanitizer and Geometry Validator
 * Guarantees zero Leaflet canvas crashes caused by corrupted drone feeds.
 */

export function isValidLatLng(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Normalizes GeoJSON [lng, lat] coordinate to Leaflet [lat, lng] array
 */
export function toLeafletLatLng(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const [lng, lat] = coord;
  if (!isValidLatLng(lat, lng)) return null;
  return [lat, lng];
}

/**
 * Validates a GeoJSON Polygon ring:
 * 1. Must contain at least 4 positions (triangle + closure).
 * 2. First position must match the last position (closed ring).
 * 3. All vertices must have valid numbers.
 */
export function validatePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { valid: false, error: 'Empty coordinate ring' };
  }

  const linearRing = coordinates[0];
  if (!Array.isArray(linearRing) || linearRing.length < 4) {
    return { valid: false, error: 'Linear ring must have at least 4 coordinates' };
  }

  const first = linearRing[0];
  const last = linearRing[linearRing.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    return { valid: false, error: 'Linear ring is not closed (first != last)' };
  }

  for (const point of linearRing) {
    if (!isValidLatLng(point[1], point[0])) {
      return { valid: false, error: `Invalid coordinate vertex: ${JSON.stringify(point)}` };
    }
  }

  return { valid: true, error: null };
}
```

---

### 2.3 The 5 Essential Overlay Layers

The HighWater map consists of a base tile layer plus five decoupled vector/overlay layers. Each overlay is rendered as an isolated React Leaflet component:

```
+-------------------------------------------------------------------------+
| Layer 5: Evacuation Routes (Polyline, Emerald, ETA tooltips)            |
+-------------------------------------------------------------------------+
| Layer 4: Rescue Facilities (SVG DivIcons, Shelter Capacity Popups)      |
+-------------------------------------------------------------------------+
| Layer 3: Blocked Roads (Dashed Red Lines, High-Visibility Casing)       |
+-------------------------------------------------------------------------+
| Layer 2: Risk-Zone Boundaries (Categorical Colors, Click-to-Select)     |
+-------------------------------------------------------------------------+
| Layer 1: Flood Inundation Extent (Semi-Transparent Blue Polygon)        |
+-------------------------------------------------------------------------+
| Base Layer: OpenStreetMap / Carto / Offline Grid TileLayer              |
+-------------------------------------------------------------------------+
```

#### Layer 1: Flood Inundation Extent (`FloodLayer.jsx`)
Visualizes current water bodies and drone-detected inundation areas.
```jsx
import React from 'react';
import { GeoJSON } from 'react-leaflet';
import { THEME } from '@/config/theme';

export function FloodLayer({ data }) {
  if (!data || !data.features || data.features.length === 0) return null;

  const style = {
    color: THEME.layers.floodExtent.color,
    fillColor: THEME.layers.floodExtent.fillColor,
    fillOpacity: THEME.layers.floodExtent.fillOpacity,
    weight: THEME.layers.floodExtent.weight,
    dashArray: '2, 4',
  };

  const onEachFeature = (feature, layer) => {
    const props = feature.properties || {};
    const depth = props.depth_meters != null ? `${props.depth_meters} m` : 'Unassessed';
    layer.bindTooltip(
      `<strong>Flood Water</strong><br/>Water Depth: ${depth}`,
      { sticky: true }
    );
  };

  return <GeoJSON key={JSON.stringify(data.features.length)} data={data} style={style} onEachFeature={onEachFeature} />;
}
```

#### Layer 2: Risk-Zone Boundaries (`RiskLayer.jsx`)
Color-coded boundaries by threat severity (HIGH, MEDIUM, LOW, UNKNOWN). Interactive polygon clicks fire the shared `onSelectZone` handler.
```jsx
import React from 'react';
import { GeoJSON } from 'react-leaflet';
import { THEME } from '@/config/theme';

export function RiskLayer({ zonesGeoJson, selectedZoneId, onSelectZone }) {
  if (!zonesGeoJson?.features?.length) return null;

  const getFeatureStyle = (feature) => {
    const riskLevel = feature.properties?.risk_level?.toUpperCase() || 'UNKNOWN';
    const isSelected = feature.properties?.zone_id === selectedZoneId;
    const themeRisk = THEME.risk[riskLevel] || THEME.risk.UNKNOWN;

    return {
      color: isSelected ? '#1E293B' : themeRisk.color,
      fillColor: themeRisk.fillColor,
      fillOpacity: isSelected 
        ? THEME.layers.riskZones.fillOpacitySelected 
        : THEME.layers.riskZones.fillOpacityDefault,
      weight: isSelected 
        ? THEME.layers.riskZones.weightSelected 
        : THEME.layers.riskZones.weightDefault,
      dashArray: riskLevel === 'UNKNOWN' ? THEME.layers.riskZones.dashArray : null,
    };
  };

  const onEachFeature = (feature, layer) => {
    const { zone_id, name, risk_level, score } = feature.properties || {};

    layer.bindTooltip(
      `<strong>${name || zone_id}</strong><br/>Risk: ${risk_level || 'UNKNOWN'} (${score ?? 'N/A'})`,
      { sticky: true }
    );

    layer.on({
      click: () => onSelectZone(zone_id),
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({ fillOpacity: 0.7 });
      },
      mouseout: (e) => {
        const l = e.target;
        l.setStyle(getFeatureStyle(feature));
      },
    });
  };

  return (
    <GeoJSON
      key={`risk-layer-${selectedZoneId}-${zonesGeoJson.features.length}`}
      data={zonesGeoJson}
      style={getFeatureStyle}
      onEachFeature={onEachFeature}
    />
  );
}
```

#### Layer 3: Blocked Road Segments (`RoadLayer.jsx`)
Draws damaged or submerged roadways using high-contrast dashed lines with a solid underlay casing.
```jsx
import React from 'react';
import { GeoJSON } from 'react-leaflet';
import { THEME } from '@/config/theme';

export function RoadLayer({ data }) {
  if (!data?.features?.length) return null;

  const style = {
    color: THEME.layers.blockedRoads.color,
    weight: THEME.layers.blockedRoads.weight,
    dashArray: THEME.layers.blockedRoads.dashArray,
    opacity: THEME.layers.blockedRoads.opacity,
    lineCap: 'round',
  };

  const onEachFeature = (feature, layer) => {
    const props = feature.properties || {};
    layer.bindTooltip(
      `<strong>Blocked Road:</strong> ${props.road_name || 'Segment'}<br/>Reason: ${props.reason || 'Submerged'}`,
      { sticky: true }
    );
  };

  return <GeoJSON data={data} style={style} onEachFeature={onEachFeature} />;
}
```

#### Layer 4: Rescue Facilities (`FacilityLayer.jsx`)
Custom SVG DivIcons representing staging zones, medical facilities, and shelters.
```jsx
import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { THEME } from '@/config/theme';

const createFacilityIcon = (type) => {
  return L.divIcon({
    className: 'custom-facility-pin',
    html: `
      <div style="background-color: ${THEME.layers.rescueFacilities.markerColor}; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid white;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v20M2 12h20"/>
        </svg>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};

export function FacilityLayer({ facilities }) {
  if (!facilities?.length) return null;

  return (
    <>
      {facilities.map((fac) => {
        if (!fac.lat || !fac.lng) return null;
        return (
          <Marker key={fac.id} position={[fac.lat, fac.lng]} icon={createFacilityIcon(fac.type)}>
            <Popup>
              <div className="text-xs p-1">
                <div className="font-bold text-slate-900">{fac.name}</div>
                <div className="text-slate-600 mt-0.5">Type: {fac.type || 'Shelter'}</div>
                <div className="text-slate-600">Capacity: {fac.capacity ? `${fac.occupancy ?? 0}/${fac.capacity}` : 'Not available'}</div>
                <div className="text-emerald-700 font-medium mt-1">Status: {fac.status || 'Active'}</div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
```

#### Layer 5: Safe Evacuation Routes (`RouteLayer.jsx`)
Renders calculated evacuation corridors. If a route cannot be found (e.g. zone is cut off), it renders nothing and reports status to the detail panel without breaking.
```jsx
import React from 'react';
import { Polyline, Tooltip } from 'react-leaflet';
import { THEME } from '@/config/theme';

export function RouteLayer({ activeRoute }) {
  if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) {
    return null;
  }

  // Active route coordinates normalized to [lat, lng] array
  const positions = activeRoute.coordinates.map((pt) => [pt[0], pt[1]]);

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: THEME.layers.evacuationRoutes.color,
        weight: THEME.layers.evacuationRoutes.weight,
        opacity: THEME.layers.evacuationRoutes.opacity,
      }}
    >
      <Tooltip sticky>
        <strong>Evacuation Route</strong>
        <br />
        Distance: {activeRoute.distance_km != null ? `${activeRoute.distance_km} km` : 'N/A'}
        <br />
        ETA: {activeRoute.eta_minutes != null ? `${activeRoute.eta_minutes} mins` : 'N/A'}
      </Tooltip>
    </Polyline>
  );
}
```

---

### 2.4 Handling Leaflet Edge Cases & Production Bugs

#### Bug 1: Container Resize Gray Area Bug
* **Symptom:** When the dashboard layout toggles (e.g., closing a sidebar, resizing browser, switching tabs), Leaflet fails to calculate its canvas pixel dimensions, leaving gray blank tiles.
* **Fix:** Mount a `MapResizer` hook using `ResizeObserver` that calls `map.invalidateSize()`:
```jsx
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

export function MapResizer() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (!container) return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ debounceMoveend: true });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}
```

#### Bug 2: Missing Tile Fallback (Offline / Field Mode)
When operating in remote or disconnected disaster zones, map tiles may fail to download. Leaflet by default shows ugly broken image icons.
* **Solution:** Intercept tile error events and render a clean, high-contrast grid fallback with a non-intrusive status warning:
```javascript
export function configureOfflineTileFallback(tileLayerInstance, onOfflineDetected) {
  tileLayerInstance.on('tileerror', (error, tile) => {
    // Replace broken image with 1x1 transparent pixel or neutral gray SVG pattern
    tile.src = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'%3E%3Crect width='256' height='256' fill='%23F1F5F9'/%3E%3Cpath d='M0 0h256v256H0z' stroke='%23E2E8F0' stroke-width='1' fill='none'/%3E%3C/svg%3E";
    if (onOfflineDetected) onOfflineDetected();
  });
}
```

#### Bug 3: Per-Layer Error Boundary
If an upstream team member delivers an unparseable feature geometry, it must never crash the entire page. Wrapping individual layers in React error boundaries guarantees partial degradation:
```jsx
import React from 'react';

export class LayerErrorBoundary extends React.Component {
  state = { hasError: false, errorMsg: '' };

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error.message };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`Layer [${this.props.layerName}] failed to render:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return null; // Gracefully suppress broken layer; UI can show a warning icon in legend
    }
    return this.props.children;
  }
}
```
