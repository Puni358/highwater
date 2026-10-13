# Chapter 07: Analytical Summary Charts with Recharts

---

### 7.1 Visual Analytics in Emergency Operations

While the Leaflet map gives spatial context and the zone list gives tabular details, **analytical charts** provide instant comparative distributions. Incident commanders can immediately answer:
1. *What is the macro threat breakdown?* (e.g., Are 80% of our zones High Risk or Low Risk?)
2. *Which specific zones concentrate the greatest humanitarian exposure?* (e.g., Which 5 sectors contain 70% of all vulnerable buildings?)

We implement these using **Recharts**, a declarative, SVG-based charting library tailored for React.

---

### 7.2 Chart 1: Risk Severity Distribution (`RiskDistributionChart.jsx`)

Categorical distribution counting how many zones fall into HIGH, MEDIUM, LOW, and UNKNOWN categories. Clicking a bar can optionally trigger the corresponding risk filter.

```jsx
import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from 'recharts';
import { THEME } from '@/config/theme';

export function RiskDistributionChart({ zones = [], onSelectCategory }) {
  // Aggregate counts per category
  const distributionData = React.useMemo(() => {
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };

    zones.forEach((zone) => {
      const level = (zone.risk_level || 'UNKNOWN').toUpperCase();
      if (counts[level] != null) {
        counts[level] += 1;
      } else {
        counts.UNKNOWN += 1;
      }
    });

    return [
      { key: 'HIGH', label: 'High', count: counts.HIGH, color: THEME.risk.HIGH.fillColor },
      { key: 'MEDIUM', label: 'Medium', count: counts.MEDIUM, color: THEME.risk.MEDIUM.fillColor },
      { key: 'LOW', label: 'Low', count: counts.LOW, color: THEME.risk.LOW.fillColor },
      { key: 'UNKNOWN', label: 'Unknown', count: counts.UNKNOWN, color: THEME.risk.UNKNOWN.fillColor },
    ];
  }, [zones]);

  const totalZones = zones.length;
  if (totalZones === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
        No zone risk data available for distribution chart
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Risk Severity Distribution</h4>
          <span className="text-[11px] text-slate-500">Zone count by threat classification</span>
        </div>
        <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
          {totalZones} Total Zones
        </span>
      </div>

      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={distributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis dataKey="label" tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
            <YAxis allowDecimals={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  const pct = totalZones > 0 ? Math.round((data.count / totalZones) * 100) : 0;
                  return (
                    <div className="rounded-md border border-slate-200 bg-white p-2 text-xs shadow-md">
                      <div className="font-bold text-slate-800">{data.label} Priority</div>
                      <div className="text-slate-600">
                        {data.count} Zones ({pct}%)
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(entry) => onSelectCategory?.(entry.key)}>
              {distributionData.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

---

### 7.3 Chart 2: Cross-Zone Building Exposure Comparison (`ExposureComparisonChart.jsx`)

Identifies and ranks the top impacted sectors by vulnerable building count.

```jsx
import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export function ExposureComparisonChart({ zones = [], topN = 6 }) {
  const chartData = React.useMemo(() => {
    // Filter zones with valid building counts and sort descending
    return [...zones]
      .filter((z) => typeof z.exposed_buildings === 'number' && z.exposed_buildings > 0)
      .sort((a, b) => b.exposed_buildings - a.exposed_buildings)
      .slice(0, topN)
      .map((z) => ({
        id: z.zone_id,
        name: z.name || z.zone_id,
        buildings: z.exposed_buildings,
        floodedArea: z.flooded_area_sqkm || 0,
      }));
  }, [zones, topN]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
        No exposed building statistics available across zones
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Highest Building Exposure</h4>
          <span className="text-[11px] text-slate-500">Top sectors by affected structures</span>
        </div>
      </div>

      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 15, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
            <XAxis type="number" tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              width={100}
              tick={{ fontSize: 10, fill: '#475569' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-md">
                      <div className="font-bold text-slate-900">{data.name}</div>
                      <div className="text-amber-700 font-semibold mt-0.5">
                        {data.buildings.toLocaleString()} Exposed Buildings
                      </div>
                      {data.floodedArea > 0 && (
                        <div className="text-slate-500 text-[11px]">
                          Inundated Area: {data.floodedArea} km²
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="buildings" fill="#F59E0B" radius={[0, 4, 4, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

---

### 7.4 Solving Common Recharts Responsive Bugs

1. **Flexbox / Grid Zero Width Bug:**
   * **Issue:** Placing `<ResponsiveContainer width="100%" height="100%">` inside a CSS flex item or CSS grid can cause Recharts to compute `width = -1` or `0px`, causing silent render collapse.
   * **Fix:** Always ensure the immediate parent wrapper of `<ResponsiveContainer>` has an explicit height (`h-52`, `h-64`, etc.) and a minimum width (`w-full min-w-0`).
2. **Chart Key Refresh on Tab Switch:**
   * When switching tabs between "Map" and "Analytics", Recharts may fail to recalculate container bounds. Passing a key or wrapping with a `ResizeObserver` ensures immediate redraw upon tab activation.
