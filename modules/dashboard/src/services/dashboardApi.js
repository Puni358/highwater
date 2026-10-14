/**
 * dashboardApi.js
 * Service layer responsible for fetching data payloads.
 * Supports both 'mock' and 'api' data sources configured via environment variables.
 * Components never call fetch directly; all data requests pass through this service.
 *
 * Hard rule (Phase 6): Do NOT guess endpoints or field names.
 * When VITE_DATA_SOURCE=api, VITE_API_BASE_URL and all VITE_API_*_PATH variables must be set.
 */

export const MOCK_RESOURCE_PATHS = {
  zones: '/mock-data/zones.json',
  floodExtent: '/mock-data/flood_extent.geojson',
  blockedRoads: '/mock-data/blocked_roads.geojson',
  facilities: '/mock-data/facilities.geojson',
  routes: '/mock-data/routes.json',
};

// No guessed default endpoint paths per Phase 6 requirements
export const API_RESOURCE_PATHS = {
  zones: import.meta.env?.VITE_API_ZONES_PATH || '',
  floodExtent: import.meta.env?.VITE_API_FLOOD_PATH || '',
  blockedRoads: import.meta.env?.VITE_API_ROADS_PATH || '',
  facilities: import.meta.env?.VITE_API_FACILITIES_PATH || '',
  routes: import.meta.env?.VITE_API_ROUTES_PATH || '',
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

  // Explicit configuration validation for api mode (no guessed endpoints)
  if (isApi) {
    if (!baseUrl || baseUrl.trim() === '') {
      throw new Error(
        'Configuration error: VITE_API_BASE_URL must be specified when VITE_DATA_SOURCE=api.'
      );
    }
    const missingKeys = Object.entries(paths)
      .filter(([_, pathVal]) => !pathVal || pathVal.trim() === '')
      .map(([key]) => `VITE_API_${key.toUpperCase()}_PATH`);

    if (missingKeys.length > 0) {
      throw new Error(
        `Configuration error: Missing endpoint path(s) for ${missingKeys.join(', ')}. Set them in environment configuration when VITE_DATA_SOURCE=api.`
      );
    }
  }

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

  // Failed secondary layers must NOT become empty silently; record error payload for explicit warning
  const [zones, floodExtent, blockedRoads, facilities, routes] = await Promise.all([
    zonesRes.json(),
    floodRes.ok
      ? floodRes.json().catch((err) => ({ error: `Malformed flood extent JSON: ${err.message}` }))
      : { error: `Failed to load flood extent (${floodRes.status} ${floodRes.statusText})` },
    roadsRes.ok
      ? roadsRes.json().catch((err) => ({ error: `Malformed blocked roads JSON: ${err.message}` }))
      : { error: `Failed to load blocked roads (${roadsRes.status} ${roadsRes.statusText})` },
    facilitiesRes.ok
      ? facilitiesRes.json().catch((err) => ({ error: `Malformed facilities JSON: ${err.message}` }))
      : { error: `Failed to load facilities (${facilitiesRes.status} ${facilitiesRes.statusText})` },
    routesRes.ok
      ? routesRes.json().catch((err) => ({ error: `Malformed routes JSON: ${err.message}` }))
      : { error: `Failed to load routes (${routesRes.status} ${routesRes.statusText})` },
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
