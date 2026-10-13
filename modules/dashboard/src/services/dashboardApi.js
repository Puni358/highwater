/**
 * dashboardApi.js
 * Service layer responsible for fetching data payloads.
 * Components never call fetch directly; all data requests pass through this service.
 */

export async function fetchDashboardData() {
  const [zonesRes, floodRes, roadsRes, facilitiesRes, routesRes] = await Promise.all([
    fetch('/mock-data/zones.json'),
    fetch('/mock-data/flood_extent.geojson'),
    fetch('/mock-data/blocked_roads.geojson'),
    fetch('/mock-data/facilities.geojson'),
    fetch('/mock-data/routes.json'),
  ]);

  if (!zonesRes.ok) {
    throw new Error(`Failed to load zones data: ${zonesRes.statusText}`);
  }

  const [zones, floodExtent, blockedRoads, facilities, routes] = await Promise.all([
    zonesRes.json(),
    floodRes.ok ? floodRes.json() : null,
    roadsRes.ok ? roadsRes.json() : null,
    facilitiesRes.ok ? facilitiesRes.json() : null,
    routesRes.ok ? routesRes.json() : null,
  ]);

  return {
    rawZones: zones,
    rawFloodExtent: floodExtent,
    rawBlockedRoads: blockedRoads,
    rawFacilities: facilities,
    rawRoutes: routes,
  };
}
