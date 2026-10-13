# HighWater — Member 1: Complete Frontend & Dashboard Specification & Research
## Role: Frontend & Dashboard Lead (Standalone Execution & Interface Guide)

---

### Executive Overview & Ownership Boundary

Member 1 owns the **entire user-facing interface of HighWater**. 
The dashboard must run, demo, and test **completely independently** on deterministic mock fixtures in `modules/dashboard/` without requiring the flood analysis, risk engine, routing module, or backend server to be built or running.

```
+---------------------------------------------------------------------------------------------------------+
|                                    MEMBER 1 OWNERSHIP MATRIX                                            |
+---------------------------------------------------------------------------------------------------------+
| WHAT MEMBER 1 OWNS (100% IN SCOPE)                  | WHAT MEMBER 1 DOES NOT OWN (STRICTLY OUT OF SCOPE)|
+-----------------------------------------------------+---------------------------------------------------+
| 1. Frontend project setup & application layout       | 1. Detecting floods from satellite images / SAR   |
| 2. Interactive Leaflet map & independent map layers | 2. Training or running AI/ML models               |
| 3. Flood visualization, legends & layer controls     | 3. Calculating the official risk-scoring formula  |
| 4. Four dashboard summary cards & Recharts analytics| 4. Computing rescue routes or graph optimization  |
| 5. Zone selection, filtering & details panel        | 5. Implementing backend endpoints, DBs or servers |
| 6. Risk-level colors and priority displays           | 6. Collecting or validating raw flood hydrology   |
| 7. Route & road closure polylines when provided      |                                                   |
| 8. Loading, empty, error, stale & responsive states |                                                   |
| 9. Mock datasets, UI tests, and frontend docs        | Member 1 DISPLAYS these outputs, NEVER generates  |
+-----------------------------------------------------+---------------------------------------------------+
```

---

### 1. Technology Stack Selection (Lightweight & Focused)

| Technology | Purpose in Dashboard | Why This & Not Alternatives |
| :--- | :--- | :--- |
| **React + Vite** | SPA application framework, component tree, fast HMR dev server | Sub-second builds; no heavy Next.js/SSR complexity for drone units. |
| **Leaflet + React Leaflet** | 2D base map tiles, zoom/pan, GeoJSON layers, markers, popups, route polylines | Lightweight (~40KB gzip), rock-solid stability; avoids 3D globe / WebGL GPU overhead. |
| **Tailwind CSS** | Responsive layout (desktop, tablet, mobile), spacing, typography, design tokens | Zero CSS runtime overhead; consistent design tokens; no bloated CSS-in-JS. |
| **Recharts** | Risk distribution bar chart, cross-zone building exposure comparison | Native React SVG declarative charting; lightweight, responsive, accessible. |
| **lucide-react** | Clean emergency, map, navigation, and state icons | Tree-shakeable, uniform stroke widths. |
| **Vitest + RTL** | Fast unit and component test suites (adapter, selectors, search/filter) | Native Vite integration, `jsdom` execution without Babel configuration hurdles. |
| **State Management** | React `useState` / custom hooks (`useDashboardData`, `useMapLayers`) | **No Redux / Zustand required**. State stays simple, predictable, and single-sourced. |

---

### 2. Exact Dashboard Layout & Component Architecture

Target layout matches the desktop emergency control room specifications:

