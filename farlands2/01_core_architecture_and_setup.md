# Chapter 01: Core Application Structure, Tooling & Design System

---

### 1.1 Overview & Responsibilities

As the Frontend & Dashboard Lead (Member 1), establishing a reliable, high-velocity build and design infrastructure is the prerequisite for all downstream GIS, analytical, and data integration tasks. 

The dashboard must operate as a standalone single-page application (SPA) capable of running completely offline on mock fixtures, while possessing the build tooling and architecture to switch effortlessly to live backend microservices.

---

### 1.2 Tech Stack Selection & Justification

| Technology | Selection Rationale | Alternatives Considered & Why Rejected |
| :--- | :--- | :--- |
| **Vite 5.x / 6.x** | Lightning-fast Hot Module Replacement (HMR), native ES modules in dev, optimized Rollup bundling for production. Sub-second build times. | **Create React App (CRA):** Deprecated, bloated webpack overhead.<br>**Next.js:** Server-side complexity unnecessary for static client deployment in drone/field units. |
| **React 18 / 19** | Concurrent rendering, declarative component tree, robust ecosystem for Leaflet and visualization wrappers. | **Vue / Svelte:** Team familiarity and standard GIS component libraries (`react-leaflet`, `recharts`). |
| **Tailwind CSS 3.x / 4.x** | Utility-first, zero runtime CSS overhead, strict design token encapsulation, responsive breakpoint modifiers (`sm:`, `md:`, `lg:`, `xl:`). | **Styled Components / Emotion:** Runtime overhead during rapid map rerenders and marker interactions. |
| **Leaflet & React Leaflet** | Industry-standard lightweight WebGIS library (~40KB gzip), extensive polygon/polyline manipulation, vast plugin ecosystem. | **Mapbox GL / MapLibre:** Heavy WebGL requirement; potential GPU throttling on low-spec field laptops; commercial licensing hurdles with Mapbox. |
| **Recharts** | Declarative SVG-based charting built natively for React, automatic responsive wrappers, zero canvas complexity. | **Chart.js:** Imperative canvas manipulation, difficult to integrate cleanly with React state transitions. |
| **Lucide React** | Clean, accessible SVG icon library with consistent stroke widths and minimal bundle footprint. | **FontAwesome:** Heavier bundle size, inconsistent licensing. |
| **Vitest + RTL** | Native Vite integration, near-instant test execution, shared config, full DOM simulation via `jsdom`. | **Jest:** Requires Babel transforms and complex ESM workarounds with Leaflet/Vite. |

---

### 1.3 Recommended Directory Structure

```
modules/dashboard/
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js
├── public/
│   ├── favicon.svg
│   └── mock/
│       ├── flood_extent.geojson
│       ├── zones.json
│       ├── blocked_roads.geojson
│       ├── facilities.geojson
│       └── routes.json
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── config/
    │   ├── theme.js               # Central design & color tokens
    │   └── mapConfig.js           # Default coordinates, tile providers, bounds
    ├── assets/
    │   └── icons/
    ├── components/
    │   ├── common/                # Badges, Buttons, Cards, Skeletons, ErrorBoundary
    │   ├── header/                # Top navigation, status indicator, refresh
    │   ├── summary/               # Top 4 KPI metric cards
    │   ├── map/                   # Leaflet container, layer components, controls, legend
    │   ├── zones/                 # Zone table, filter bar, search input, details inspector
    │   └── charts/                # Recharts risk distribution & exposure comparison
    ├── hooks/
    │   ├── useDashboardData.js    # Data lifecycle hook (loading, error, refresh, deduplication)
    │   └── useDebounce.js         # Input debouncing for fast search
    ├── services/
    │   ├── api.js                 # HTTP client (fetch/Axios) with retry & timeout
    │   ├── dashboardApi.js        # Data service (mock fixtures vs live endpoints)
    │   └── dataAdapter.js         # Normalizer converting raw payloads into UI entities
    ├── utils/
    │   ├── coordinateValidator.js # EPSG:4326 GIS sanity checks & ring verification
    │   ├── formatters.js          # Number, area (km²), timestamp & text formatters
    │   └── selectors.js           # Memoized analytical metric calculations
    └── tests/
        ├── setup.js               # Vitest global mock setup (ResizeObserver, Leaflet stubs)
        ├── dataAdapter.test.js    # Ingestion normalization & error handling unit tests
        ├── selectors.test.js      # Metric calculations unit tests
        ├── ZoneList.test.jsx      # Filtering & search interaction tests
        └── TwoWaySync.test.jsx    # Map <-> List selection synchronization tests
```

---

### 1.4 Configuration Files

