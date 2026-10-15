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
import CachedBanner from '../components/CachedBanner.jsx';
import SurveyNeededList from '../components/SurveyNeededList.jsx';
import ErrorState from '../components/states/ErrorState.jsx';
import EmptyState from '../components/states/EmptyState.jsx';
import {
  Droplets,
  AlertOctagon,
  AlertTriangle,
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
  lastRefreshedAt = null,
}) {
  // 1. Single source of truth for selection and layer visibility (architecture.md section 4)
  const [selectedZoneId, setSelectedZoneId] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('zone') || p.get('tile') || null;
    }
    return null;
  });
  const [resetTrigger, setResetTrigger] = useState(0);
  const [visibleLayers, setVisibleLayers] = useState({
    flood: true,
    risk: true,
    roads: true,
    facilities: true,
    routes: false,
    buildings: false,
    floodGroundTruth: true,
    floodPredicted: true,
  });
  const [modelMode, setModelMode] = useState('fast');
  const [selectedTileId, setSelectedTileId] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('tile') || 'ALL';
    }
    return 'ALL';
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

  const availableTiles = useMemo(() => {
    const tileSet = new Set();
    const addFromCollection = (fc) => {
      if (fc && Array.isArray(fc.features)) {
        for (const f of fc.features) {
          if (f.properties?.tile_id) tileSet.add(f.properties.tile_id);
        }
      }
    };
    addFromCollection(data?.floodGroundTruth);
    addFromCollection(data?.floodPredictedFast);
    addFromCollection(data?.floodPredictedAccurate);
    if (Array.isArray(allZones)) {
      for (const z of allZones) {
        if (z.zoneId && (z.zoneId.startsWith('0_') || z.zoneId.includes('_'))) {
          tileSet.add(z.zoneId);
        }
      }
    }
    return Array.from(tileSet).sort();
  }, [data?.floodGroundTruth, data?.floodPredictedFast, data?.floodPredictedAccurate, allZones]);

  const hasFloodWatch = useMemo(() => {
    return Boolean(
      data?.floodGroundTruth ||
      data?.floodPredictedFast ||
      data?.floodPredictedAccurate ||
      availableTiles.length > 0 ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DATA_SOURCE === 'mock-floodwatch')
    );
  }, [data?.floodGroundTruth, data?.floodPredictedFast, data?.floodPredictedAccurate, availableTiles.length]);

  const isFloodwatchMode = useMemo(() => {
    return Boolean(
      metadata.dataSource === 'mock-floodwatch' ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DATA_SOURCE === 'mock-floodwatch') ||
      (Array.isArray(allZones) && allZones.length > 0 && allZones.some((z) => typeof z.observed_flooded_count === 'number'))
    );
  }, [metadata.dataSource, allZones]);

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
        dataSource={metadata.dataSource}
        source={metadata.source}
        onRefresh={onRefresh}
        loading={loading}
        lastRefreshedAt={lastRefreshedAt || metadata.lastRefreshedAt}
      />

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-4 lg:p-6 max-w-7xl w-full mx-auto space-y-4 lg:space-y-6">
        {/* Cached snapshot banner when network fetch failed and offline cache is used */}
        <CachedBanner
          isFromCache={metadata.isFromCache}
          cachedAt={metadata.cachedAt}
          onRefresh={onRefresh}
        />

        {/* Stale data banner (T5.2, FR-51) - suppressed when dataMode is "demo" or when cached banner is shown */}
        {!metadata.isFromCache && (
          <StaleBanner
            generatedAt={metadata.generatedAt}
            dataMode={metadata.dataMode || 'demo'}
            onRefresh={onRefresh}
          />
        )}

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
          {isFloodwatchMode ? (
            <>
              <StatCard
                title="Observed flooded buildings (labels)"
                value={stats.observedBuildingsCount}
                isDemo={false}
                icon={Home}
                variant="warning"
                caption={
                  stats.isFiltered
                    ? `Filtered view: ${stats.activeZoneCount} of ${stats.totalZoneCount} tiles`
                    : 'Human SpaceNet 8 building labels'
                }
              />
              <StatCard
                title="Observed flooded roads (labels)"
                value={stats.observedRoadsCount}
                isDemo={false}
                icon={Ban}
                variant="highRisk"
                caption={
                  stats.isFiltered
                    ? `Filtered view: ${stats.activeZoneCount} of ${stats.totalZoneCount} tiles`
                    : 'Human SpaceNet 8 road labels'
                }
              />
              <StatCard
                title="Model mask pixels (derived)"
                value={
                  modelMode === 'accurate'
                    ? stats.modelMaskPixelsAccurate?.toLocaleString('en-US')
                    : stats.modelMaskPixelsFast?.toLocaleString('en-US')
                }
                unit="px"
                isDemo={false}
                icon={Droplets}
                variant="flood"
                caption={
                  modelMode === 'accurate'
                    ? 'Accurate mode (SegFormer-B0 derived)'
                    : 'Fast mode (SegFormer-B0 derived)'
                }
              />
              <StatCard
                title="Monitored tiles"
                value={stats.activeZoneCount}
                isDemo={false}
                icon={MapPin}
                variant="default"
                caption={
                  stats.isFiltered
                    ? `Filtered view: ${stats.activeZoneCount} of ${stats.totalZoneCount} tiles`
                    : 'SpaceNet 8 Germany AOI'
                }
              />
            </>
          ) : (
            <>
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
                    : 'Derived from labelled flooded buildings/roads, not a measured water boundary'
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
                    ? 'Partial: one zone is a designated test case with the value withheld'
                    : 'Structures within flood zone'
                }
              />
              <StatCard
                title="Blocked roadways"
                value={stats.blockedRoadsCount}
                isDemo={stats.isDemo}
                icon={Ban}
                variant="highRisk"
                caption="Roads labelled flooded in ground-truth data"
              />
            </>
          )}
        </section>

        {/* Demo Mode Risk Disclaimer (Requirement 4) */}
        {metadata.dataMode === 'demo' && !isFloodwatchMode && (
          <div
            role="note"
            aria-label="Demo Risk Scores Notice"
            className="flex items-center space-x-2 px-3 py-2 rounded-card bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium shadow-sm"
          >
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
            <span>Risk scores are illustrative (demo formula), not from the risk engine.</span>
          </div>
        )}

        {/* Empty state when no zones reported (FR-50, T5.1) */}
        {allZones.length === 0 && !loading && (
          <EmptyState onRefresh={onRefresh} loading={loading} />
        )}

        {/* 3. Primary Workspace: Map & Side Panel (Responsive) */}
        {allZones.length > 0 && (
          <>
            <div className="space-y-4 lg:space-y-6">
              {/* Primary Map Workspace: Unobstructed Map with Docked Side Panel */}
              <section
                aria-label="Flood Map View"
                className="w-full bg-card border border-border rounded-card shadow-sm overflow-hidden flex flex-col h-[65vh] min-h-[480px] lg:h-[620px]"
              >
                <div className="px-4 py-3 border-b border-border bg-slate-50/50 flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                    <MapPin className="w-4 h-4 text-flood" aria-hidden="true" />
                    <span>Geospatial Flood Extent & Priority Zones</span>
                  </div>
                  <span className="text-xs text-text-muted bg-white px-2 py-0.5 rounded border border-border">
                    {allZones.length} Zones • {hasFloodWatch ? '8' : '6'} Map Layers
                  </span>
                </div>

                {/* Live Leaflet Map Container with Docked Side Panel */}
                <div className="flex-1 relative w-full h-full min-h-0">
                  <FloodMap
                    floodGeoJSON={data?.floodExtent}
                    riskZones={allZones}
                    blockedRoads={data?.blockedRoads}
                    facilities={data?.facilities}
                    routes={data?.routes || []}
                    buildingsExposed={data?.buildingsExposed}
                    floodGroundTruth={data?.floodGroundTruth}
                    floodPredictedFast={data?.floodPredictedFast}
                    floodPredictedAccurate={data?.floodPredictedAccurate}
                    selectedZoneId={selectedZoneId}
                    visibleLayers={visibleLayers}
                    onToggleLayer={handleToggleLayer}
                    onZoneSelect={handleZoneSelect}
                    droppedCount={data?.droppedFeatureCount || 0}
                    resetTrigger={resetTrigger}
                    onResetExtent={handleResetExtent}
                    layerErrors={data?.layerErrors}
                    isFromCache={metadata.isFromCache}
                    cachedAt={metadata.cachedAt}
                    modelMode={modelMode}
                    onChangeModelMode={setModelMode}
                    selectedTileId={selectedTileId}
                    onSelectTile={setSelectedTileId}
                  />
                </div>
              </section>

              {/* Inspection & Priority Zone Details Row (Tablet & Desktop) */}
              <aside
                aria-label="Layer Controls and Zone Details"
                className="hidden sm:grid sm:grid-cols-2 gap-4 lg:gap-6 items-start"
              >
                {/* Zone Details Inspection Panel (FR-20, FR-21, T4.5) */}
                <ZoneDetails
                  zone={selectedZone}
                  timestamp={metadata.generatedAt}
                  onClearSelection={() => setSelectedZoneId(null)}
                  isTestFixture={metadata.dataMode === 'demo' && !isFloodwatchMode}
                />

                {/* Aerial Reconnaissance Survey Needed List */}
                <SurveyNeededList
                  zones={allZones}
                  onSelectZone={handleZoneSelect}
                  selectedZoneId={selectedZoneId}
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
                aria-label={isFloodwatchMode ? "Observed and Model Feature Analytics" : "Impact Analytics and Risk Charts"}
                className="lg:col-span-6 bg-card border border-border rounded-card shadow-sm p-4 space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div className="flex items-center space-x-2 text-text font-semibold text-sm">
                    <BarChart2 className="w-4 h-4 text-navy-700" aria-hidden="true" />
                    <span>{isFloodwatchMode ? "Feature Analytics" : "Impact Analytics"}</span>
                  </div>
                  <span className="text-caption text-text-muted">
                    {isFloodwatchMode
                      ? "Real counts from SpaceNet 8 labels & model masks"
                      : (filters.riskLevel !== 'ALL' || filters.search ? 'Filtered Scope' : 'Full Scope')}
                  </span>
                </div>

                {/* Charts Grid: Risk Distribution & Top Impacted Zones (FR-30, FR-31, T4.9) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <RiskDistributionChart zones={filteredZones} isFloodwatchMode={isFloodwatchMode} />
                  <ImpactChart zones={filteredZones} isFloodwatchMode={isFloodwatchMode} />
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
                <div className="space-y-4">
                  <ZoneDetails
                    zone={selectedZone}
                    timestamp={metadata.generatedAt}
                    onClearSelection={() => setSelectedZoneId(null)}
                    isTestFixture={metadata.dataMode === 'demo' && !isFloodwatchMode}
                  />
                  <SurveyNeededList
                    zones={allZones}
                    onSelectZone={(zoneId) => {
                      handleZoneSelect(zoneId);
                    }}
                    selectedZoneId={selectedZoneId}
                  />
                </div>
              )}

              {mobileDrawerTab === 'controls' && (
                <MapControls
                  visibleLayers={visibleLayers}
                  onToggleLayer={handleToggleLayer}
                  onResetExtent={handleResetExtent}
                  modelMode={modelMode}
                  onChangeModelMode={setModelMode}
                  availableTiles={availableTiles}
                  selectedTileId={selectedTileId}
                  onSelectTile={setSelectedTileId}
                  hasFloodWatch={hasFloodWatch}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
