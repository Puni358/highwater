import React, { useState, useCallback } from 'react';
import Header from '../components/Header.jsx';
import StatCard from '../components/StatCard.jsx';
import FloodMap from '../components/FloodMap.jsx';
import MapControls from '../components/MapControls.jsx';
import { Droplets, AlertOctagon, Home, Ban, MapPin, BarChart2, ListFilter, AlertCircle } from 'lucide-react';
import { selectSummaryStats } from '../features/dashboard/dashboardSelectors.js';

/**
 * DashboardLayout
 * Structural layout container supporting desktop, tablet, and mobile viewports.
 * Manages central UI state: selectedZoneId and visibleLayers (architecture.md Section 4).
 */
export default function DashboardLayout({
  data,
  loading = false,
  error = null,
  onRefresh,
}) {
  // Single source of truth for selection and layer visibility (architecture.md section 4)
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState({
    flood: true,
    risk: true,
    roads: true,
    facilities: true,
    routes: true,
  });

  const stats = selectSummaryStats(data);
  const metadata = data?.metadata || {};

  const handleToggleLayer = useCallback((layerKey) => {
    setVisibleLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  }, []);

  const handleZoneSelect = useCallback((zoneId) => {
    setSelectedZoneId((prev) => (prev === zoneId ? null : zoneId));
  }, []);

  const selectedZone = data?.zones?.find((z) => z.zoneId === selectedZoneId) || null;

  return (
    <div className="min-h-screen bg-surface text-text flex flex-col overflow-x-hidden font-sans">
      {/* 1. Header */}
      <Header
        studyArea={metadata.studyArea}
        timestamp={metadata.generatedAt}
        dataMode={metadata.dataMode || 'demo'}
        onRefresh={onRefresh}
        loading={loading}
      />

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-4 lg:p-6 max-w-7xl w-full mx-auto space-y-4 lg:space-y-6">
        {/* Error notification banner if applicable */}
        {error && (
          <div
            className="p-3 bg-red-50 border border-risk-high text-risk-high rounded-card text-xs flex items-center justify-between"
            role="alert"
          >
            <div className="flex items-center space-x-2">
              <AlertOctagon className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={onRefresh}
              className="px-2 py-1 bg-risk-high text-white rounded text-xs hover:bg-red-800 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* 2. Stat Cards Grid */}
        <section
          aria-label="Key Operational Metrics"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          <StatCard
            title="Flooded area"
            value={stats.floodedAreaKm2}
            unit="km²"
            isDemo={stats.isDemo}
            icon={Droplets}
            variant="flood"
            caption={
              stats.floodedAreaIsPartial
                ? `Partial (${stats.floodedMissingCount} zone unassessed)`
                : 'Measured flood extent'
            }
          />
          <StatCard
            title="High-priority zones"
            value={stats.highPriorityCount}
            isDemo={stats.isDemo}
            icon={AlertOctagon}
            variant="highRisk"
            caption="Requiring immediate action"
          />
          <StatCard
            title="Exposed buildings"
            value={stats.exposedBuildingsCount}
            isDemo={stats.isDemo}
            icon={Home}
            variant="warning"
            caption={
              stats.exposedBuildingsIsPartial
                ? `Partial (${stats.bldgsMissingCount} zone unassessed)`
                : 'Structures within flood zone'
            }
          />
          <StatCard
            title="Blocked roadways"
            value={stats.blockedRoadsCount}
            isDemo={stats.isDemo}
            icon={Ban}
            variant="highRisk"
            caption="Severed transit corridors"
          />
        </section>

        {/* 3. Primary Workspace: Map & Side Panel (Responsive) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Map Container Area (Col span 8 on desktop) */}
          <section
            aria-label="Flood Map View"
            className="lg:col-span-8 bg-card border border-border rounded-card shadow-sm overflow-hidden flex flex-col h-[420px] sm:h-[480px] lg:h-[540px]"
          >
            <div className="px-4 py-3 border-b border-border bg-slate-50/50 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <MapPin className="w-4 h-4 text-flood" aria-hidden="true" />
                <span>Geospatial Flood Extent & Priority Zones</span>
              </div>
              <span className="text-xs text-text-muted bg-white px-2 py-0.5 rounded border border-border">
                {data?.zones?.length || 0} Zones • 5 Map Layers
              </span>
            </div>

            {/* Live Leaflet Map Container */}
            <div className="flex-1 relative w-full h-full min-h-0">
              <FloodMap
                floodGeoJSON={data?.floodExtent}
                riskZones={data?.zones || []}
                blockedRoads={data?.blockedRoads}
                facilities={data?.facilities}
                routes={data?.routes || []}
                selectedZoneId={selectedZoneId}
                visibleLayers={visibleLayers}
                onZoneSelect={handleZoneSelect}
                droppedCount={data?.droppedFeatureCount || 0}
              />
            </div>
          </section>

          {/* Side Panel: Controls & Details Container (Col span 4 on desktop) */}
          <aside
            aria-label="Layer Controls and Zone Details"
            className="lg:col-span-4 space-y-4"
          >
            {/* Layer Controls Switch Panel */}
            <MapControls
              visibleLayers={visibleLayers}
              onToggleLayer={handleToggleLayer}
              onResetExtent={() => {
                // Deselect zone when resetting extent
                setSelectedZoneId(null);
              }}
            />

            {/* Zone Details Inspection Box */}
            <div className="bg-card border border-border rounded-card shadow-sm p-4">
              <div className="flex items-center justify-between pb-2 border-b border-border mb-3">
                <h3 className="text-heading font-semibold text-text">
                  Zone Inspection Details
                </h3>
                {selectedZone && (
                  <span
                    className="px-2 py-0.5 rounded text-[11px] font-bold"
                    style={{
                      backgroundColor: `${selectedZone.riskLevel === 'HIGH' ? '#C62828' : selectedZone.riskLevel === 'MEDIUM' ? '#E69F00' : selectedZone.riskLevel === 'LOW' ? '#2E7D32' : '#6B7280'}20`,
                      color: selectedZone.riskLevel === 'HIGH' ? '#C62828' : selectedZone.riskLevel === 'MEDIUM' ? '#E69F00' : selectedZone.riskLevel === 'LOW' ? '#2E7D32' : '#6B7280',
                    }}
                  >
                    {selectedZone.riskLevel}
                  </span>
                )}
              </div>

              {selectedZone ? (
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="text-text-muted">Selected Zone</div>
                    <div className="font-bold text-sm text-navy-900">{selectedZone.name}</div>
                    {!selectedZone.hasGeometry && (
                      <div className="mt-1 flex items-center space-x-1 text-amber-700 font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Non-spatial staging area (No map polygon)</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div className="p-2 rounded bg-surface">
                      <span className="text-text-muted block text-[11px]">Priority Score</span>
                      <span className="font-bold text-sm text-text">
                        {selectedZone.riskScore !== null ? `${selectedZone.riskScore} / 100` : 'Not available'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-surface">
                      <span className="text-text-muted block text-[11px]">Flooded Area</span>
                      <span className="font-bold text-sm text-text">
                        {selectedZone.floodedAreaKm2 !== null ? `${selectedZone.floodedAreaKm2} km²` : 'Not available'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-surface">
                      <span className="text-text-muted block text-[11px]">Exposed Buildings</span>
                      <span className="font-bold text-sm text-text">
                        {selectedZone.exposedBuildings !== null ? selectedZone.exposedBuildings : 'Not available'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-surface">
                      <span className="text-text-muted block text-[11px]">Accessibility</span>
                      <span className="font-bold text-sm text-text">{selectedZone.accessibility}</span>
                    </div>
                  </div>

                  {selectedZone.reasons?.length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <span className="font-semibold text-text block mb-1">Operational Reasons:</span>
                      <ul className="list-disc list-inside space-y-0.5 text-text-muted">
                        {selectedZone.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedZoneId(null)}
                    className="w-full mt-2 py-1 text-xs text-text-muted hover:text-text border border-border rounded hover:bg-surface transition"
                  >
                    Clear Selection
                  </button>
                </div>
              ) : (
                <div className="text-caption text-text-muted flex flex-col items-center justify-center py-8 text-center">
                  <p>Select a zone polygon on the map or from the list below to inspect damage and accessibility.</p>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* 4. Secondary Workspace: Zone Directory & Analytical Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Zone Directory Container */}
          <section
            aria-label="Zone Priority Directory"
            className="lg:col-span-6 bg-card border border-border rounded-card shadow-sm p-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <ListFilter className="w-4 h-4 text-navy-700" aria-hidden="true" />
                <span>Zone Priority Directory</span>
              </div>
              <span className="text-caption text-text-muted">Click row to select</span>
            </div>
            <div className="space-y-2">
              {(data?.zones || []).slice(0, 5).map((zone) => {
                const isSelected = zone.zoneId === selectedZoneId;
                return (
                  <button
                    key={zone.zoneId}
                    type="button"
                    onClick={() => handleZoneSelect(zone.zoneId)}
                    className={`w-full text-left flex items-center justify-between p-2.5 rounded border transition text-xs ${
                      isSelected
                        ? 'border-navy-900 bg-slate-50 ring-2 ring-navy-900/20'
                        : 'border-border hover:border-navy-700/50 bg-white'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 truncate">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          zone.riskLevel === 'HIGH'
                            ? 'bg-red-100 text-risk-high'
                            : zone.riskLevel === 'MEDIUM'
                            ? 'bg-amber-100 text-risk-medium'
                            : zone.riskLevel === 'LOW'
                            ? 'bg-emerald-100 text-risk-low'
                            : 'bg-gray-100 text-risk-unknown'
                        }`}
                      >
                        {zone.riskLevel}
                      </span>
                      <span className="font-medium text-text truncate">{zone.name}</span>
                      {!zone.hasGeometry && (
                        <span className="text-[10px] text-amber-700 italic">No shape</span>
                      )}
                    </div>
                    <div className="text-text-muted text-right shrink-0">
                      {zone.riskScore !== null ? `Score: ${zone.riskScore}` : 'Score: N/A'}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Analytical Charts Container */}
          <section
            aria-label="Risk Distribution and Impact Charts"
            className="lg:col-span-6 bg-card border border-border rounded-card shadow-sm p-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <BarChart2 className="w-4 h-4 text-navy-700" aria-hidden="true" />
                <span>Impact Analytics</span>
              </div>
              <span className="text-caption text-text-muted">Overview</span>
            </div>
            <div className="h-48 bg-surface rounded flex items-center justify-center text-caption text-text-muted text-center p-4">
              <p>Risk Distribution and Building Impact analytics charts container (Recharts).</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
