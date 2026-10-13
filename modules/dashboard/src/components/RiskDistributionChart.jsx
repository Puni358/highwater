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
import { THEME } from '../config/theme.js';
import { selectRiskDistribution } from '../features/dashboard/dashboardSelectors.js';

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-card border border-border p-2 rounded shadow-md text-xs font-sans">
        <div className="font-bold text-navy-900">{data.level} Risk</div>
        <div className="text-text-muted mt-0.5">
          {data.count} {data.count === 1 ? 'zone' : 'zones'}
        </div>
      </div>
    );
  }
  return null;
}

/**
 * RiskDistributionChart component (FR-30, T4.9)
 * Renders Recharts bar chart showing zones by risk category (HIGH, MEDIUM, LOW, UNKNOWN).
 */
export default function RiskDistributionChart({ zones = [] }) {
  const data = selectRiskDistribution(zones);
  const totalZones = data.reduce((sum, item) => sum + item.count, 0);

  if (!zones || zones.length === 0 || totalZones === 0) {
    return (
      <div className="bg-card border border-border rounded-card p-4 flex flex-col justify-between h-full font-sans">
        <h4 className="text-xs font-bold text-navy-900 mb-2">
          Risk Classification Distribution
        </h4>
        <div
          className="h-44 bg-surface rounded flex items-center justify-center text-xs text-text-muted border border-dashed border-border"
          role="status"
        >
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-card p-4 flex flex-col justify-between h-full font-sans shadow-xs">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-navy-900">
          Risk Classification Distribution
        </h4>
        <span className="text-[11px] text-text-muted">
          Total: {totalZones}
        </span>
      </div>

      <div className="w-full h-44" role="img" aria-label="Bar chart showing risk classification distribution">
        <ResponsiveContainer width="100%" height="100%" minHeight={160}>
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={THEME.colors.border} />
            <XAxis
              dataKey="level"
              tick={{ fontSize: 10, fill: THEME.colors['text-muted'] }}
              tickLine={false}
              axisLine={{ stroke: THEME.colors.border }}
              label={{
                value: 'Risk Level',
                position: 'insideBottom',
                offset: -12,
                fontSize: 10,
                fill: THEME.colors['text-muted'],
              }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: THEME.colors['text-muted'] }}
              tickLine={false}
              axisLine={{ stroke: THEME.colors.border }}
              label={{
                value: 'Zones',
                angle: -90,
                position: 'insideLeft',
                offset: 25,
                fontSize: 10,
                fill: THEME.colors['text-muted'],
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.level} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
