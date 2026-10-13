/**
 * dashboardSelectors.js
 * Pure selectors to derive summary metrics and analytical datasets from normalised data.
 * 
 * POLICY ON MISSING AND NULL NUMERIC DATA (per rules.md section 2 & architecture.md section 5):
 * 1. Missing is never zero: Missing or null numeric data is never coerced to 0.
 * 2. If NO zones contain valid numeric data for a metric, the selector returns `null`,
 *    which causes the UI (StatCard) to display "Not available".
 * 3. If SOME zones contain valid data while others are null (e.g. telemetry offline),
 *    the selector computes the verified sum from known zones, and flags `isPartial: true`
 *    along with `unreportedCount: N`. This allows the UI to display the verified sum
 *    accompanied by an explicit note (e.g. "Partial: excludes N unassessed zones"),
 *    preventing missing data from ever being silently treated as zero.
 */

/**
 * Calculates summary statistics for the four primary stat cards.
 * @param {object} data Normalised dashboard data
 * @returns {object}
 */
export function selectSummaryStats(data) {
  if (!data || !Array.isArray(data.zones) || data.zones.length === 0) {
    return {
      floodedAreaKm2: null,
      highPriorityCount: null,
      exposedBuildingsCount: null,
      blockedRoadsCount: null,
      isDemo: true,
      floodedAreaIsPartial: false,
      exposedBuildingsIsPartial: false,
    };
  }

  const isDemo = data.metadata?.dataMode === 'demo';
  const totalZones = data.zones.length;

  // 1. Total flooded area
  const zonesWithFloodedArea = data.zones.filter(
    (z) => typeof z.floodedAreaKm2 === 'number' && Number.isFinite(z.floodedAreaKm2)
  );
  const floodedMissingCount = totalZones - zonesWithFloodedArea.length;
  const floodedAreaKm2 = zonesWithFloodedArea.length > 0
    ? Number(zonesWithFloodedArea.reduce((acc, z) => acc + z.floodedAreaKm2, 0).toFixed(1))
    : null;
  const floodedAreaIsPartial = zonesWithFloodedArea.length > 0 && floodedMissingCount > 0;

  // 2. High priority count
  const highPriorityCount = data.zones.filter((z) => z.riskLevel === 'HIGH').length;

  // 3. Exposed buildings count
  const zonesWithBldgs = data.zones.filter(
    (z) => typeof z.exposedBuildings === 'number' && Number.isFinite(z.exposedBuildings)
  );
  const bldgsMissingCount = totalZones - zonesWithBldgs.length;
  const exposedBuildingsCount = zonesWithBldgs.length > 0
    ? zonesWithBldgs.reduce((acc, z) => acc + z.exposedBuildings, 0)
    : null;
  const exposedBuildingsIsPartial = zonesWithBldgs.length > 0 && bldgsMissingCount > 0;

  // 4. Blocked roads count
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
  };
}
