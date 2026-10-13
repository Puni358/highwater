# Chapter 06: Zone-Level Detail Panels & Explainability

---

### 6.1 The Role of the Detail Inspector

Once an incident commander identifies an area of interest on the map or list, the **Zone Detail Inspector** provides the granular intelligence needed for tactical dispatch:

```
+-------------------------------------------------------------------------+
| [HIGH RISK] Sector 4 - Riverbank North                     [X Deselect] |
| ID: ZONE-04 | Provenance: Observed SAR Telemetry                        |
+-------------------------------------------------------------------------+
|  Risk Score         Flood Coverage      Exposed Bldgs    Inundated Area |
|  88 / 100           64.5%               342 Units        4.2 km²        |
+-------------------------------------------------------------------------+
| Accessibility Status:                                                   |
| [!] CUT-OFF / ROAD BLOCKED                                              |
| No viable ground road detected. Water depth exceeds vehicle clearance.  |
| Recommended Dispatch: Amphibious / Boat or Drone Staging                |
+-------------------------------------------------------------------------+
| Priority Rationale & Explainability:                                    |
| • Submerged arterial bridge severed secondary access corridor           |
| • Vulnerable infrastructure: Children's hospital within 200m of crest   |
| • Inundation rising at +0.3m / hour based on upstream gauge telemetry   |
+-------------------------------------------------------------------------+
| Connected Route:                                                        |
| Primary Route: N/A (Blocked) | Nearest Staging: Shelter #2 (1.8 km)     |
+-------------------------------------------------------------------------+
```

---

### 6.2 Data Model & Attribute Specifications

A fully normalized zone detail object ingested by the component contains:

```typescript
interface ZoneDetail {
  zone_id: string;                      // Unique identifier
  name: string;                         // Human-readable title
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  score: number | null;                 // 0 - 100 or 0.0 - 1.0 normalized
  flood_percentage: number | null;      // Inundation fraction (0 - 100%)
  exposed_buildings: number | null;     // Count of structures affected
  flooded_area_sqkm: number | null;     // Surface area in square kilometers
  accessibility_status: 'ACCESSIBLE' | 'CUT_OFF' | 'CAUTION' | 'UNKNOWN';
  reasons: string[];                    // Array of explanatory factors
  provenance?: 'OBSERVED' | 'DERIVED' | 'SIMULATED';
  last_updated?: string;                // ISO 8601 timestamp
  has_geometry: boolean;                // Whether GIS polygon is available
}
```

---

### 6.3 Handling Missing Attributes & Nullability

In mission-critical disaster management:
* If `score` is `null`, render `"Not available"`, never `0`.
* If `flood_percentage` is `null`, render `"Unassessed"`.
* If `reasons` is empty or undefined, render `"No specific priority rationale provided by risk engine"`.
* If `accessibility_status` is missing, render `"Status unverified"`.

---

### 6.4 Detail Panel Component (`src/components/zones/ZoneDetails.jsx`)