```
+---------------------------------------------------------------------------------------------------------+
| HIGHWATER   Flood intelligence & emergency awareness   [ DEMO MODE ]   Bengaluru, KA   [ ⟳ Refresh ]    |
+---------------------------------------------------------------------------------------------------------+
| [ Flooded Area ]           | [ High-Priority Zones ]    | [ Exposed Buildings ]      | [ Blocked Roads ]|
| 12.4 km²                   | 08                         | 1,240                      | 05               |
| Illustrative data          | Illustrative data          | Illustrative data          | Illustrative data|
+---------------------------------------------------------------------------------------------------------+
| +-------------------------------------------------------+ +-------------------------------------------+ |
| | Map View: Leaflet Interactive Map                     | | Priority Zones & Search / Filter Panel    | |
| | [Layer Controls: Flood | Risk | Roads | Fac | Route]  | | [ Search Zone ID / Name ] [ Risk: ALL ▼ ] | |
| | [Reset Extent Button]                                 | | [ Sort: Priority ▼ ]                      | |
| |                                                       | |                                           | |
| | - Base Map (Bengaluru geographic context)             | | Zone 001 - HIGH (34 exposed bldgs)        | |
| | - GeoJSON Flood Polygons (Blue)                       | | Zone 002 - MEDIUM (12 exposed bldgs)      | |
| | - Risk Polygons (Red, Amber, Green, Slate)            | | Zone 003 - LOW (4 exposed bldgs)          | |
| | - Blocked Roads (Red Dashed)                          | | Zone 004 - UNKNOWN (Unassessed)           | |
| | - Facilities Markers (Purple Pins)                    | +-------------------------------------------+ |
| | - Evacuation Routes (Emerald Line)                    | | Selected Zone Details Inspector           | |
| |                                                       | | Zone 001 (HIGH Risk - Score 82/100)       | |
| | [Dynamic Legend: Enabled 4 of 5]                      | | Flood: 68% | Bldgs: 34 | Access: LIMITED  | |
| +-------------------------------------------------------+ | Reasons: High coverage, Exposed bldgs     | |
| +-------------------------------------------------------+ +-------------------------------------------+ |
| | Risk Distribution Chart (High/Med/Low/Unknown Counts) | | Cross-Zone Building Exposure Bar Chart    | |
| +-------------------------------------------------------+ +-------------------------------------------+ |
+---------------------------------------------------------------------------------------------------------+
```

---

### 3. Exact Folder Structure for `modules/dashboard/`

Member 1 builds exclusively within `modules/dashboard/`:

```
modules/dashboard/
├── public/
│   └── mock-data/
│       ├── flood_extent.geojson     # Polygon features (Bengaluru coordinates [lng, lat])
│       ├── zones.json               # Zone records, risk levels, scores, exposure, reasons
│       ├── blocked_roads.geojson    # LineString features of impassable roads
│       ├── facilities.geojson       # Point features for rescue shelters & staging bases
│       └── routes.json              # Polyline coordinates, distance, ETA, status
├── src/
│   ├── app/
│   │   ├── App.jsx                  # Root state coordinator
│   │   └── DashboardLayout.jsx      # Responsive shell (Desktop, Tablet, Mobile)
│   ├── components/
│   │   ├── Header.jsx               # Logo, study area, timestamp, demo badge, refresh
│   │   ├── StatCard.jsx             # Top metric card component
│   │   ├── FloodMap.jsx             # Reusable Leaflet container
│   │   ├── MapControls.jsx          # Layer toggle switches (4 of 5 counter)
│   │   ├── MapLegend.jsx            # Dynamic overlay legend
│   │   ├── ZoneDetails.jsx          # Selected zone inspection drawer
│   │   ├── ZoneList.jsx             # Sortable, searchable zone table/list
│   │   ├── RiskDistributionChart.jsx# Recharts risk count distribution
│   │   ├── ImpactChart.jsx          # Recharts building exposure comparison
│   │   ├── FilterBar.jsx            # Risk category buttons & search input
│   │   ├── LoadingState.jsx         # Skeletons for map, cards, list
│   │   ├── EmptyState.jsx           # Zero-zone query feedback
│   │   └── ErrorState.jsx           # Error banner with retry button
│   ├── features/
│   │   ├── map/
│   │   │   ├── FloodLayer.jsx       # Leaflet GeoJSON layer for flood extent
│   │   │   ├── RiskLayer.jsx        # Leaflet GeoJSON layer with click-to-select
│   │   │   ├── RoadLayer.jsx        # Blocked road dashed polylines
│   │   │   ├── FacilityLayer.jsx    # Custom DivIcon rescue markers
│   │   │   └── RouteLayer.jsx       # Safe evacuation polyline
│   │   ├── zones/
│   │   │   ├── zoneSelectors.js     # Filter, search, and sorting logic
│   │   │   └── zoneUtils.js         # Formatting and badge styling
│   │   └── dashboard/
│   │       └── dashboardSelectors.js# Derivation of top 4 KPI metrics
│   ├── data/
│   │   ├── mockData.js              # Bundled fallback fixture data
│   │   └── dataAdapter.js           # Anti-corruption normalization adapter
│   ├── hooks/
│   │   ├── useDashboardData.js      # Data fetch, refresh, deduplication & stale timer
│   │   └── useMapLayers.js          # Independent layer visibility toggling
│   ├── services/
│   │   └── dashboardApi.js          # Ingestion boundary (mock vs live API)
│   ├── styles/
│   │   └── index.css                # Tailwind directives & Leaflet styling
│   ├── test/
│   │   ├── ZoneList.test.jsx        # Search, filter, and sort tests
│   │   ├── ZoneDetails.test.jsx     # Detail panel & null-handling tests
│   │   └── dashboardSelectors.test.js# KPI metrics derivation tests
│   └── main.jsx                     # Vite React entrypoint
├── .env.example
├── package.json
├── vite.config.js
└── README.md
```