#### `package.json`
```json
{
  "name": "highwater-dashboard",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "leaflet": "^1.9.4",
    "lucide-react": "^0.395.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-leaflet": "^4.2.1",
    "recharts": "^2.12.7",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/leaflet": "^1.9.12",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "vitest": "^1.6.0"
  }
}
```

#### `vite.config.js`
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
    css: false,
  },
});
```

#### `postcss.config.js`
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

#### `tailwind.config.js`
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Disaster Risk Palette (WCAG AA Compliant)
        risk: {
          high: '#DC2626',      // Red 600 - Imminent threat / Severe inundation
          'high-bg': '#FEE2E2', // Red 100
          medium: '#D97706',    // Amber 600 - Moderate risk / Monitor closely
          'medium-bg': '#FEF3C7',
          low: '#16A34A',       // Green 600 - Minimal impact / Operational
          'low-bg': '#DCFCE7',
          unknown: '#64748B',   // Slate 500 - Unassessed / Awaiting data
          'unknown-bg': '#F1F5F9'
        },
        // Inundation & GIS Layers
        gis: {
          flood: '#2563EB',     // Blue 600 - Water extent
          'flood-fill': '#3B82F6',
          roadBlocked: '#EF4444', // Red 500
          facility: '#7C3AED',  // Violet 600 - Command posts / Shelters
          route: '#059669',     // Emerald 600 - Active evacuation corridor
        },
        // Dashboard Shell
        surface: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          800: '#1E293B',
          900: '#0F172A',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

---

### 1.5 Design Tokens Architecture (`src/config/theme.js`)

Centralizing tokens in a single JavaScript module eliminates hardcoded hex values in UI components, guaranteeing visual consistency and easing future brand re-theming.

```javascript
/**
 * Centralized Design and Semantic Tokens for HighWater Dashboard
 * Avoid hardcoding hex strings in individual components.
 */

export const THEME = {
  risk: {
    HIGH: {
      label: 'High Risk',
      color: '#DC2626',
      fillColor: '#EF4444',
      bgLight: '#FEE2E2',
      borderLight: '#FCA5A5',
      badgeClass: 'bg-red-100 text-red-800 border-red-300',
    },
    MEDIUM: {
      label: 'Medium Risk',
      color: '#D97706',
      fillColor: '#F59E0B',
      bgLight: '#FEF3C7',
      borderLight: '#FCD34D',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    },
    LOW: {
      label: 'Low Risk',
      color: '#16A34A',
      fillColor: '#22C55E',
      bgLight: '#DCFCE7',
      borderLight: '#86EFAC',
      badgeClass: 'bg-green-100 text-green-800 border-green-300',
    },
    UNKNOWN: {
      label: 'Unassessed / Unknown',
      color: '#64748B',
      fillColor: '#94A3B8',
      bgLight: '#F1F5F9',
      borderLight: '#CBD5E1',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    },
  },
  layers: {
    floodExtent: {
      label: 'Flood Water Extent',
      color: '#1D4ED8',
      fillColor: '#3B82F6',
      fillOpacity: 0.45,
      weight: 1.5,
    },
    riskZones: {
      label: 'Risk Priority Zones',
      weightDefault: 2,
      weightSelected: 4,
      fillOpacityDefault: 0.25,
      fillOpacitySelected: 0.55,
      dashArray: '4, 4',
    },
    blockedRoads: {
      label: 'Blocked / Flooded Roads',
      color: '#DC2626',
      weight: 4,
      dashArray: '6, 8',
      opacity: 0.9,
    },
    rescueFacilities: {
      label: 'Rescue Centers & Shelters',
      markerColor: '#7C3AED',
      radius: 8,
    },
    evacuationRoutes: {
      label: 'Safe Evacuation Routes',
      color: '#059669',
      weight: 5,
      opacity: 0.95,
    },
  },
  map: {
    defaultCenter: [13.0827, 80.2707], // e.g., Chennai Flood Scenario coordinates
    defaultZoom: 12,
    minZoom: 9,
    maxZoom: 18,
    tileLayerUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};
```

---

### 1.6 Environment Variables Specification (`.env.example`)

```bash
# Data Source Mode: 'mock' (loads local fixtures) or 'api' (fetches teammate microservices)
VITE_DATA_SOURCE=mock

# Base API URL when VITE_DATA_SOURCE=api
VITE_API_BASE_URL=http://localhost:8000/api/v1

# Stale data threshold in minutes. Payloads older than this display a warning banner
VITE_STALE_MINUTES=15

# Map tile provider override (useful for offline/custom tile server)
VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

# Optional telemetry or debug logs
VITE_ENABLE_DEBUG_LOGS=false
```