```jsx
import React from 'react';
import { X, AlertCircle, CheckCircle2, ShieldAlert, Waves, Building, Clock, MapPin } from 'lucide-react';
import { THEME } from '@/config/theme';

export function ZoneDetails({ zone, activeRoute, onClose }) {
  if (!zone) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-400">
        <MapPin className="mb-3 h-10 w-10 text-slate-300 stroke-1" />
        <h4 className="text-sm font-semibold text-slate-600">No Zone Selected</h4>
        <p className="mt-1 text-xs text-slate-400 max-w-xs">
          Select a sector on the map or from the list to inspect risk metrics and evacuation status.
        </p>
      </div>
    );
  }

  const riskLevel = (zone.risk_level || 'UNKNOWN').toUpperCase();
  const themeRisk = THEME.risk[riskLevel] || THEME.risk.UNKNOWN;

  const accessStatusStyles = {
    ACCESSIBLE: { bg: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: CheckCircle2, label: 'Accessible' },
    CUT_OFF: { bg: 'bg-red-50 text-red-800 border-red-200', icon: ShieldAlert, label: 'Cut-Off / Inaccessible' },
    CAUTION: { bg: 'bg-amber-50 text-amber-800 border-amber-200', icon: AlertCircle, label: 'Hazardous / Caution' },
    UNKNOWN: { bg: 'bg-slate-50 text-slate-700 border-slate-200', icon: AlertCircle, label: 'Status Unverified' },
  };

  const accessInfo = accessStatusStyles[zone.accessibility_status] || accessStatusStyles.UNKNOWN;
  const AccessIcon = accessInfo.icon;

  return (
    <div className="flex h-full flex-col bg-white overflow-y-auto">
      {/* 1. Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold border ${themeRisk.badgeClass}`}>
                {themeRisk.label}
              </span>
              {zone.provenance && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 uppercase">
                  {zone.provenance}
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-lg font-bold text-slate-900">{zone.name || zone.zone_id}</h3>
            <span className="text-xs text-slate-500 font-mono">ID: {zone.zone_id}</span>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {/* 2. Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Risk Score</span>
            <div className="mt-1 text-xl font-black text-slate-900">
              {zone.score != null ? `${Math.round(zone.score)}` : 'Not available'}
              {zone.score != null && <span className="text-xs font-normal text-slate-400"> / 100</span>}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Flood Coverage</span>
            <div className="mt-1 text-xl font-black text-blue-600">
              {zone.flood_percentage != null ? `${zone.flood_percentage}%` : 'Unassessed'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Exposed Buildings</span>
            <div className="mt-1 text-xl font-black text-amber-600">
              {zone.exposed_buildings != null ? zone.exposed_buildings.toLocaleString() : 'Not available'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Inundated Area</span>
            <div className="mt-1 text-xl font-black text-slate-900">
              {zone.flooded_area_sqkm != null ? `${zone.flooded_area_sqkm} km²` : 'Not available'}
            </div>
          </div>
        </div>

        {/* 3. Accessibility & Routing Status */}
        <div className="rounded-lg border border-slate-200 p-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">Road & Access Status</span>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border ${accessInfo.bg}`}>
              <AccessIcon className="w-3.5 h-3.5" />
              <span>{accessInfo.label}</span>
            </div>
          </div>

          {activeRoute ? (
            <div className="mt-2 rounded bg-emerald-50/60 p-2.5 text-xs text-emerald-950 border border-emerald-200">
              <div className="font-semibold text-emerald-900">Active Evacuation Corridor:</div>
              <div className="mt-1 flex gap-4 text-emerald-800">
                <span>Distance: <strong>{activeRoute.distance_km ?? 'N/A'} km</strong></span>
                <span>Est. Transit: <strong>{activeRoute.eta_minutes ?? 'N/A'} mins</strong></span>
              </div>
            </div>
          ) : zone.accessibility_status === 'CUT_OFF' ? (
            <div className="mt-2 rounded bg-red-50 p-2.5 text-xs text-red-900 border border-red-200">
              No passable road corridor available. Ground vehicles cannot traverse this zone. Dispatch watercraft or air assets.
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500 italic">
              No active evacuation route assigned to this zone.
            </div>
          )}
        </div>

        {/* 4. Priority Rationale & Explainability */}
        <div>
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2">Priority Rationale & Factors</h4>
          {Array.isArray(zone.reasons) && zone.reasons.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-slate-700">
              {zone.reasons.map((reason, idx) => (
                <li key={idx} className="flex items-start gap-2 bg-slate-50 rounded p-2 border border-slate-100">
                  <span className="text-blue-500 font-bold">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400 italic bg-slate-50 p-2.5 rounded border border-slate-100">
              No specific priority rationale supplied by the risk scoring engine.
            </p>
          )}
        </div>

        {/* 5. Spatial Geometry Status */}
        {!zone.has_geometry && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
            <strong>Non-Spatial Entry:</strong> This zone is registered in the database but currently lacks GIS polygon boundaries. Map camera centering is disabled.
          </div>
        )}
      </div>
    </div>
  );
}
```