---

### 4. Data Contracts & The Normalization Adapter

#### Contract 1: `zones.json` (Produced by Member 3, Displayed by Member 1)
```json
{
  "schema_version": "1.0",
  "generated_at": "2026-10-13T10:00:00Z",
  "data_mode": "demo",
  "study_area": "Bengaluru, Karnataka",
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
        "High flood coverage",
        "Many exposed buildings",
        "Restricted accessibility"
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
        "Moderate flood coverage"
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
        "Minimal inundation detected"
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
      "reasons": []
    }
  ]
}
```

#### Contract 2: `flood_extent.geojson` (Produced by Member 2, Displayed by Member 1)
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
    }
  ]
}
```

#### Contract 3: Normalization Adapter (`src/data/dataAdapter.js`)
Protects UI from differences between mock data and actual teammate endpoints:
```javascript
const VALID_RISK_LEVELS = new Set(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

export function normalizeZones(payload) {
  if (!payload || !Array.isArray(payload.zones)) {
    throw new Error('Invalid zones payload: expected payload.zones array');
  }

  return payload.zones.map((zone) => ({
    zoneId: String(zone.zone_id),
    name: zone.name ?? zone.zone_id,
    riskLevel: VALID_RISK_LEVELS.has(zone.risk_level) ? zone.risk_level : 'UNKNOWN',
    riskScore: Number.isFinite(zone.risk_score) ? zone.risk_score : null,
    floodedPercent: Number.isFinite(zone.flooded_percent) ? zone.flooded_percent : null,
    floodedAreaKm2: Number.isFinite(zone.flooded_area_km2) ? zone.flooded_area_km2 : null,
    exposedBuildings: Number.isFinite(zone.exposed_buildings) ? zone.exposed_buildings : null,
    accessibility: zone.accessibility ?? 'UNKNOWN',
    reasons: Array.isArray(zone.reasons) ? zone.reasons : [],
  }));
}
```

---

### 5. Required Component Interface for `FloodMap.jsx`

The map is a pure presentation component with this clean contract:

```jsx
<FloodMap
  floodGeoJSON={floodGeoJSON}
  riskZones={riskZones}
  blockedRoads={blockedRoads}
  facilities={facilities}
  route={selectedRoute}
  selectedZoneId={selectedZoneId}
  visibleLayers={visibleLayers}
  onZoneSelect={handleZoneSelect}
/>
```

#### Map Styling Standards:
* **Flood extent:** Blue fill (`#3B82F6`, 40% opacity) with solid contrasting outline (`#1D4ED8`).
* **HIGH risk zone:** Red outline (`#DC2626`) and translucent fill (`#EF4444`, 35% opacity).
* **MEDIUM risk zone:** Amber outline (`#D97706`) and translucent fill (`#F59E0B`, 30% opacity).
* **LOW risk zone:** Green outline (`#16A34A`) and translucent fill (`#22C55E`, 25% opacity).
* **UNKNOWN risk:** Neutral slate outline (`#64748B`), dashed border (`4, 4`), and light gray fill.
* **Blocked road:** Red dashed line (`#DC2626`, weight 4, dash `6, 8`).
* **Evacuation route:** Solid emerald line (`#059669`, weight 5).
* **Rescue facility:** Distinct purple marker pin (`#7C3AED`) with cross icon.

---

### 6. The 25-Point Member 1 Interaction Checklist

```
MAP INTERACTIONS
[ ] 01. Zoom and pan the map smoothly
[ ] 02. Click a risk zone polygon to select it
[ ] 03. Highlight the selected zone (thick outline, elevated opacity)
[ ] 04. Toggle each map layer independently without resetting map position
[ ] 05. Reset map extent to default bounds via one-click button
[ ] 06. Display useful popup or tooltip on polygon hover/click

ZONES INTERACTIONS
[ ] 07. Search zones in real-time by name or zone ID
[ ] 08. Filter zones by risk level (HIGH, MEDIUM, LOW, UNKNOWN, ALL)
[ ] 09. Sort zones by priority or risk score (null scores sort last)
[ ] 10. Synchronize list selection with map selection (two-way sync)
[ ] 11. Show reasons and available measurements in the detail panel
[ ] 12. Display UNKNOWN for unassessed zones (never fall back to LOW)

DASHBOARD INTERACTIONS
[ ] 13. Derive the four summary cards directly from the current dataset
[ ] 14. Update analytical charts when filters or datasets change
[ ] 15. Show loading, empty, and error states gracefully
[ ] 16. Refresh data without duplicating in-flight requests
[ ] 17. Show data timestamp and clearly indicate DEMO MODE when mock data is used

ROUTING DISPLAY
[ ] 18. Display supplied evacuation route polyline on the map
[ ] 19. Show supplied distance (km) and route ETA/status
[ ] 20. Show blocked-road overlays (red dashed) when road data is available
[ ] 21. Handle unreachable or missing routes (show clear message, no misleading line)

USABILITY & RESILIENCE
[ ] 22. Work seamlessly across desktop, tablet, and mobile layouts
[ ] 23. Provide keyboard-accessible controls (buttons, filters, search)
[ ] 24. Use readable labels and WCAG AA color contrast (never color-only)
[ ] 25. Prevent page-wide crashes on malformed data or invalid geometry
```

---

### 7. Member 1 State Machine (No Redux Needed)

```javascript
export const initialDashboardState = {
  selectedZoneId: null,

  filters: {
    search: '',
    riskLevel: 'ALL',
  },

  visibleLayers: {
    flood: true,
    risk: true,
    roads: true,
    facilities: true,
    routes: false,
  },

  sortBy: 'priority',

  dataStatus: 'loading', // 'loading' | 'success' | 'empty' | 'error'
};
```

---

### 8. 9 Critical Pitfalls Member 1 Must Explicitly Avoid

1. **Do not wait for the AI/ML model:** Use deterministic mock fixtures (`/public/mock-data/`).
2. **Do not implement the risk algorithm:** Render the scores and reasons provided by Member 3.
3. **Do not calculate routes:** Render route coordinates supplied by Member 4.
4. **Do not assume every zone has a polygon:** Support non-spatial zones (list only, `"No map shape"`).
5. **Do not hardcode dashboard metrics:** Derive them dynamically via pure selectors.
6. **Do not treat missing information as zero risk:** Show `"Not available"` or `"UNKNOWN"`.
7. **Do not put API calls inside map-layer components:** Fetch and normalize exclusively through `dashboardApi.js` and `dataAdapter.js`.
8. **Do not overwrite other members' folders:** Commit only inside `modules/dashboard/`.
9. **Do not present mock results as real-time intelligence:** Always display the DEMO MODE badge and timestamp.

---

### 9. Final Definition of Done (Submission Criteria)

Member 1 has completed the assignment when:
1. Another teammate can clone the repo, run `npm install && npm run dev` inside `modules/dashboard/`, and demonstrate the entire interactive dashboard on mock data without any backend running.
2. The interactive Leaflet map has 5 independent overlays with working layer controls, legend, and extent reset.
3. Two-way selection is fully operational (Map click $\leftrightarrow$ List row).
4. Top 4 summary cards and Recharts analytical charts derive directly from data.
5. All automated Vitest tests pass for `dataAdapter`, `dashboardSelectors`, and `ZoneList`.
6. Switching from mock fixtures to live teammate endpoints requires changing only `dashboardApi.js` and `dataAdapter.js`, without redesigning any UI or map components.
