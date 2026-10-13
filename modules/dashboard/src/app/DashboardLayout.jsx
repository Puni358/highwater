import React from 'react';
import Header from '../components/Header.jsx';
import StatCard from '../components/StatCard.jsx';
import { Droplets, AlertOctagon, Home, Ban, MapPin, Layers, BarChart2, ListFilter } from 'lucide-react';
import { selectSummaryStats } from '../features/dashboard/dashboardSelectors.js';

/**
 * DashboardLayout
 * Structural layout container supporting desktop, tablet, and mobile viewports.
 * AC: No layout break at 360px, 768px, and 1280px.
 */
export default function DashboardLayout({
  data,
  loading = false,
  error = null,
  onRefresh,
}) {
  const stats = selectSummaryStats(data);
  const metadata = data?.metadata || {};

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

        {/* 2. Stat Cards Grid (Responsive: 1-col on mobile, 2-col on tablet, 4-col on desktop) */}
        <section
          aria-label="Key Operational Metrics"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          <StatCard
            title="Inundated Area"
            value={stats.floodedAreaKm2}
            unit="km²"
            isDemo={stats.isDemo}
            icon={Droplets}
            variant="flood"
            caption="Measured flood extent"
          />
          <StatCard
            title="High Priority Zones"
            value={stats.highPriorityCount}
            isDemo={stats.isDemo}
            icon={AlertOctagon}
            variant="highRisk"
            caption="Requiring immediate action"
          />
          <StatCard
            title="Exposed Buildings"
            value={stats.exposedBuildingsCount}
            isDemo={stats.isDemo}
            icon={Home}
            variant="warning"
            caption="Structures within flood zone"
          />
          <StatCard
            title="Blocked Roadways"
            value={stats.blockedRoadsCount}
            isDemo={stats.isDemo}
            icon={Ban}
            variant="highRisk"
            caption="Severed transit corridors"
          />
        </section>

        {/* 3. Primary Workspace: Map & Side Panel (Responsive: 2-col on lg, stacked on mobile/tablet) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Map Container Area (Col span 8 on desktop) */}
          <section
            aria-label="Flood Map View"
            className="lg:col-span-8 bg-card border border-border rounded-card shadow-sm overflow-hidden flex flex-col min-h-[320px] sm:min-h-[420px] lg:min-h-[500px]"
          >
            <div className="px-4 py-3 border-b border-border bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <MapPin className="w-4 h-4 text-flood" aria-hidden="true" />
                <span>Geospatial Flood Extent & Priority Zones</span>
              </div>
              <span className="text-xs text-text-muted bg-white px-2 py-0.5 rounded border border-border">
                {data?.zones?.length || 0} Zones Loaded
              </span>
            </div>

            {/* Map Canvas Placeholder (Phase 2 static, replaced by FloodMap in Phase 3) */}
            <div
              id="map-viewport"
              className="flex-1 bg-slate-100 flex flex-col items-center justify-center p-6 text-center text-text-muted relative min-h-[280px]"
            >
              <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-3 text-flood">
                <MapPin className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="text-heading font-semibold text-text mb-1">Interactive Map Surface</h3>
              <p className="text-caption max-w-sm">
                Leaflet GIS engine container. Displays deterministic flood polygons, blocked roads, and priority zones.
              </p>
            </div>
          </section>

          {/* Side Panel: Controls & Details Container (Col span 4 on desktop) */}
          <aside
            aria-label="Layer Controls and Zone Details"
            className="lg:col-span-4 space-y-4"
          >
            {/* Layer Controls Box */}
            <div className="bg-card border border-border rounded-card shadow-sm p-4">
              <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
                <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                  <Layers className="w-4 h-4 text-navy-700" aria-hidden="true" />
                  <span>Layer Overlays</span>
                </div>
                <span className="text-caption text-text-muted">4 of 5 Enabled</span>
              </div>
              <div className="space-y-2 text-xs text-text-muted">
                <div className="flex items-center justify-between p-2 rounded bg-surface">
                  <span>Flood Extent Overlay</span>
                  <span className="text-emerald-600 font-semibold">Active</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-surface">
                  <span>Risk Zones Classification</span>
                  <span className="text-emerald-600 font-semibold">Active</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-surface">
                  <span>Blocked Roads (Corridors)</span>
                  <span className="text-emerald-600 font-semibold">Active</span>
                </div>
              </div>
            </div>

            {/* Zone Details Box */}
            <div className="bg-card border border-border rounded-card shadow-sm p-4 min-h-[200px]">
              <h3 className="text-heading font-semibold text-text pb-2 border-b border-border mb-3">
                Zone Inspection Details
              </h3>
              <div className="text-caption text-text-muted flex flex-col items-center justify-center py-6 text-center">
                <p>Select a zone from the map or directory to inspect damage metrics and evacuation routes.</p>
              </div>
            </div>
          </aside>
        </div>

        {/* 4. Secondary Workspace: Zone Directory & Analytical Charts (Responsive: 2-col on lg, stacked on mobile/tablet) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Zone Directory Container (Col span 6) */}
          <section
            aria-label="Zone Priority Directory"
            className="lg:col-span-6 bg-card border border-border rounded-card shadow-sm p-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <ListFilter className="w-4 h-4 text-navy-700" aria-hidden="true" />
                <span>Zone Priority Directory</span>
              </div>
              <span className="text-caption text-text-muted">Sorted by Priority</span>
            </div>
            <div className="space-y-2">
              {(data?.zones || []).slice(0, 4).map((zone) => (
                <div
                  key={zone.zoneId}
                  className="flex items-center justify-between p-2.5 rounded border border-border hover:border-navy-700/50 bg-white transition text-xs"
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
                  </div>
                  <div className="text-text-muted text-right shrink-0">
                    {zone.riskScore !== null ? `Score: ${zone.riskScore}` : 'Score: N/A'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Analytical Charts Container (Col span 6) */}
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
            <div className="h-44 bg-surface rounded flex items-center justify-center text-caption text-text-muted text-center p-4">
              <p>Risk Distribution and Building Impact analytics charts container (Recharts).</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
