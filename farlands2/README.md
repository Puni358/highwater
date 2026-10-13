# HighWater Disaster Response Dashboard: Frontend & GIS Architecture Research
## Member 1 Lead Research & Engineering Blueprint (Future Reference & Implementation Guide)

---

### Executive Summary

In emergency management and disaster response scenarios—specifically flood monitoring and situational awareness—the frontend dashboard serves as the single pane of glass for incident commanders, field coordinators, and technical analysts. A disaster response dashboard cannot fail silently, misrepresent uncertainty, confuse coordinate order, or freeze when network conditions degrade. 

This research repository provides an exhaustive, production-grade technical blueprint for building the **HighWater Disaster Response Dashboard** (`modules/dashboard/`), structured strictly according to the responsibilities of **Member 1 (Frontend & Dashboard Lead)**.

Every design decision, mathematical formula, GIS coordinate transformation, React state synchronization model, data normalization pipeline, and testing strategy has been researched and documented in this directory for long-term reference and immediate modular implementation.

---

### Research Repository Index

| Document | Focus Area | Key Architectural Deliverables |
| :--- | :--- | :--- |
| [**01. Core Architecture & Setup**](./01_core_architecture_and_setup.md) | Project Scaffolding & Design System | Vite + React 18/19 build pipeline, Tailwind CSS token architecture, semantic disaster color system, directory layout, environment configuration. |
| [**02. Leaflet GIS Engine**](./02_leaflet_gis_engine.md) | WebGIS, Cartography & Layer Pipeline | GeoJSON parsing, EPSG:4326 vs EPSG:3857 CRS handling, [lng, lat] coordinate reversal, 5 overlay layers (Flood, Risk Zones, Blocked Roads, Facilities, Evacuation Routes), offline tile fallbacks. |
| [**03. Navigation Controls & Legends**](./03_navigation_controls_and_legends.md) | Map Controls & Dynamic Legends | Independent layer toggles without viewport reset, dynamic legend reflecting only active layers, auto-bounding box calculation, reset extent control. |
| [**04. Summary Cards & Metrics**](./04_summary_cards_and_metrics.md) | High-Level Statistics Engine | Pure memoized selectors for Flooded Area, High-Priority Zones, Exposed Buildings, Blocked Roads; demo mode honesty labelling; unit formatting. |
| [**05. Two-Way Zone Synchronization**](./05_zone_interactions_and_two_way_sync.md) | Bidirectional Interactivity & Filtering | Syncing map polygon selection with list/table rows, preventing animation loops, geometry-less zone support, multi-criteria filtering, text search, sorting. |
| [**06. Zone Detail Panels**](./06_zone_detail_panels.md) | Active Zone Inspection & Explainability | Deep inspection drawer, risk score badges, flood inundation metrics, building counts, accessibility status, priority rationale breakdown, provenance tagging. |
| [**07. Analytical Charts (Recharts)**](./07_analytical_charts_recharts.md) | Visual Analytics & Distribution | Responsive Recharts bar charts for risk distribution (High/Med/Low/Unknown) and cross-zone building exposure; accessible custom tooltips; empty states. |
| [**08. Data Adapter & API Layer**](./08_data_adapter_and_api_layer.md) | Ingestion Normalization & Decoupling | Hexagonal architecture via `dataAdapter.js` and `dashboardApi.js`, contract normalization, defensive coercion, deduplicated fetch, stale-data heuristics. |
| [**09. UI System States & Resilience**](./09_ui_system_states_and_resilience.md) | Fault Tolerance & State UX | Loading skeleton design, zero-data empty states, malformed payload recovery, React Error Boundaries per layer and per widget. |
| [**10. Automated Testing Framework**](./10_frontend_testing_framework.md) | Vitest & React Testing Library | Full test suite architecture: adapter normalization tests, selector calculation tests, search/filter component tests, bidirectional selection integration tests. |

---

### Architectural Principles

```
+---------------------------------------------------------------------------------------+
|                                    HighWater Dashboard                                |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Header: Status Badge (Demo/Live) | Timestamp | Study Area | Refresh Action     |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Top Summary Cards: Flooded Area | High Priority | Exposed Bldgs | Blocked Roads   |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-----------------------------------+   +---------------------------------------+   |
|   | Interactive Leaflet Map Engine     |   | Zone Operations & Analytics Panel     |   |
|   |                                   |   |                                       |   |
|   | - Base Map (OSM / Carto / Canvas) |   | - Tab 1: Zone List & Multi-Filter     |   |
|   | - Layer 1: Flood Inundation Poly  |   |   * Search ID / Name                  |   |
|   | - Layer 2: Risk-Zone Boundaries   |   |   * Filter High / Med / Low / Unk     |   |
|   | - Layer 3: Blocked Road Segments  |   |   * Sort Score / Impact               |   |
|   | - Layer 4: Rescue Facilities      |   |                                       |   |
|   | - Layer 5: Evacuation Routes      |   | - Tab 2: Zone Detail Inspector        |   |
|   |                                   |   |   * Score, Reasons, Access Status     |   |
|   | [Controls: Toggle, Reset, Legend] |   |                                       |   |
|   +-----------------------------------+   | - Tab 3: Recharts Analytical Charts   |   |
|                                           |   * Risk Distribution (Categorical)   |   |
|                                           |   * Building Exposure (Comparative)   |   |
|                                           +---------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Data Foundation Layer: dataAdapter.js <--> dashboardApi.js                    |   |
|   | Ingests mock fixtures or live teammate endpoints -> Normalizes to unified model |   |
|   +-------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------+
```

1. **Separation of Presentation and Ingestion (Adapter Pattern):**
   The UI components must never expect backend-specific schemas. The `dataAdapter.js` acts as an anti-corruption layer that converts variable external payloads into immutable, strictly validated frontend models. If a teammate changes a key from `risk_score` to `score` or switches coordinates from nested arrays to FlatGeoJSON, only the adapter is updated.

2. **Cartographic Integrity & Defensive GIS:**
   Web mapping libraries frequently crash on malformed coordinates, self-intersecting polygons, or swapped latitude/longitude pairs. The GIS layer validates geometries before pushing them into Leaflet. Polygons must be closed rings, coordinates must fall within `[-90, 90]` (lat) and `[-180, 180]` (lng), and non-spatial zones must remain accessible in tabular lists without crashing the map canvas.

3. **Truth in Emergency UI (No Hallucinated Data):**
   In critical operations, an absent value is fundamentally different from a zero. If building exposure or flood depth is unknown, it must be rendered as `"Not available"` or `"Unassessed"`. The UI never coerces `null` to `0`, and never falls back an `UNKNOWN` risk zone to `LOW`.

4. **Bidirectional State Synchronization:**
   Interaction between spatial views (Map) and tabular/analytical views (List & Charts) shares a single source of truth (`selectedZoneId`). Selecting a zone in the table centers the map; clicking a zone polygon updates the table selection and opens the detail panel.
