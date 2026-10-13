# Chapter 04: High-Level Summary Cards & Analytical Metrics Engine

---

### 4.1 The Role of Summary Cards in Disaster Response

When incident commanders look at the HighWater dashboard, the top four statistics provide the immediate macroscopic situational awareness needed for rapid resource allocation:

```
+---------------------------------------------------------------------------------------------------------+
| [ Waves ]                  | [ AlertTriangle ]          | [ Building ]               | [ ShieldAlert ]  |
| 14.8 km²                   | 5 Zones                    | 1,420                      | 18 Segments      |
| Flooded Inundation Area    | High-Priority Zones        | Exposed Buildings          | Blocked Roads    |
| (Derived from drone SAR)   | (Require immediate rescue) | (Across assessed sectors)  | (Impassable)     |
| [Illustrative / Demo]      | [Illustrative / Demo]      | [Illustrative / Demo]      | [Illustrative]   |
+---------------------------------------------------------------------------------------------------------+
```

---

### 4.2 Architectural Rule: Pure Selectors & Data Integrity

To prevent UI inconsistencies and duplicate computation during render cycles, all metrics are computed through pure, memoized selector functions (`src/utils/selectors.js`).

#### Operational Truth Guidelines:
1. **Never Fabricate Zero:** If an upstream telemetry feed fails to provide building counts for an unassessed zone, that zone's value is `null`, not `0`. The aggregator must report only verifiable figures and note unassessed units.
2. **Global vs Filtered Scope:** Top KPI cards represent the **entire incident command theater** (the study area), unaffected by transient user search/filter queries in the sidebar. This ensures the commander never loses sight of the total catastrophe scope while searching for a specific neighborhood.
3. **Demo Transparency:** If `data_mode === 'demo'`, every card must clearly display an "Illustrative" tag to guarantee hackathon and real-world operational honesty.

---

### 4.3 Pure Metrics Selector Implementation (`src/utils/selectors.js`)

```javascript
/**
 * Pure Selector Functions for High-Level KPI Aggregations
 */

/**
 * Computes the total inundated area in km²:
 * - If flood GeoJSON provides precalculated area properties, sum them.
 * - Otherwise sum flooded_area_sqkm from assessed zones.
 */
export function selectTotalFloodedArea(floodGeoJson, zones = []) {
  // Option A: Extract directly from flood GeoJSON features
  if (floodGeoJson?.features?.length) {
    const geoJsonTotal = floodGeoJson.features.reduce((acc, feat) => {
      const area = feat.properties?.area_sqkm;
      return typeof area === 'number' && !Number.isNaN(area) ? acc + area : acc;
    }, 0);

    if (geoJsonTotal > 0) return Math.round(geoJsonTotal * 100) / 100;
  }

  // Option B: Sum from zone entities
  const zoneTotal = zones.reduce((acc, zone) => {
    const area = zone.flooded_area_sqkm;
    return typeof area === 'number' && !Number.isNaN(area) ? acc + area : acc;
  }, 0);

  return Math.round(zoneTotal * 100) / 100;
}

/**
 * Counts zones flagged with HIGH risk priority
 */
export function selectHighPriorityZoneCount(zones = []) {
  if (!Array.isArray(zones)) return 0;
  return zones.filter(
    (z) => typeof z.risk_level === 'string' && z.risk_level.toUpperCase() === 'HIGH'
  ).length;
}

/**
 * Computes total exposed buildings and tracks unassessed zones
 */
export function selectExposedBuildingsMetrics(zones = []) {
  if (!Array.isArray(zones) || zones.length === 0) {
    return { total: 0, hasMissing: false, unassessedCount: 0 };
  }

  let total = 0;
  let unassessedCount = 0;

  for (const zone of zones) {
    const count = zone.exposed_buildings;
    if (typeof count === 'number' && !Number.isNaN(count) && count >= 0) {
      total += count;
    } else {
      unassessedCount += 1;
    }
  }

  return {
    total,
    hasMissing: unassessedCount > 0,
    unassessedCount,
  };
}

/**
 * Computes total blocked road segments and cumulative blocked distance
 */
export function selectBlockedRoadMetrics(blockedRoadsGeoJson) {
  if (!blockedRoadsGeoJson?.features?.length) {
    return { count: 0, totalLengthKm: 0 };
  }

  const count = blockedRoadsGeoJson.features.length;
  const totalLengthKm = blockedRoadsGeoJson.features.reduce((acc, feat) => {
    const length = feat.properties?.length_km;
    return typeof length === 'number' && !Number.isNaN(length) ? acc + length : acc;
  }, 0);

  return {
    count,
    totalLengthKm: Math.round(totalLengthKm * 10) / 10,
  };
}
```

