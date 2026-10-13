# Chapter 10: Automated Frontend Testing Framework (Vitest & RTL)

---

### 10.1 Testing Strategy for Mission-Critical Dashboards

Disaster management frontends cannot rely solely on manual testing. Subtle regressions in coordinate parsing, filter logic, or metric calculations can lead to disastrous operational errors.

We configure an automated testing pyramid using **Vitest** (fast native runner) and **React Testing Library (RTL)** (accessible DOM assertions):

```
                       ▲
                      / \
                     /   \   Two-Way Selection Integration Tests (RTL)
                    /─────\  Search, Filter & Sort Component Tests (RTL)
                   /       \ Pure Metric Selector Unit Tests (Vitest)
                  /─────────\ Data Adapter & GIS Validator Unit Tests (Vitest)
                 ─────────────
```

---

### 10.2 Global Test Setup (`src/tests/setup.js`)

Web mapping and SVG charting libraries require polyfills in `jsdom`:

```javascript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 1. Mock ResizeObserver (required by Recharts and Leaflet container resizer)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// 2. Mock window.URL.createObjectURL for SVG/Leaflet assets
window.URL.createObjectURL = vi.fn(() => 'blob:mock');

// 3. Mock Leaflet Canvas / Element size methods
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}
```

---

### 10.3 Test Suite 1: Data Adapter Normalization (`src/tests/dataAdapter.test.js`)

```javascript
import { describe, it, expect } from 'vitest';
import {
  normalizeRiskLevel,
  normalizeScore,
  normalizeZones,
} from '@/services/dataAdapter';

describe('dataAdapter: Normalization Pipeline', () => {
  describe('normalizeRiskLevel', () => {
    it('normalizes valid risk levels regardless of casing', () => {
      expect(normalizeRiskLevel('high')).toBe('HIGH');
      expect(normalizeRiskLevel('MEDIUM')).toBe('MEDIUM');
      expect(normalizeRiskLevel('Low')).toBe('LOW');
    });

    it('maps synonym hazard terms to standard enums', () => {
      expect(normalizeRiskLevel('critical')).toBe('HIGH');
      expect(normalizeRiskLevel('severe')).toBe('HIGH');
      expect(normalizeRiskLevel('moderate')).toBe('MEDIUM');
      expect(normalizeRiskLevel('minimal')).toBe('LOW');
    });

    it('maps unrecognized and null categories strictly to UNKNOWN (never LOW)', () => {
      expect(normalizeRiskLevel('unexpected_value')).toBe('UNKNOWN');
      expect(normalizeRiskLevel(null)).toBe('UNKNOWN');
      expect(normalizeRiskLevel(undefined)).toBe('UNKNOWN');
      expect(normalizeRiskLevel('')).toBe('UNKNOWN');
    });
  });

  describe('normalizeScore', () => {
    it('converts 0.0 - 1.0 probability floats to 0 - 100 percentage scores', () => {
      expect(normalizeScore(0.85)).toBe(85);
      expect(normalizeScore(0.42)).toBe(42);
      expect(normalizeScore(1.0)).toBe(100);
    });

    it('preserves standard 0 - 100 integer scores', () => {
      expect(normalizeScore(78)).toBe(78);
      expect(normalizeScore('92')).toBe(92);
    });

    it('returns null for non-finite and missing scores without hallucinating zero', () => {
      expect(normalizeScore(NaN)).toBeNull();
      expect(normalizeScore(Infinity)).toBeNull();
      expect(normalizeScore(null)).toBeNull();
      expect(normalizeScore('invalid_str')).toBeNull();
    });
  });

  describe('normalizeZones', () => {
    it('handles mixed valid and malformed zones gracefully', () => {
      const rawPayload = [
        {
          zone_id: 'Z-1',
          name: 'Sector One',
          risk_level: 'HIGH',
          score: 85,
          exposed_buildings: 120,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [80.20, 13.00],
                [80.25, 13.00],
                [80.25, 13.05],
                [80.20, 13.05],
                [80.20, 13.00], // Closed ring
              ],
            ],
          },
        },
        {
          zone_id: 'Z-2',
          name: 'Sector Two (Corrupt Ring)',
          risk_level: 'LOW',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [80.20, 13.00],
                [80.25, 13.00],
                [80.25, 13.05], // Unclosed: missing return to start
              ],
            ],
          },
        },
        {
          zone_id: 'Z-3',
          name: 'Sector Three (No Geometry)',
          risk_level: 'UNKNOWN',
          geometry: null,
        },
      ];

      const { zonesList, zonesGeoJson } = normalizeZones(rawPayload);

      // All 3 zones must exist in the tabular list
      expect(zonesList).toHaveLength(3);
      expect(zonesList[0].has_geometry).toBe(true);
      expect(zonesList[1].has_geometry).toBe(false); // Unclosed ring dropped from map
      expect(zonesList[2].has_geometry).toBe(false);

      // Only the valid closed ring must be present in GeoJSON
      expect(zonesGeoJson.features).toHaveLength(1);
      expect(zonesGeoJson.features[0].properties.zone_id).toBe('Z-1');
    });
  });
});
```

