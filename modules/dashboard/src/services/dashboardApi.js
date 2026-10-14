/**
 * dashboardApi.js
 * Service layer responsible for fetching data payloads.
 * Supports both 'mock' and 'api' data sources configured via environment variables.
 * Components never call fetch directly; all data requests pass through this service.
 */

export const MOCK_RESOURCE_PATHS = {
  zones: '/mock-data/zones.json',
  floodExtent: '/mock-data/flood_extent.geojson',
  blockedRoads: '/mock-data/blocked_roads.geojson',
  facilities: '/mock-data/facilities.geojson',
  routes: '/mock-data/routes.json',
};

export const API_RESOURCE_PATHS = {
  zones: import.meta.env?.VITE_API_ZONES_PATH || '/zones',
  floodExtent: import.meta.env?.VITE_API_FLOOD_PATH || '/flood-extent',
  blockedRoads: import.meta.env?.VITE_API_ROADS_PATH || '/blocked-roads',
  facilities: import.meta.env?.VITE_API_FACILITIES_PATH || '/facilities',
  routes: import.meta.env?.VITE_API_ROUTES_PATH || '/routes',
};

/**
 * Primary data fetcher for the dashboard.
 * Selects mock or live API based on VITE_DATA_SOURCE.
 *
 * @param {Object} options Configuration overrides (useful for testing)
 * @param {'mock'|'api'} [options.dataSource] Override data source
 * @param {string} [options.baseUrl] Override API base URL
 * @param {Object} [options.resourcePaths] Override per-resource endpoint paths
 * @returns {Promise<{rawZones: Object, rawFloodExtent: Object, rawBlockedRoads: Object, rawFacilities: Object, rawRoutes: Object}>}
 */
export async function getDashboardData(options = {}) {
  const dataSource = options.dataSource || import.meta.env?.VITE_DATA_SOURCE || 'mock';
  const baseUrl = options.baseUrl ?? (import.meta.env?.VITE_API_BASE_URL || '');
  const isApi = dataSource === 'api';

  const paths = isApi
    ? { ...API_RESOURCE_PATHS, ...options.resourcePaths }
    : { ...MOCK_RESOURCE_PATHS, ...options.resourcePaths };

  const getUrl = (resourceKey) => {
    const resourcePath = paths[resourceKey];
    if (isApi) {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const cleanPath = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
      return `${cleanBase}${cleanPath}`;
    }
    return resourcePath;
  };

  const [zonesRes, floodRes, roadsRes, facilitiesRes, routesRes] = await Promise.all([
    fetch(getUrl('zones')),
    fetch(getUrl('floodExtent')),
    fetch(getUrl('blockedRoads')),
    fetch(getUrl('facilities')),
    fetch(getUrl('routes')),
  ]);

  if (!zonesRes.ok) {
    throw new Error(
      isApi
        ? `API request failed: Failed to load zones from ${getUrl('zones')} (${zonesRes.status} ${zonesRes.statusText})`
        : `Failed to load zones mock data (${zonesRes.statusText})`
    );
  }

  const [zones, floodExtent, blockedRoads, facilities, routes] = await Promise.all([
    zonesRes.json(),
    floodRes.ok ? floodRes.json().catch(() => null) : null,
    roadsRes.ok ? roadsRes.json().catch(() => null) : null,
    facilitiesRes.ok ? facilitiesRes.json().catch(() => null) : null,
    routesRes.ok ? routesRes.json().catch(() => null) : null,
  ]);

  return {
    rawZones: zones,
    rawFloodExtent: floodExtent,
    rawBlockedRoads: blockedRoads,
    rawFacilities: facilities,
    rawRoutes: routes,
  };
}

// Backwards compatibility alias
export const fetchDashboardData = getDashboardData;
