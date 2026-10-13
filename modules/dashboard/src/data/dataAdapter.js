/**
 * dataAdapter.js
 * Adapter layer mapping raw backend/fixture payloads to the normalised UI model.
 * Per architecture.md and rules.md:
 * - Only dataAdapter.js knows backend field names.
 * - Missing numeric data is never zero and never LOW; unknown risk becomes UNKNOWN.
 * - Non-finite numbers become null.
 * - 0.0 - 1.0 risk scores are normalised to 0 - 100.
 * - Validates coordinates and tracks dropped/invalid features.
 */

/**
 * Normalises a numeric value; non-finite numbers or undefined become null.
 * @param {any} val 
 * @returns {number|null}
 */
export function normalizeNumber(val) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Normalises risk level. Anything not strictly HIGH, MEDIUM, LOW becomes UNKNOWN.
 * @param {string} level 
 * @returns {"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"}
 */
export function normalizeRiskLevel(level) {
  if (typeof level !== 'string') return 'UNKNOWN';
  const upper = level.toUpperCase().trim();
  if (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') {
    return upper;
  }
  return 'UNKNOWN';
}

/**
 * Normalises risk score to a 0 - 100 scale.
 * If score is on 0.0 - 1.0 scale, converts to 0 - 100.
 * @param {any} rawScore 
 * @returns {{ score: number|null, originalScale?: string }}
 */
export function normalizeRiskScore(rawScore) {
  const num = normalizeNumber(rawScore);
  if (num === null) return { score: null };
  if (num >= 0 && num <= 1.0 && num !== 0 && num !== 1) {
    return {
      score: Math.round(num * 100),
      originalScale: '0-1',
    };
  }
  if (num >= 0 && num <= 100) {
    return {
      score: Math.round(num),
      originalScale: '0-100',
    };
  }
  return { score: null };
}

/**
 * Validates a single [longitude, latitude] coordinate pair.
 * Longitude in [-180, 180], latitude in [-90, 90].
 * @param {number[]} coord 
 * @returns {boolean}
 */
export function isValidLngLat(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lng, lat] = coord;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return false;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

/**
 * Validates whether a polygon ring is closed (first point equals last point).
 * @param {number[][]} ring 
 * @returns {boolean}
 */
export function isClosedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * Normalises raw zones payload.
 * @param {object} rawZonesPayload 
 * @returns {{ metadata: object, zones: Array<object> }}
 */
export function adaptZones(rawZonesPayload) {
  if (!rawZonesPayload || typeof rawZonesPayload !== 'object') {
    throw new Error('Invalid zones payload: expected a top-level object.');
  }

  const rawZones = rawZonesPayload.zones;
  if (!Array.isArray(rawZones)) {
    throw new Error('Invalid zones payload: missing "zones" array.');
  }

  const metadata = {
    schemaVersion: rawZonesPayload.schema_version || '1.0',
    generatedAt: rawZonesPayload.generated_at || null,
    dataMode: (rawZonesPayload.data_mode || 'demo').toLowerCase(),
    studyArea: rawZonesPayload.study_area || 'Bengaluru, Karnataka',
  };

  const zones = rawZones.map((z, idx) => {
    const zoneId = z.zone_id || `zone-${idx + 1}`;
    const name = z.name || `Zone ${zoneId}`;
    const riskLevel = normalizeRiskLevel(z.risk_level);
    const scoreResult = normalizeRiskScore(z.risk_score);

    const floodedPercent = normalizeNumber(z.flooded_percent);
    const floodedAreaKm2 = normalizeNumber(z.flooded_area_km2);
    const exposedBuildings = normalizeNumber(z.exposed_buildings);

    let accessibility = 'UNKNOWN';
    if (typeof z.accessibility === 'string') {
      const acc = z.accessibility.toUpperCase();
      if (['OPEN', 'LIMITED', 'BLOCKED', 'CUT_OFF', 'UNKNOWN'].includes(acc)) {
        accessibility = acc;
      }
    }

    const reasons = Array.isArray(z.reasons) ? z.reasons : [];
    const geometry = z.geometry && z.geometry.coordinates ? z.geometry : null;
    const hasGeometry = Boolean(geometry);

    return {
      zoneId,
      name,
      riskLevel,
      riskScore: scoreResult.score,
      floodedPercent,
      floodedAreaKm2,
      exposedBuildings,
      accessibility,
      reasons,
      geometry,
      hasGeometry,
      provenance: z.provenance || null,
      confidence: normalizeNumber(z.confidence),
      needsSurvey: Boolean(z.needs_survey),
    };
  });

  return { metadata, zones };
}

/**
 * Normalises routes payload.
 * @param {object} rawRoutesPayload 
 * @returns {Array<object>}
 */
export function adaptRoutes(rawRoutesPayload) {
  if (!rawRoutesPayload) return [];
  const rawList = Array.isArray(rawRoutesPayload.routes)
    ? rawRoutesPayload.routes
    : rawRoutesPayload.active_routes
    ? Object.entries(rawRoutesPayload.active_routes).map(([zoneId, r]) => ({
        zone_id: zoneId,
        ...(r || { status: 'UNREACHABLE' }),
      }))
    : [];

  return rawList.map((r, idx) => ({
    routeId: r.route_id || `route-${idx + 1}`,
    zoneId: r.zone_id || null,
    destinationName: r.destination_name || null,
    status: (r.status || 'UNKNOWN').toUpperCase(),
    distanceM: normalizeNumber(r.distance_m ?? (r.distance_km ? r.distance_km * 1000 : null)),
    etaMinutes: normalizeNumber(r.eta_minutes),
    provenance: r.provenance || 'derived',
    geometry: r.geometry || null,
  }));
}

/**
 * Top-level adapter that transforms all raw module outputs into the unified UI dataset.
 * @param {object} raw 
 * @returns {object}
 */
export function adaptDashboardData(raw) {
  if (!raw || !raw.rawZones) {
    throw new Error('Dashboard adapter requires rawZones payload.');
  }

  const { metadata, zones } = adaptZones(raw.rawZones);
  const routes = adaptRoutes(raw.rawRoutes);

  let droppedFeatureCount = 0;
  const warnings = [];

  // Filter invalid flood extent polygons
  const floodFeatures = (raw.rawFloodExtent?.features || []).filter((f) => {
    if (!f.geometry || f.geometry.type !== 'Polygon') return false;
    const ring = f.geometry.coordinates?.[0];
    if (!ring || !isClosedRing(ring)) {
      droppedFeatureCount += 1;
      warnings.push(`Dropped flood feature ${f.properties?.feature_id || 'unknown'}: unclosed polygon.`);
      return false;
    }
    const allValid = ring.every(isValidLngLat);
    if (!allValid) {
      droppedFeatureCount += 1;
      warnings.push(`Dropped flood feature ${f.properties?.feature_id || 'unknown'}: invalid coordinates.`);
      return false;
    }
    return true;
  });

  return {
    metadata,
    zones,
    floodExtent: {
      type: 'FeatureCollection',
      features: floodFeatures,
    },
    blockedRoads: raw.rawBlockedRoads || { type: 'FeatureCollection', features: [] },
    facilities: raw.rawFacilities || { type: 'FeatureCollection', features: [] },
    routes,
    droppedFeatureCount,
    warnings,
  };
}
