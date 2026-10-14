import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Header from '../components/Header.jsx';
import StatCard from '../components/StatCard.jsx';
import FloodMap from '../components/FloodMap.jsx';
import MapControls from '../components/MapControls.jsx';
import ZoneDetails from '../components/ZoneDetails.jsx';
import FilterBar from '../components/FilterBar.jsx';
import ZoneList from '../components/ZoneList.jsx';
import RiskDistributionChart from '../components/RiskDistributionChart.jsx';
import ImpactChart from '../components/ImpactChart.jsx';
import StaleBanner from '../components/StaleBanner.jsx';
import ErrorState from '../components/states/ErrorState.jsx';
import EmptyState from '../components/states/EmptyState.jsx';
import {
  Droplets,
  AlertOctagon,
  Home,
  Ban,
  MapPin,
  BarChart2,
  ListFilter,
  SlidersHorizontal,
  X,
} from 'lucide-react';
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

  // 3. Mobile drawer state (T5.4)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [mobileDrawerTab, setMobileDrawerTab] = useState('list'); // 'list' | 'details' | 'controls'

  const metadata = data?.metadata || {};
  const allZones = data?.zones || [];

  // Invalidate map size whenever drawer opens or closes (T5.4)
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);
    return () => clearTimeout(timer);
  }, [isMobileDrawerOpen]);

  // If a zone is selected on mobile, auto-switch drawer tab to 'details'
  useEffect(() => {
    if (selectedZoneId) {
      setMobileDrawerTab('details');
    }
  }, [selectedZoneId]);

  // 4. Derived collections (memoised, no duplicate state per architecture.md)
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
    <div className="min-h-screen bg-surface text-text flex flex-col overflow-x-hidden font-sans relative">
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
        {/* Stale data banner (T5.2, FR-51) - suppressed when dataMode is "demo" */}
        <StaleBanner
          generatedAt={metadata.generatedAt}
          dataMode={metadata.dataMode || 'demo'}
          onRefresh={onRefresh}
        />

        {/* Error notification banner if applicable (FR-50) */}
        {error && (
          <ErrorState
            error={error}
            onRetry={onRefresh}
            loading={loading}
          />
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
              stats.isFiltered
                ? `Filtered view: ${stats.activeZoneCount} of ${stats.totalZoneCount} zones`
                : stats.floodedAreaIsPartial
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
            caption={
              stats.isFiltered
                ? `Filtered view: ${stats.activeZoneCount} of ${stats.totalZoneCount} zones`
                : 'Requiring immediate action'
            }
          />
          <StatCard
            title="Exposed buildings"
            value={stats.exposedBuildingsCount}
            isDemo={stats.isDemo}
            icon={Home}
            variant="warning"
            caption={
              stats.isFiltered
                ? `Filtered view: ${stats.activeZoneCount} of ${stats.totalZoneCount} zones`
                : stats.exposedBuildingsIsPartial
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
            caption="Study area total (infrastructure layer)"
          />
        </section>

        {/* Empty state when no zones reported (FR-50, T5.1) */}
        {allZones.length === 0 && !loading && (
          <EmptyState onRefresh={onRefresh} loading={loading} />
        )}

        {/* 3. Primary Workspace: Map & Side Panel (Responsive) */}
        {allZones.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 lg:gap-6 items-start">
              {/* Map Container Area (Col span 7 on tablet, 8 on desktop, full on mobile < 640px) */}
              <section
                aria-label="Flood Map View"
                className="sm:col-span-7 lg:col-span-8 bg-card border border-border rounded-card shadow-sm overflow-hidden flex flex-col h-[50vh] min-h-[380px] sm:h-[480px] lg:h-[560px]"
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
                    layerErrors={data?.layerErrors}
                  />
                </div>
              </section>

              {/* Side Panel on Tablet & Desktop: Controls & Details Container (Hidden under 640px mobile, moved to drawer) */}
              <aside
                aria-label="Layer Controls and Zone Details"
                className="hidden sm:block sm:col-span-5 lg:col-span-4 space-y-4"
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
          </>
        )}
      </main>

      {/* Floating Drawer Trigger for Mobile (< 640px) (T5.4) */}
      <div className="sm:hidden fixed bottom-4 right-4 z-[1000]">
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(true)}
          aria-label="Open mobile inspection drawer"
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-full bg-navy-900 text-white font-semibold text-xs shadow-lg hover:bg-navy-700 active:scale-95 transition focus:outline-none focus:ring-2 focus:ring-flood"
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          <span>Filters & Details</span>
          {selectedZone && (
            <span
              className="w-2 h-2 rounded-full bg-flood"
              title="Zone selected"
            />
          )}
        </button>
      </div>

      {/* Mobile Drawer Overlay and Sheet (T5.4) */}
      {isMobileDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation and Inspection Drawer"
          className="fixed inset-0 z-[1001] flex flex-col justify-end"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-navy-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Sheet */}
          <div className="relative bg-surface border-t border-border rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col z-[1002] w-full">
            {/* Header & Close Button */}
            <div className="p-3 bg-white border-b border-border rounded-t-2xl flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-navy-900">
                  Operational Inspector
                </span>
                {selectedZone && (
                  <span className="text-[11px] text-text-muted">
                    ({selectedZone.name})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                aria-label="Close mobile drawer"
                className="p-1.5 rounded-full text-text-muted hover:text-text hover:bg-slate-100 transition min-w-[36px] min-h-[36px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-navy-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile Tab Navigation */}
            <div className="flex border-b border-border bg-slate-50 shrink-0 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMobileDrawerTab('list')}
                className={`flex-1 py-2.5 text-center border-b-2 transition ${
                  mobileDrawerTab === 'list'
                    ? 'border-navy-900 text-navy-900 bg-white'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                Zones & Filters
              </button>
              <button
                type="button"
                onClick={() => setMobileDrawerTab('details')}
                className={`flex-1 py-2.5 text-center border-b-2 transition ${
                  mobileDrawerTab === 'details'
                    ? 'border-navy-900 text-navy-900 bg-white'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                Inspection Details
              </button>
              <button
                type="button"
                onClick={() => setMobileDrawerTab('controls')}
                className={`flex-1 py-2.5 text-center border-b-2 transition ${
                  mobileDrawerTab === 'controls'
                    ? 'border-navy-900 text-navy-900 bg-white'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                Map Layers
              </button>
            </div>

            {/* Tab Panels */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              {mobileDrawerTab === 'list' && (
                <div className="space-y-3">
                  <FilterBar
                    filters={filters}
                    sortBy={sortBy}
                    onFilterChange={setFilters}
                    onSortChange={setSortBy}
                    totalCount={allZones.length}
                    filteredCount={filteredZones.length}
                  />
                  <ZoneList
                    zones={sortedZones}
                    selectedZoneId={selectedZoneId}
                    onZoneSelect={(zoneId) => {
                      handleZoneSelect(zoneId);
                      setMobileDrawerTab('details');
                    }}
                  />
                </div>
              )}

              {mobileDrawerTab === 'details' && (
                <ZoneDetails
                  zone={selectedZone}
                  timestamp={metadata.generatedAt}
                  onClearSelection={() => setSelectedZoneId(null)}
                />
              )}

              {mobileDrawerTab === 'controls' && (
                <MapControls
                  visibleLayers={visibleLayers}
                  onToggleLayer={handleToggleLayer}
                  onResetExtent={handleResetExtent}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
