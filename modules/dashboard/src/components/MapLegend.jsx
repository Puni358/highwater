import React from 'react';
import { THEME } from '../config/theme.js';
import ProvenanceBadge from './ProvenanceBadge.jsx';

/**
 * MapLegend component (FR-16, T3.7, design.md section 4)
 * Dynamic legend reflecting ONLY active/enabled overlays and provenance badges.
 */
export default function MapLegend({
  visibleLayers = { flood: true, risk: true, roads: true, facilities: true, routes: false, buildings: false },
}) {
  const hasActiveLayers = Object.values(visibleLayers).some(Boolean);

  if (!hasActiveLayers) {
    return (
      <div className="bg-card/95 backdrop-blur-sm border border-border rounded-card p-2.5 shadow-md text-xs text-text-muted">
        <span>No map overlays active</span>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Map Legend"
      className="bg-card/95 backdrop-blur-sm border border-border rounded-card p-3 shadow-md text-xs space-y-2.5 max-w-[240px] font-sans"
    >
      <div className="font-bold text-navy-900 border-b border-border pb-1">
        Active Map Overlays
      </div>

      {/* 1. Flood Extent Swatch */}
      {visibleLayers.flood && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded border"
              style={{
                backgroundColor: THEME.colors.flood,
                borderColor: THEME.colors.floodBorder,
                opacity: 0.6,
              }}
            />
            <span className="text-text">Inundation Extent</span>
          </div>
          <ProvenanceBadge value="derived" />
        </div>
      )}

      {/* 2. Priority Risk Classification Swatches */}
      {visibleLayers.risk && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-text-muted text-[11px]">Priority Risk:</span>
            <ProvenanceBadge value="derived" />
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {THEME.riskColors.CRITICAL && (
              <div className="flex items-center space-x-1.5">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: THEME.riskColors.CRITICAL }} />
                <span>CRITICAL</span>
              </div>
            )}
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: THEME.riskColors.HIGH }} />
              <span>HIGH</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: THEME.riskColors.MEDIUM }} />
              <span>MEDIUM</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: THEME.riskColors.LOW }} />
              <span>LOW</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div
                className="w-3 h-3 rounded border border-dashed border-gray-500"
                style={{ backgroundColor: `${THEME.riskColors.UNKNOWN}30` }}
              />
              <span>UNKNOWN</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Blocked Road Swatch */}
      {visibleLayers.roads && (
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-1 border-t-2 border-dashed border-risk-high" />
            <span className="text-text">Blocked Roadway</span>
          </div>
          <ProvenanceBadge value="derived" />
        </div>
      )}

      {/* 4. Facilities Swatches */}
      {visibleLayers.facilities && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-text-muted text-[11px]">Facilities:</span>
            <ProvenanceBadge value="simulated" />
          </div>
          <div className="space-y-0.5 text-[11px]">
            <div className="flex items-center space-x-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
              <span>Hospital / Medical</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-600" />
              <span>Relief Shelter</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-navy-900" />
              <span>Logistics Depot</span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Route Swatch */}
      {visibleLayers.routes && (
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-1 bg-route rounded" />
            <span className="text-text">Evacuation Corridor</span>
          </div>
          <ProvenanceBadge value="simulated" />
        </div>
      )}

      {/* 6. Exposed Buildings Swatch */}
      {visibleLayers.buildings && (
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center space-x-2">
            <div
              className="w-3.5 h-3.5 rounded border"
              style={{
                backgroundColor: THEME.colors.buildingFlooded,
                borderColor: THEME.colors.buildingFloodedBorder,
                opacity: 0.8,
              }}
            />
            <span className="text-text">Flooded Buildings</span>
          </div>
          <ProvenanceBadge value="observed" />
        </div>
      )}

      {/* Provenance Key Reference per design.md section 4 */}
      <div className="pt-2 border-t border-border text-[10px] space-y-1 text-text-muted">
        <div className="font-semibold text-navy-900">Provenance Legend:</div>
        <div className="flex flex-wrap gap-1">
          <ProvenanceBadge value="observed" />
          <ProvenanceBadge value="derived" />
          <ProvenanceBadge value="simulated" />
        </div>
      </div>
    </div>
  );
}