---

### 4.4 Stat Card Component (`src/components/summary/StatCard.jsx`)

```jsx
import React from 'react';
import clsx from 'clsx';

export function StatCard({
  title,
  value,
  unit,
  subtitle,
  icon: Icon,
  variant = 'default',
  isDemo = false,
  tooltip,
}) {
  const variantStyles = {
    default: 'border-slate-200 bg-white text-slate-900',
    danger: 'border-red-200 bg-red-50/50 text-red-950',
    warning: 'border-amber-200 bg-amber-50/50 text-amber-950',
    info: 'border-blue-200 bg-blue-50/50 text-blue-950',
  };

  const iconColors = {
    default: 'text-slate-600 bg-slate-100',
    danger: 'text-red-600 bg-red-100',
    warning: 'text-amber-600 bg-amber-100',
    info: 'text-blue-600 bg-blue-100',
  };

  return (
    <div
      className={clsx(
        'relative rounded-xl border p-4 shadow-sm transition-all hover:shadow-md',
        variantStyles[variant]
      )}
      title={tooltip}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </span>
        <div className={clsx('rounded-lg p-2', iconColors[variant])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-black tracking-tight text-slate-900">
          {value != null ? value.toLocaleString() : '--'}
        </span>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
      </div>

      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{subtitle}</span>
        {isDemo && (
          <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            Illustrative
          </span>
        )}
      </div>
    </div>
  );
}
```

---

### 4.5 Summary Cards Container (`src/components/summary/SummaryCardsContainer.jsx`)

```jsx
import React, { useMemo } from 'react';
import { Waves, AlertTriangle, Building, ShieldAlert } from 'lucide-react';
import { StatCard } from './StatCard';
import {
  selectTotalFloodedArea,
  selectHighPriorityZoneCount,
  selectExposedBuildingsMetrics,
  selectBlockedRoadMetrics,
} from '@/utils/selectors';

export function SummaryCardsContainer({
  floodGeoJson,
  zones,
  blockedRoadsGeoJson,
  isDemoMode = false,
}) {
  const floodedArea = useMemo(
    () => selectTotalFloodedArea(floodGeoJson, zones),
    [floodGeoJson, zones]
  );

  const highPriorityCount = useMemo(
    () => selectHighPriorityZoneCount(zones),
    [zones]
  );

  const buildingMetrics = useMemo(
    () => selectExposedBuildingsMetrics(zones),
    [zones]
  );

  const roadMetrics = useMemo(
    () => selectBlockedRoadMetrics(blockedRoadsGeoJson),
    [blockedRoadsGeoJson]
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Flooded Area */}
      <StatCard
        title="Flooded Area"
        value={floodedArea}
        unit="km²"
        subtitle="SAR Satellite / Drone Extent"
        icon={Waves}
        variant="info"
        isDemo={isDemoMode}
      />

      {/* 2. High-Priority Zones */}
      <StatCard
        title="High-Priority Zones"
        value={highPriorityCount}
        unit="Zones"
        subtitle="Require Rapid Dispatch"
        icon={AlertTriangle}
        variant="danger"
        isDemo={isDemoMode}
      />

      {/* 3. Exposed Buildings */}
      <StatCard
        title="Exposed Buildings"
        value={buildingMetrics.total}
        unit="Structures"
        subtitle={
          buildingMetrics.hasMissing
            ? `${buildingMetrics.unassessedCount} zones unassessed`
            : 'Within flood polygon'
        }
        icon={Building}
        variant="warning"
        isDemo={isDemoMode}
      />

      {/* 4. Blocked Roadways */}
      <StatCard
        title="Blocked Roadways"
        value={roadMetrics.count}
        unit="Segments"
        subtitle={
          roadMetrics.totalLengthKm > 0
            ? `${roadMetrics.totalLengthKm} km impassable`
            : 'Access compromised'
        }
        icon={ShieldAlert}
        variant="danger"
        isDemo={isDemoMode}
      />
    </div>
  );
}
```
