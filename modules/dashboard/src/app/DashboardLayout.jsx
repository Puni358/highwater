import React, { useState, useCallback, useMemo } from 'react';
import Header from '../components/Header.jsx';
import StatCard from '../components/StatCard.jsx';
import FloodMap from '../components/FloodMap.jsx';
import MapControls from '../components/MapControls.jsx';
import ZoneDetails from '../components/ZoneDetails.jsx';
import FilterBar from '../components/FilterBar.jsx';
import ZoneList from '../components/ZoneList.jsx';
import RiskDistributionChart from '../components/RiskDistributionChart.jsx';
import ImpactChart from '../components/ImpactChart.jsx';
import { Droplets, AlertOctagon, Home, Ban, MapPin, BarChart2, ListFilter } from 'lucide-react';
import { selectSummaryStats } from '../features/dashboard/dashboardSelectors.js';
import { filterZones, sortZones } from '../features/zones/zoneUtils.js';

/**
 * DashboardLayout
 * Structural layout container supporting desktop, tablet, and mobile viewports.
 * Manages central UI state: selectedZoneId, visibleLayers, filters, sortBy (architecture.md Section 4).
 * Single source of truth for selection across map, zone list, and inspection details.
 */
export default function DashboardLayout({
  data,
  loading = false,
  error = null,
  onRefresh,
}) {
  // 1. Single source of truth for selection and layer visibility (architecture.md section 4)
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [visibleLayers, setVisibleLayers] = useState({
    flood: true,
    risk: true,
    roads: true,
    facilities: true,
    routes: true,
  });

  // 2. Filter & Sort state
  const [filters, setFilters] = useState({ search: '', riskLevel: 'ALL' });
  const [sortBy, setSortBy] = useState('priority');

  const metadata = data?.metadata || {};
  const allZones = data?.zones || [];

  // 3. Derived collections (memoised, no duplicate state per architecture.md)
  const filteredZones = useMemo(() => {
    return filterZones(allZones, filters);
  }, [allZones, filters]);

  const sortedZones = useMemo(() => {
    return sortZones(filteredZones, sortBy);
  }, [filteredZones, sortBy]);

  // Summary stats follow the filtered set per T4.8 filter policy
  const stats = useMemo(() => {
    return selectSummaryStats(data, filteredZones);
  }, [data, filteredZones]);

  // Selected zone object
  const selectedZone = useMemo(() => {
    return allZones.find((z) => z.zoneId === selectedZoneId) || null;
  }, [allZones, selectedZoneId]);

  // Handlers
  const handleToggleLayer = useCallback((layerKey) => {
    setVisibleLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  }, []);

  const handleZoneSelect = useCallback((zoneId) => {
    setSelectedZoneId((prev) => (prev === zoneId ? null : zoneId));
  }, []);

  const handleResetExtent = useCallback(() => {
    setSelectedZoneId(null);
    setResetTrigger((prev) => prev + 1);
  }, []);

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
            className="lg:col-span-8 bg-card border border-border rounded-card shadow-sm overflow-hidden flex flex-col h-[420px] sm:h-[480px] lg:h-[560px]"
          >
            <div className="px-4 py-3 border-b border-border bg-slate-50/50 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <MapPin className="w-4 h-4 text-flood" aria-hidden="true" />
                <span>Geospatial Flood Extent & Priority Zones</span>
              </div>
              <span className="text-xs text-text-muted bg-white px-2 py-0.5 rounded border border-border">
                {allZones.length} Zones • 5 Map Layers
              </span>
            </div>

            {/* Live Leaflet Map Container */}
            <div className="flex-1 relative w-full h-full min-h-0">
              <FloodMap
                floodGeoJSON={data?.floodExtent}
                riskZones={allZones}
                blockedRoads={data?.blockedRoads}
                facilities={data?.facilities}
                routes={data?.routes || []}
                selectedZoneId={selectedZoneId}
                visibleLayers={visibleLayers}
                onZoneSelect={handleZoneSelect}
                droppedCount={data?.droppedFeatureCount || 0}
                resetTrigger={resetTrigger}
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
              onResetExtent={handleResetExtent}
            />

            {/* Zone Details Inspection Panel (FR-20, FR-21, T4.5) */}
            <ZoneDetails
              zone={selectedZone}
              timestamp={metadata.generatedAt}
              onClearSelection={() => setSelectedZoneId(null)}
            />
          </aside>
        </div>

        {/* 4. Secondary Workspace: Zone Directory & Analytical Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Zone Directory Container (Col span 6 on desktop) */}
          <section
            aria-label="Zone Priority Directory"
            className="lg:col-span-6 bg-card border border-border rounded-card shadow-sm p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <ListFilter className="w-4 h-4 text-navy-700" aria-hidden="true" />
                <span>Zone Priority Directory</span>
              </div>
              <span className="text-caption text-text-muted">
                Click row to inspect & pan map
              </span>
            </div>

            {/* Filter and Sort Controls (FR-22, FR-23, T4.4, T4.8) */}
            <FilterBar
              filters={filters}
              sortBy={sortBy}
              onFilterChange={setFilters}
              onSortChange={setSortBy}
              totalCount={allZones.length}
              filteredCount={filteredZones.length}
            />

            {/* Interactive Zone List with auto-scroll and selection (FR-24, FR-26) */}
            <ZoneList
              zones={sortedZones}
              selectedZoneId={selectedZoneId}
              onZoneSelect={handleZoneSelect}
            />
          </section>

          {/* Analytical Charts Container (Col span 6 on desktop) */}
          <section
            aria-label="Impact Analytics and Risk Charts"
            className="lg:col-span-6 bg-card border border-border rounded-card shadow-sm p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                <BarChart2 className="w-4 h-4 text-navy-700" aria-hidden="true" />
                <span>Impact Analytics</span>
              </div>
              <span className="text-caption text-text-muted">
                {filters.riskLevel !== 'ALL' || filters.search ? 'Filtered Scope' : 'Full Scope'}
              </span>
            </div>

            {/* Charts Grid: Risk Distribution & Top Impacted Zones (FR-30, FR-31, T4.9) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RiskDistributionChart zones={filteredZones} />
              <ImpactChart zones={filteredZones} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