---

### 10.4 Test Suite 2: Search, Filter & Sort Logic (`src/tests/ZoneList.test.jsx`)

```javascript
import { describe, it, expect } from 'vitest';
import { filterAndSortZones } from '@/utils/selectors';

const mockZones = [
  { zone_id: 'Z-01', name: 'Alpha River', risk_level: 'HIGH', score: 92, exposed_buildings: 500 },
  { zone_id: 'Z-02', name: 'Beta Bridge', risk_level: 'LOW', score: 20, exposed_buildings: 40 },
  { zone_id: 'Z-03', name: 'Gamma North', risk_level: 'HIGH', score: 75, exposed_buildings: 210 },
  { zone_id: 'Z-04', name: 'Delta Canal', risk_level: 'UNKNOWN', score: null, exposed_buildings: null },
];

describe('filterAndSortZones: Search & Filtering Engine', () => {
  it('filters strictly by risk level', () => {
    const highOnly = filterAndSortZones(mockZones, { riskFilter: 'HIGH' });
    expect(highOnly).toHaveLength(2);
    expect(highOnly.map((z) => z.zone_id)).toEqual(['Z-01', 'Z-03']);
  });

  it('searches by name or ID case-insensitively', () => {
    const searchAlpha = filterAndSortZones(mockZones, { searchQuery: 'alpha' });
    expect(searchAlpha).toHaveLength(1);
    expect(searchAlpha[0].zone_id).toBe('Z-01');

    const searchId = filterAndSortZones(mockZones, { searchQuery: 'z-02' });
    expect(searchId).toHaveLength(1);
    expect(searchId[0].name).toBe('Beta Bridge');
  });

  it('sorts by score descending while placing null scores strictly at the end', () => {
    const sorted = filterAndSortZones(mockZones, { sortBy: 'score' });
    expect(sorted.map((z) => z.zone_id)).toEqual(['Z-01', 'Z-03', 'Z-02', 'Z-04']);
  });

  it('returns empty array when no zones match criteria without throwing', () => {
    const empty = filterAndSortZones(mockZones, { searchQuery: 'nonexistent-zone' });
    expect(empty).toHaveLength(0);
  });
});
```

---

### 10.5 Test Suite 3: Two-Way Selection Synchronization (`src/tests/TwoWaySync.test.jsx`)

```javascript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneDetails } from '@/components/zones/ZoneDetails';

describe('Two-Way Synchronization & Active Zone Details', () => {
  it('renders "No Zone Selected" placeholder when selectedZone is null', () => {
    render(<ZoneDetails zone={null} onClose={vi.fn()} />);
    expect(screen.getByText(/No Zone Selected/i)).toBeInTheDocument();
  });

  it('renders complete zone operational metrics upon selection', () => {
    const selectedZone = {
      zone_id: 'ZONE-88',
      name: 'Harbor District',
      risk_level: 'HIGH',
      score: 88,
      flood_percentage: 65,
      exposed_buildings: 412,
      flooded_area_sqkm: 5.4,
      accessibility_status: 'CUT_OFF',
      reasons: ['Floodwater over seawall', 'Primary bridge damaged'],
      has_geometry: true,
    };

    render(<ZoneDetails zone={selectedZone} onClose={vi.fn()} />);

    // Check header and badge
    expect(screen.getByText('Harbor District')).toBeInTheDocument();
    expect(screen.getByText('High Risk')).toBeInTheDocument();

    // Check numbers
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();

    // Check status
    expect(screen.getByText(/Cut-Off \/ Inaccessible/i)).toBeInTheDocument();

    // Check explainability reasons
    expect(screen.getByText('Floodwater over seawall')).toBeInTheDocument();
    expect(screen.getByText('Primary bridge damaged')).toBeInTheDocument();
  });

  it('renders "Not available" for missing attributes rather than fabricating zeroes', () => {
    const incompleteZone = {
      zone_id: 'ZONE-99',
      name: 'Unassessed Sector',
      risk_level: 'UNKNOWN',
      score: null,
      flood_percentage: null,
      exposed_buildings: null,
      flooded_area_sqkm: null,
      accessibility_status: 'UNKNOWN',
      reasons: [],
      has_geometry: false,
    };

    render(<ZoneDetails zone={incompleteZone} onClose={vi.fn()} />);

    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.getByText('Unassessed')).toBeInTheDocument();
  });
});
```
