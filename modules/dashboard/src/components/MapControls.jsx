import React from 'react';
import { Layers, RotateCcw, Droplets, ShieldAlert, Ban, Building2, Route, Home } from 'lucide-react';
import ProvenanceBadge from './ProvenanceBadge.jsx';

/**
 * MapControls component (FR-14, FR-15, T3.6)
 * Provides 6 layer overlay switches and reset-extent button.
 * Toggling layers updates visibleLayers only and does NOT reset map viewport.
 */
export default function MapControls({
  visibleLayers = { flood: true, risk: true, roads: true, facilities: true, routes: false, buildings: false },
  onToggleLayer,
  onResetExtent,
}) {
  const layerConfigs = [
    { key: 'flood', label: 'Flood Extent', icon: Droplets, color: 'text-flood', provenance: 'derived' },
    { key: 'risk', label: 'Risk Zones', icon: ShieldAlert, color: 'text-risk-high', provenance: 'derived' },
    { key: 'roads', label: 'Blocked Roads', icon: Ban, color: 'text-risk-high', provenance: 'derived' },
    { key: 'facilities', label: 'Rescue Facilities', icon: Building2, color: 'text-navy-900', provenance: 'simulated' },
    { key: 'routes', label: 'Evacuation Routes', icon: Route, color: 'text-route', provenance: 'simulated' },
    { key: 'buildings', label: 'Exposed Buildings', icon: Home, color: 'text-amber-700', provenance: 'observed' },
  ];

  const enabledCount = Object.values(visibleLayers).filter(Boolean).length;
  const totalCount = layerConfigs.length;

  return (
    <div
      role="region"
      aria-label="Map Layer Controls"
      className="bg-card border border-border rounded-card p-3 shadow-sm space-y-3 font-sans"
    >
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center space-x-1.5 text-text font-semibold text-xs">
          <Layers className="w-4 h-4 text-navy-700" aria-hidden="true" />
          <span>Layer Overlays</span>
        </div>
        <span className="text-[11px] text-text-muted font-medium">
          {enabledCount} of {totalCount} Enabled
        </span>
      </div>

      <div className="space-y-1.5">
        {layerConfigs.map(({ key, label, icon: Icon, color, provenance }) => {
          const isChecked = Boolean(visibleLayers[key]);
          return (
            <label
              key={key}
              htmlFor={`toggle-${key}`}
              className="flex items-center justify-between p-1.5 rounded hover:bg-surface cursor-pointer transition select-none group"
            >
              <div className="flex items-center space-x-2 text-xs">
                <Icon className={`w-3.5 h-3.5 ${color}`} aria-hidden="true" />
                <span className="text-text group-hover:text-navy-900">{label}</span>
                {provenance && (
                  <ProvenanceBadge value={provenance} className="hidden sm:inline-flex scale-90" />
                )}
              </div>
              <input
                id={`toggle-${key}`}
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleLayer(key)}
                className="w-4 h-4 rounded text-navy-900 border-border focus:ring-2 focus:ring-flood focus:outline-none transition cursor-pointer"
                aria-label={`Toggle ${label} overlay`}
              />
            </label>
          );
        })}
      </div>

      <div className="pt-2 border-t border-border">
        <button
          type="button"
          onClick={onResetExtent}
          aria-label="Reset map to study area bounds"
          className="w-full inline-flex items-center justify-center space-x-1.5 px-2.5 py-1.5 rounded bg-surface hover:bg-slate-200 active:scale-95 text-text text-xs font-medium border border-border transition focus:outline-none focus:ring-2 focus:ring-flood"
        >
          <RotateCcw className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" />
          <span>Reset Map Extent</span>
        </button>
      </div>
    </div>
  );
}
