/**
 * dashboardSelectors.js
 * Pure selectors to derive summary metrics and analytical datasets from normalised data.
 * 
 * FILTER POLICY (T4.8):
 * Summary statistics cards and analytical charts compute over the currently filtered subset
 * of zones. When an operational filter (e.g. search keyword or risk level) is active,
 * stats and charts update in real-time to reflect that filtered scope, and the UI
 * displays "Showing N of M zones". If filters are cleared, metrics represent the full dataset.
 * 
 * POLICY ON MISSING AND NULL NUMERIC DATA:
 * - Missing is never zero: Missing or null numeric data is never coerced to 0.
 * - If NO zones contain valid numeric data, selector returns null (rendered as "Not available").
 * - If partial zones lack data, the verified sum is returned with an explicit isPartial note.
 */

import { THEME } from '../../config/theme.js';

/**
 * Calculates summary statistics for the four primary stat cards.
 * Can compute over the full dataset or a filtered zone array (per T4.8 filter policy).
 * @param {object} data Normalised dashboard data
 * @param {Array<object>} [activeZones] Optional filtered zone array (defaults to data.zones)
 * @returns {object}
 */
export function selectSummaryStats(data, activeZones = null) {
  const zones = activeZones || data?.zones;

  if (!data || !Array.isArray(zones) || zones.length === 0) {
    return {
      floodedAreaKm2: null,
      highPriorityCount: null,
      exposedBuildingsCount: null,
      blockedRoadsCount: null,
      isDemo: true,
      floodedAreaIsPartial: false,
      exposedBuildingsIsPartial: false,
      isFiltered: false,
      totalZoneCount: 0,
      activeZoneCount: 0,
    };
  }

  const isDemo = data.metadata?.dataMode === 'demo';
  const totalZones = data.zones?.length || zones.length;
  const activeZoneCount = zones.length;
  const isFiltered = activeZones !== null && activeZoneCount !== totalZones;

  // 1. Total flooded area
  const zonesWithFloodedArea = zones.filter(
    (z) => typeof z.floodedAreaKm2 === 'number' && Number.isFinite(z.floodedAreaKm2)
  );
  const floodedMissingCount = activeZoneCount - zonesWithFloodedArea.length;
  const floodedAreaKm2 = zonesWithFloodedArea.length > 0
    ? Number(zonesWithFloodedArea.reduce((acc, z) => acc + z.floodedAreaKm2, 0).toFixed(1))
    : null;
  const floodedAreaIsPartial = zonesWithFloodedArea.length > 0 && floodedMissingCount > 0;

  // 2. High priority count
  const highPriorityCount = zones.filter((z) => z.riskLevel === 'HIGH').length;

  // 3. Exposed buildings count
  const zonesWithBldgs = zones.filter(
    (z) => typeof z.exposedBuildings === 'number' && Number.isFinite(z.exposedBuildings)
  );
  const bldgsMissingCount = activeZoneCount - zonesWithBldgs.length;
  const exposedBuildingsCount = zonesWithBldgs.length > 0
    ? zonesWithBldgs.reduce((acc, z) => acc + z.exposedBuildings, 0)
    : null;
  const exposedBuildingsIsPartial = zonesWithBldgs.length > 0 && bldgsMissingCount > 0;

  // 4. Blocked roads count (from blockedRoads layer)
  const blockedRoadFeatures = data.blockedRoads?.features || [];
  const blockedRoadsCount = blockedRoadFeatures.length;

  return {
    floodedAreaKm2,
    highPriorityCount,
    exposedBuildingsCount,
    blockedRoadsCount,
    isDemo,
    floodedAreaIsPartial,
    floodedMissingCount,
    exposedBuildingsIsPartial,
    bldgsMissingCount,
    isFiltered,
    totalZoneCount: totalZones,
    activeZoneCount,
  };
}

/**
 * Derives risk distribution data for Recharts BarChart (FR-30).
 * @param {Array<object>} zones 
 * @returns {Array<{ level: string, count: number, fill: string }>}
 */
export function selectRiskDistribution(zones) {
  if (!Array.isArray(zones)) return [];

  const counts = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNKNOWN: 0,
  };

  for (const z of zones) {
    const level = z.riskLevel || 'UNKNOWN';
    if (counts[level] !== undefined) {
      counts[level] += 1;
    } else {
      counts.UNKNOWN += 1;
    }
  }

  return [
    { level: 'HIGH', count: counts.HIGH, fill: THEME.riskColors.HIGH },
    { level: 'MEDIUM', count: counts.MEDIUM, fill: THEME.riskColors.MEDIUM },
    { level: 'LOW', count: counts.LOW, fill: THEME.riskColors.LOW },
    { level: 'UNKNOWN', count: counts.UNKNOWN, fill: THEME.riskColors.UNKNOWN },
  ];
}

/**
 * Derives impact data (exposed buildings by zone) for Recharts ImpactChart (FR-31).
 * Excludes zones with null exposed buildings to avoid plotting null as zero.
 * @param {Array<object>} zones 
 * @param {number} limit 
 * @returns {Array<{ zoneId: string, name: string, exposedBuildings: number, floodedPercent: number|null, riskLevel: string }>}
 */
export function selectImpactChartData(zones, limit = 6) {
  if (!Array.isArray(zones)) return [];

  // Exclude null values (never plot null as 0 per rules.md)
  const validZones = zones.filter(
    (z) => typeof z.exposedBuildings === 'number' && Number.isFinite(z.exposedBuildings)
  );

  // Sort descending by exposed buildings
  const sorted = [...validZones].sort((a, b) => b.exposedBuildings - a.exposedBuildings);

  return sorted.slice(0, limit).map((z) => ({
    zoneId: z.zoneId,
    name: z.name.replace(/Zone \d+ - /, ''), // Compact label for chart axis
    fullName: z.name,
    exposedBuildings: z.exposedBuildings,
    floodedPercent: z.floodedPercent,
    riskLevel: z.riskLevel,
  }));
}
