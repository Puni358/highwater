/**
 * mapUtils.js
 * Geospatial conversion and validation utilities.
 * Per rules.md:
 * - GeoJSON order is [longitude, latitude].
 * - Leaflet order is [latitude, longitude].
 * - Convert in exactly one tested helper: toLatLng().
 * - Validate every coordinate: lng in [-180, 180], lat in [-90, 90].
 * - Validate closed linear rings for polygons.
 * - Skip and count invalid features.
 */

/**
 * Converts a GeoJSON [longitude, latitude] coordinate pair to Leaflet [latitude, longitude].
 * @param {number[]} coord [lng, lat]
 * @returns {[number, number]} [lat, lng]
 */
export function toLatLng(coord) {
  if (!Array.isArray(coord) || coord.length < 2) {
    throw new Error(`Invalid coordinate array for toLatLng: ${JSON.stringify(coord)}`);
  }
  const [lng, lat] = coord;
  if (!isValidCoordinate(lng, lat)) {
    throw new Error(`Coordinate out of range: lng=${lng}, lat=${lat}`);
  }
  return [lat, lng];
}

/**
 * Validates longitude and latitude bounds.
 * @param {number} lng 
 * @param {number} lat 
 * @returns {boolean}
 */
export function isValidCoordinate(lng, lat) {
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return false;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

/**
 * Checks whether coordinates appear swapped (e.g. latitude looks like a longitude).
 * In southern India / Bengaluru context, lng is ~77 and lat is ~12.
 * @param {number} lng 
 * @param {number} lat 
 * @returns {boolean}
 */
export function areCoordinatesLikelySwapped(lng, lat) {
  // If lat is outside [-90, 90], it's definitely swapped or out of range
  if (Math.abs(lat) > 90) return true;
  // If lng is in [10, 15] and lat is in [75, 80], they are certainly swapped for India
  if (lng >= 8 && lng <= 37 && lat >= 68 && lat <= 98) {
    return true;
  }
  return false;
}

/**
 * Validates that a linear ring has at least 4 coordinates and is closed.
 * @param {number[][]} ring 
 * @returns {boolean}
 */
export function isValidPolygonRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return false;
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  return ring.every(([lng, lat]) => isValidCoordinate(lng, lat));
}

/**
 * Validates a GeoJSON FeatureCollection, dropping invalid features and reporting counts.
 * @param {object} featureCollection 
 * @returns {{ validFeatures: Array<object>, droppedCount: number, warnings: string[] }}
 */
export function validateFeatureCollection(featureCollection) {
  if (!featureCollection || !Array.isArray(featureCollection.features)) {
    return { validFeatures: [], droppedCount: 0, warnings: ['Missing or invalid FeatureCollection'] };
  }

  const validFeatures = [];
  const warnings = [];
  let droppedCount = 0;

  for (const feature of featureCollection.features) {
    const id = feature.id || feature.properties?.feature_id || feature.properties?.road_id || 'unknown';
    const geom = feature.geometry;

    if (!geom || !geom.type || !geom.coordinates) {
      droppedCount += 1;
      warnings.push(`Feature ${id} skipped: missing geometry`);
      continue;
    }

    if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0];
      if (!isValidPolygonRing(ring)) {
        droppedCount += 1;
        warnings.push(`Feature ${id} skipped: unclosed or invalid polygon ring`);
        continue;
      }
    } else if (geom.type === 'LineString') {
      const coords = geom.coordinates;
      if (!Array.isArray(coords) || coords.length < 2 || !coords.every(([lng, lat]) => isValidCoordinate(lng, lat))) {
        droppedCount += 1;
        warnings.push(`Feature ${id} skipped: invalid LineString coordinates`);
        continue;
      }
    } else if (geom.type === 'Point') {
      const [lng, lat] = geom.coordinates;
      if (!isValidCoordinate(lng, lat)) {
        droppedCount += 1;
        warnings.push(`Feature ${id} skipped: invalid Point coordinates`);
        continue;
      }
    }

    validFeatures.push(feature);
  }

  return { validFeatures, droppedCount, warnings };
}

/**
 * Default extent for Bengaluru Disaster Response AOI
 * [[South, West], [North, East]]
 */
export const DEFAULT_AOI_BOUNDS = [
  [12.8800, 77.6000],
  [13.0200, 77.7800],
];

/**
 * Default map center [lat, lng]
 */
export const DEFAULT_MAP_CENTER = [12.9500, 77.6900];
export const DEFAULT_MAP_ZOOM = 12;

/**
 * Fits bounding box from loaded data (zones + flood extent).
 * Falls back to DEFAULT_AOI_BOUNDS if no geometry exists.
 * Returns Leaflet bounds: [[minLat, minLng], [maxLat, maxLng]].
 *
 * @param {Array<object>} [zones]
 * @param {object} [floodGeoJSON]
 * @returns {[[number, number], [number, number]]}
 */
export function computeDataBounds(zones = [], floodGeoJSON = null, extraGeoJSONs = []) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let count = 0;

  const update = (lng, lat) => {
    if (isValidCoordinate(lng, lat)) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      count++;
    }
  };

  const processCollection = (fc) => {
    if (!fc || !Array.isArray(fc.features)) return;
    for (const f of fc.features) {
      const geom = f?.geometry;
      if (!geom?.coordinates) continue;
      if (geom.type === 'LineString') {
        for (const pt of geom.coordinates) {
          if (Array.isArray(pt) && pt.length >= 2) update(pt[0], pt[1]);
        }
      } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat(1);
        for (const ring of rings) {
          if (Array.isArray(ring)) {
            for (const pt of ring) {
              if (Array.isArray(pt) && pt.length >= 2) update(pt[0], pt[1]);
            }
          }
        }
      }
    }
  };

  if (Array.isArray(zones)) {
    for (const z of zones) {
      if (z.hasGeometry && z.geometry?.coordinates) {
        const rings = z.geometry.type === 'Polygon' ? z.geometry.coordinates : z.geometry.coordinates.flat(1);
        for (const ring of rings) {
          if (Array.isArray(ring)) {
            for (const pt of ring) {
              if (Array.isArray(pt) && pt.length >= 2) {
                update(pt[0], pt[1]);
              }
            }
          }
        }
      }
    }
  }

  if (floodGeoJSON) {
    processCollection(floodGeoJSON);
  }

  if (Array.isArray(extraGeoJSONs)) {
    for (const extra of extraGeoJSONs) {
      if (extra) processCollection(extra);
    }
  }

  if (count === 0) {
    return DEFAULT_AOI_BOUNDS;
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

