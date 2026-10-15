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
 * DashboardLayout (Survey Plate Master Layout)
 * Cartographic Survey Sheet with:
 * - Title Block Header
 * - Verifiable Survey Statistics
 * - Geospatial Survey Map Plate with 2D / 3D Relief Projection & Docked Side Panel
 * - Inspection & Priority Zone Details Row (Tablet & Desktop)
 * - Sector Priority Directory & Analytical Charts
 */
export default function DashboardLayout({
  data,
  loading = false,
  error = null,
  onRefresh,
  lastRefreshedAt = null,
}) {
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

  const [filters, setFilters] = useState({ search: '', riskLevel: 'ALL' });
  const [sortBy, setSortBy] = useState('priority');

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [mobileDrawerTab, setMobileDrawerTab] = useState('list'); // 'list' | 'details' | 'controls'

  const metadata = data?.metadata || {};
  const allZones = data?.zones || [];

  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);
    return () => clearTimeout(timer);
  }, [isMobileDrawerOpen]);

  useEffect(() => {
    if (selectedZoneId) {
      setMobileDrawerTab('details');
    }
  }, [selectedZoneId]);

  const filteredZones = useMemo(() => {
    return filterZones(allZones, filters);
  }, [allZones, filters]);

  const sortedZones = useMemo(() => {
    return sortZones(filteredZones, sortBy);
  }, [filteredZones, sortBy]);

  const stats = useMemo(() => {
    return selectSummaryStats(data, filteredZones);
  }, [data, filteredZones]);

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
    <div className="min-h-screen bg-paper text-ink flex flex-col overflow-x-hidden font-sans relative">
      {/* 1. Cartographic Title Block Header */}
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

      {/* Main Survey Workspace */}
      <main className="flex-1 p-3 sm:p-4 lg:p-6 max-w-7xl w-full mx-auto space-y-4 lg:space-y-6">
        {/* Cached Snapshot Notice */}
        <CachedBanner
          isFromCache={metadata.isFromCache}
          cachedAt={metadata.cachedAt}
          onRefresh={onRefresh}
        />

        {/* Stale Survey Data Notice */}
        {!metadata.isFromCache && (
          <StaleBanner
            generatedAt={metadata.generatedAt}
            dataMode={metadata.dataMode || 'demo'}
            onRefresh={onRefresh}
          />
        )}

        {/* System Error Notification */}
        {error && (
          <ErrorState
            error={error}
            onRetry={onRefresh}
            loading={loading}
          />
        )}

        {/* 2. Key Operational Metrics */}
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
                    : 'Annotated labels (SpaceNet 8)'
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
                    : 'Road network survey'
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
                    ? 'Accurate neural segmentation'
                    : 'Fast neural segmentation'
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
                    : 'Operational sector coverage'
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

        {/* Empty state when no zones reported */}
        {allZones.length === 0 && !loading && (
          <EmptyState onRefresh={onRefresh} loading={loading} />
        )}

        {/* 3. Primary Workspace: Map & Inspection Details */}
        {allZones.length > 0 && (
          <>
            <div className="space-y-4 lg:space-y-6">
              {/* Primary Map Workspace: Unobstructed Map Plate with Docked Side Panel */}
              <section
                aria-label="Flood Map View"
                className="w-full bg-plate border border-hairline rounded overflow-hidden flex flex-col h-[65vh] min-h-[480px] lg:h-[640px]"
              >
                <div className="px-4 py-2.5 border-b border-hairline bg-paper flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-2 text-ink font-serif font-bold text-sm">
                    <MapPin className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                    <span>Geospatial Flood Extent & Priority Zones</span>
                  </div>
                  <span className="text-xs text-ink-muted bg-plate px-2 py-0.5 rounded border border-hairline">
                    {allZones.length} Zones • {hasFloodWatch ? '8' : '6'} Map Layers
                  </span>
                </div>

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
                <ZoneDetails
                  zone={selectedZone}
                  timestamp={metadata.generatedAt}
                  onClearSelection={() => setSelectedZoneId(null)}
                  isTestFixture={metadata.dataMode === 'demo' && !isFloodwatchMode}
                />

                <SurveyNeededList
                  zones={allZones}
                  onSelectZone={handleZoneSelect}
                  selectedZoneId={selectedZoneId}
                />
              </aside>
            </div>

            {/* 4. Secondary Workspace: Zone Directory & Analytical Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start no-print">
              {/* Zone Directory Container */}
              <section
                aria-label="Zone Priority Directory"
                className="lg:col-span-6 bg-plate border border-hairline rounded p-4 space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-hairline">
                  <div className="flex items-center space-x-2 text-ink font-serif font-bold text-sm">
                    <ListFilter className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                    <span>Zone Priority Directory</span>
                  </div>
                  <span className="text-caption text-ink-muted">
                    Click row to inspect & pan map
                  </span>
                </div>

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
                  onZoneSelect={handleZoneSelect}
                />
              </section>

              {/* Analytical Charts */}
              <section
                aria-label={isFloodwatchMode ? "Observed and Model Feature Analytics" : "Impact Analytics and Risk Charts"}
                className="lg:col-span-6 bg-plate border border-hairline rounded p-4 space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-hairline">
                  <div className="flex items-center space-x-2 text-ink font-serif font-bold text-sm">
                    <BarChart2 className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                    <span>{isFloodwatchMode ? "Feature Analytics" : "Impact Analytics"}</span>
                  </div>
                  <span className="text-caption text-ink-muted">
                    {isFloodwatchMode
                      ? "Observed damage counts & neural segmentation masks"
                      : (filters.riskLevel !== 'ALL' || filters.search ? 'Filtered Scope' : 'Full Scope')}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <RiskDistributionChart zones={filteredZones} isFloodwatchMode={isFloodwatchMode} />
                  <ImpactChart zones={filteredZones} isFloodwatchMode={isFloodwatchMode} />
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {/* Floating Drawer Trigger for Mobile (< 640px) */}
      <div className="sm:hidden fixed bottom-4 right-4 z-[1000] no-print">
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(true)}
          aria-label="Open mobile inspection drawer"
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-full bg-ink text-paper font-semibold text-xs shadow-lg transition focus:outline-none cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          <span>Filters & Details</span>
          {selectedZone && (
            <span
              className="w-2 h-2 rounded-full bg-paper"
              title="Zone selected"
            />
          )}
        </button>
      </div>

      {/* Mobile Drawer Overlay and Sheet */}
      {isMobileDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation and Inspection Drawer"
          className="fixed inset-0 z-[1001] flex flex-col justify-end no-print"
        >
          <div
            className="fixed inset-0 bg-ink/40 transition-opacity"
            onClick={() => setIsMobileDrawerOpen(false)}
            aria-hidden="true"
          />

          <div className="relative bg-paper border-t border-hairline rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col z-[1002] w-full text-ink">
            <div className="p-3 bg-plate border-b border-hairline rounded-t-2xl flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                <span className="font-serif font-bold text-sm text-ink">
                  Operational Inspector
                </span>
                {selectedZone && (
                  <span className="text-[11px] text-ink-muted">
                    ({selectedZone.name})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                aria-label="Close mobile drawer"
                className="p-1.5 rounded-full text-ink-muted hover:text-ink hover:bg-hairline/40 transition min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-hairline bg-plate shrink-0 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMobileDrawerTab('list')}
                className={`flex-1 py-2.5 text-center border-b-2 transition cursor-pointer ${
                  mobileDrawerTab === 'list'
                    ? 'border-ink text-ink bg-paper'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                Zones & Filters
              </button>
              <button
                type="button"
                onClick={() => setMobileDrawerTab('details')}
                className={`flex-1 py-2.5 text-center border-b-2 transition cursor-pointer ${
                  mobileDrawerTab === 'details'
                    ? 'border-ink text-ink bg-paper'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                Inspection Details
              </button>
              <button
                type="button"
                onClick={() => setMobileDrawerTab('controls')}
                className={`flex-1 py-2.5 text-center border-b-2 transition cursor-pointer ${
                  mobileDrawerTab === 'controls'
                    ? 'border-ink text-ink bg-paper'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                Map Layers
              </button>
            </div>

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

      {/* PRINT SITUATION REPORT SHEET (Rendered only on print) */}
      <div className="hidden print-only p-8 text-black bg-white space-y-6">
        <div className="border-b-2 border-black pb-4">
          <h1 className="text-2xl font-serif font-bold uppercase tracking-wider">
            HIGHWATER • Cartographic Flood Survey Situation Report
          </h1>
          <div className="flex justify-between text-xs mt-2 font-mono">
            <span>Area of Interest: {metadata.studyArea || 'Not specified'}</span>
            <span>Generated: {metadata.generatedAt || 'N/A'}</span>
            <span>Data Source: {metadata.source || 'SpaceNet 8 / FloodWatch SegFormer-B0'}</span>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="font-serif font-bold text-sm uppercase">1. Key Operational Findings</h2>
          <div className="grid grid-cols-4 gap-4 text-xs border border-black p-3 font-mono">
            <div>Observed Flooded Buildings: <strong>{stats.observedBuildingsCount ?? 'N/A'}</strong></div>
            <div>Observed Flooded Roads: <strong>{stats.observedRoadsCount ?? 'N/A'}</strong></div>
            <div>Model Mask Pixels: <strong>{stats.modelMaskPixelsFast?.toLocaleString('en-US') ?? 'N/A'} px</strong></div>
            <div>Monitored Tiles: <strong>{stats.activeZoneCount ?? 'N/A'}</strong></div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="font-serif font-bold text-sm uppercase">2. Honest Model Calibration Caveat</h2>
          <p className="text-xs leading-relaxed border-l-2 border-black pl-3 italic">
            Predicted-versus-observed agreement is not a held-out evaluation result. The training pool incorporates the German Ahr valley AOI flooded features. Tiles 0_15_63, 0_15_65, 0_15_68, and 0_20_66 are not in the training pool.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="font-serif font-bold text-sm uppercase">3. Survey Sectors Register</h2>
          <table className="w-full text-xs text-left border-collapse font-mono">
            <thead>
              <tr className="border-b border-black">
                <th className="py-1">Sector / Tile ID</th>
                <th className="py-1">Observed Flooded Count</th>
                <th className="py-1">Training Pool Status</th>
              </tr>
            </thead>
            <tbody>
              {allZones.slice(0, 15).map((z) => (
                <tr key={z.zoneId} className="border-b border-gray-300">
                  <td className="py-1">{z.name} ({z.zoneId})</td>
                  <td className="py-1">{z.observed_flooded_count ?? z.exposedBuildings ?? 'N/A'}</td>
                  <td className="py-1">{z.in_training_pool ? 'In Training Pool' : 'Not in Pool'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
