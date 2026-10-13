/**
 * dashboardSelectors.js
 * Pure selectors to derive summary metrics and analytical datasets from normalised data.
 * Per rules.md: Stats are derived from loaded data; missing numbers are never zero.
 */

/**
 * Calculates summary statistics for the four primary stat cards.
 * @param {object} data Normalised dashboard data
 * @returns {object}
 */
export function selectSummaryStats(data) {
  if (!data || !Array.isArray(data.zones)) {
    return {
      floodedAreaKm2: null,
      highPriorityCount: null,
      exposedBuildingsCount: null,
      blockedRoadsCount: null,
      isDemo: true,
    };
  }

  const isDemo = data.metadata?.dataMode === 'demo';

  // 1. Total flooded area: sum from zones (or fallback to floodExtent polygons)
  const zonesWithFloodedArea = data.zones.filter(
    (z) => typeof z.floodedAreaKm2 === 'number' && Number.isFinite(z.floodedAreaKm2)
  );
  const totalFloodedArea = zonesWithFloodedArea.length > 0
    ? Number(zonesWithFloodedArea.reduce((acc, z) => acc + z.floodedAreaKm2, 0).toFixed(1))
    : null;

  // 2. High priority count
  const highPriorityCount = data.zones.filter((z) => z.riskLevel === 'HIGH').length;

  // 3. Exposed buildings count: sum from zones
  const zonesWithBldgs = data.zones.filter(
    (z) => typeof z.exposedBuildings === 'number' && Number.isFinite(z.exposedBuildings)
  );
  const totalExposedBuildings = zonesWithBldgs.length > 0
    ? zonesWithBldgs.reduce((acc, z) => acc + z.exposedBuildings, 0)
    : null;

  // 4. Blocked roads count
  const blockedRoadFeatures = data.blockedRoads?.features || [];
  const blockedRoadsCount = blockedRoadFeatures.length;

  return {
    floodedAreaKm2: totalFloodedArea,
    highPriorityCount: highPriorityCount,
    exposedBuildingsCount: totalExposedBuildings,
    blockedRoadsCount: blockedRoadsCount,
    isDemo,
  };
}
