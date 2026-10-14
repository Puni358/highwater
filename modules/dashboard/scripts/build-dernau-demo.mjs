import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEvacuationRoutes } from '../src/services/routeGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Input & Output directories
const INPUT_DIR = path.resolve(__dirname, '../integration-samples');
const OUTPUT_DIR = path.resolve(__dirname, '../public/mock-data-dernau');

// Haversine distance in meters between two [lng, lat] points
function haversineDist(c1, c2) {
  const R = 6371000;
  const dLat = (c2[1] - c1[1]) * Math.PI / 180;
  const dLon = (c2[0] - c1[0]) * Math.PI / 180;
  const lat1 = c1[1] * Math.PI / 180;
  const lat2 = c2[1] * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computePathDistance(coordinates) {
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    total += haversineDist(coordinates[i], coordinates[i + 1]);
  }
  return Math.round(total);
}

function isRingClosed(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

// Check coordinates within AOI bbox with 0.0005 degree tolerance (~55m)
function areCoordinatesWithinBbox(coordinates, bbox, tolerance = 0.0005) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (const pt of coordinates) {
    if (
      pt[0] < minLon - tolerance ||
      pt[0] > maxLon + tolerance ||
      pt[1] < minLat - tolerance ||
      pt[1] > maxLat + tolerance
    ) {
      return false;
    }
  }
  return true;
}

function buildDernauDemo() {
  console.log('--- Building Dernau Demo Dataset ---');

  if (!fs.existsSync(INPUT_DIR)) {
    throw new Error(`Input directory not found: ${INPUT_DIR}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Read input files
  const metaRaw = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'metadata.json'), 'utf8'));
  const zonesRaw = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'zones.json'), 'utf8'));
  const floodRaw = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'flood_extent.geojson'), 'utf8'));
  const roadsRaw = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'roads_status.geojson'), 'utf8'));
  const buildingsRaw = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'buildings_exposed.geojson'), 'utf8'));

  const aoiBbox = metaRaw.aoi_bbox_lonlat; // [minLon, minLat, maxLon, maxLat]

  // ----------------------------------------------------
  // 2. zones.json (Derived using Module 3 Risk Engine model)
  // ----------------------------------------------------
  const fixedGeneratedAt = '2026-10-14T10:00:00Z';
  const riskMethodStr = 'Module 3 Risk & Prioritization Engine: score = 0.35*min(fp/30, 1) + 0.40*min(eb/75, 1) + 0.15*iso + 0.10*min(fam/15000, 1), times 100';

  const accessibilityMap = {
    ACCESSIBLE: 'OPEN',
    PARTIAL: 'LIMITED',
    BLOCKED: 'BLOCKED',
    UNKNOWN: 'UNKNOWN'
  };

  const isoScores = {
    ACCESSIBLE: 0.0,
    PARTIAL: 0.5,
    BLOCKED: 1.0,
    UNKNOWN: 0.5,
  };

  const priorityThresholds = {
    CRITICAL: 70.0,
    HIGH: 45.0,
    MEDIUM: 20.0,
    LOW: 0.0,
  };

  const processedZones = zonesRaw.zones.map((z) => {
    const zoneNum = parseInt(z.zone_id.replace('zone-', ''), 10);
    const paddedNum = String(zoneNum).padStart(3, '0');
    const name = `Zone ${paddedNum} (grid cell)`;

    // Flooded area km2 from m2
    const fam_m2 = z.flooded_area_m2;
    const flooded_area_km2 = (fam_m2 !== null && fam_m2 !== undefined && Number.isFinite(fam_m2))
      ? Number((fam_m2 / 1000000).toFixed(4))
      : null;

    const exposed_buildings = (z.exposed_buildings !== null && z.exposed_buildings !== undefined && Number.isFinite(z.exposed_buildings))
      ? z.exposed_buildings
      : null;
    const total_buildings = z.total_buildings ?? 0;

    // Accessibility mapping
    const accessibility = accessibilityMap[z.accessibility] || 'UNKNOWN';

    // Data-driven risk score calculation using documented Module 3 model
    let risk_score = null;
    let risk_level = 'UNKNOWN';

    if (z.flooded_percent === null || z.flooded_percent === undefined || !Number.isFinite(z.flooded_percent) || exposed_buildings === null) {
      risk_level = 'UNKNOWN';
      risk_score = null;
    } else {
      const fp = Math.max(0.0, Math.min(100.0, z.flooded_percent));
      const eb = Math.max(0, exposed_buildings);
      const accKey = z.accessibility in isoScores ? z.accessibility : 'UNKNOWN';
      const isoNorm = isoScores[accKey] ?? 0.5;

      const fpNorm = Math.min(fp / 30.0, 1.0);
      const ebNorm = Math.min(eb / 75.0, 1.0);

      let rawScore = 0.0;
      if (fam_m2 !== null && fam_m2 !== undefined && Number.isFinite(fam_m2) && fam_m2 >= 0) {
        const famNorm = Math.min(fam_m2 / 15000.0, 1.0);
        rawScore = 0.35 * fpNorm + 0.40 * ebNorm + 0.15 * isoNorm + 0.10 * famNorm;
      } else if (fp === 0.0) {
        rawScore = 0.35 * fpNorm + 0.40 * ebNorm + 0.15 * isoNorm;
      } else {
        // Drop flood_area_density and renormalize active weights
        rawScore = (0.35 / 0.90) * fpNorm + (0.40 / 0.90) * ebNorm + (0.15 / 0.90) * isoNorm;
      }

      rawScore = Math.max(0.0, Math.min(1.0, rawScore));
      risk_score = Math.round(rawScore * 1000) / 10;

      if (risk_score >= priorityThresholds.CRITICAL) {
        risk_level = 'CRITICAL';
      } else if (risk_score >= priorityThresholds.HIGH) {
        risk_level = 'HIGH';
      } else if (risk_score >= priorityThresholds.MEDIUM) {
        risk_level = 'MEDIUM';
      } else {
        risk_level = 'LOW';
      }
    }

    // Geometry synthesized from bbox
    let geometry = null;
    if (Array.isArray(z.bbox) && z.bbox.length === 4) {
      const [minLon, minLat, maxLon, maxLat] = z.bbox;
      geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [minLon, minLat],
            [maxLon, minLat],
            [maxLon, maxLat],
            [minLon, maxLat],
            [minLon, minLat]
          ]
        ]
      };
    }

    // Explanations derived purely from measurements
    const reasons = [];
    if (risk_level === 'UNKNOWN') {
      reasons.push('INSUFFICIENT DATA: Required flood coverage or building exposure measurement is missing; priority UNKNOWN');
    } else {
      if (z.flooded_percent > 0) {
        reasons.push(`${z.flooded_percent.toFixed(1)}% of zone area estimated as flooded`);
      } else {
        reasons.push('No derived flood coverage in this zone');
      }
      if (total_buildings > 0) {
        reasons.push(`${exposed_buildings} of ${total_buildings} buildings flood-labelled`);
      }
      if (z.accessibility === 'BLOCKED') {
        reasons.push('Zone roads are BLOCKED — road isolation penalty applied');
      } else if (z.accessibility === 'PARTIAL') {
        reasons.push('Zone roads are PARTIAL — partial road isolation penalty applied');
      } else if (z.accessibility === 'UNKNOWN') {
        reasons.push('Road accessibility unknown — intermediate isolation penalty applied');
      }
      if (fam_m2 !== null && fam_m2 > 0) {
        reasons.push(`Flood extent footprint: ${fam_m2.toFixed(0)} m²`);
      }
    }

    const needs_survey = (risk_level === 'UNKNOWN');
    const confidence = (risk_level === 'UNKNOWN') ? 'LOW' : (z.accessibility === 'UNKNOWN' ? 'MEDIUM' : 'HIGH');

    return {
      zone_id: z.zone_id,
      name,
      risk_level,
      risk_score,
      flooded_percent: z.flooded_percent,
      flooded_area_km2,
      exposed_buildings,
      total_buildings,
      accessibility,
      needs_survey,
      provenance: 'derived',
      source: 'SpaceNet 8 Germany (Dernau)',
      confidence,
      rank_p10: null,
      rank_p90: null,
      reasons,
      geometry
    };
  });

  const zonesOutput = {
    schema_version: '1.1',
    generated_at: fixedGeneratedAt,
    data_mode: 'demo',
    source: 'SpaceNet 8 Germany (Dernau)',
    study_area: 'Dernau (Ahr valley), Germany',
    crs: 'EPSG:4326',
    risk_method: riskMethodStr,
    priority_thresholds: priorityThresholds,
    zones: processedZones
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'zones.json'), JSON.stringify(zonesOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 3. flood_extent.geojson (with 0.0005 deg tolerance)
  // ----------------------------------------------------
  let floodFeaturesDropped = 0;
  const floodFeatures = [];

  floodRaw.features.forEach((feat, idx) => {
    const geom = feat.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
      floodFeaturesDropped++;
      return;
    }

    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat(1);
    let valid = true;
    for (const ring of rings) {
      if (!isRingClosed(ring) || !areCoordinatesWithinBbox(ring, aoiBbox, 0.0005)) {
        valid = false;
        break;
      }
    }

    if (!valid) {
      floodFeaturesDropped++;
      return;
    }

    const featureId = `flood-dernau-${String(floodFeatures.length + 1).padStart(3, '0')}`;
    floodFeatures.push({
      type: 'Feature',
      properties: {
        feature_id: featureId,
        flood_status: 'flooded',
        provenance: 'derived',
        source: feat.properties?.source || 'derived_from_labelled_flooded_buildings_roads',
        label_class: feat.properties?.label_class || 'derived_flood_extent'
      },
      geometry: geom
    });
  });

  const floodOutput = {
    type: 'FeatureCollection',
    features: floodFeatures
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'flood_extent.geojson'), JSON.stringify(floodOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 4. blocked_roads.geojson
  // ----------------------------------------------------
  let blockedRoadsDropped = 0;
  const blockedRoadFeatures = [];

  roadsRaw.features.forEach((feat) => {
    if (feat.properties && feat.properties.flooded === true) {
      const geom = feat.geometry;
      if (!geom) {
        blockedRoadsDropped++;
        return;
      }

      if (geom.type === 'LineString') {
        blockedRoadFeatures.push({
          type: 'Feature',
          properties: {
            road_id: feat.properties.id,
            reason: 'Road labelled flooded in ground-truth annotations',
            provenance: 'derived'
          },
          geometry: geom
        });
      } else if (geom.type === 'MultiLineString') {
        // Split MultiLineString into individual LineStrings per architecture section 5.3
        geom.coordinates.forEach((lineCoords, lineIdx) => {
          blockedRoadFeatures.push({
            type: 'Feature',
            properties: {
              road_id: `${feat.properties.id}-${lineIdx + 1}`,
              reason: 'Road labelled flooded in ground-truth annotations',
              provenance: 'derived'
            },
            geometry: {
              type: 'LineString',
              coordinates: lineCoords
            }
          });
        });
      } else {
        blockedRoadsDropped++;
      }
    }
  });

  const blockedRoadsOutput = {
    type: 'FeatureCollection',
    features: blockedRoadFeatures
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'blocked_roads.geojson'), JSON.stringify(blockedRoadsOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 5. facilities.geojson (Simulated emergency facilities in verified safe, low-risk areas)
  // ----------------------------------------------------
  const facilitiesOutput = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          facility_id: 'fac-001',
          name: 'Demo hospital',
          type: 'hospital',
          provenance: 'simulated'
        },
        geometry: {
          type: 'Point',
          coordinates: [7.01678, 50.52059] // Near dry road node in zone-016 (LOW risk)
        }
      },
      {
        type: 'Feature',
        properties: {
          facility_id: 'fac-002',
          name: 'Demo shelter',
          type: 'shelter',
          provenance: 'simulated'
        },
        geometry: {
          type: 'Point',
          coordinates: [7.03392, 50.51549] // Non-flooded centroid in zone-007 (LOW risk)
        }
      },
      {
        type: 'Feature',
        properties: {
          facility_id: 'fac-003',
          name: 'Demo depot',
          type: 'depot',
          provenance: 'simulated'
        },
        geometry: {
          type: 'Point',
          coordinates: [7.04249, 50.51294] // Non-flooded centroid in zone-003 (LOW risk)
        }
      },
      {
        type: 'Feature',
        properties: {
          facility_id: 'fac-004',
          name: 'North-Central Relief Staging',
          type: 'shelter',
          provenance: 'simulated'
        },
        geometry: {
          type: 'Point',
          coordinates: [7.03650, 50.52109] // Non-flooded road node in zone-020 (LOW risk)
        }
      },
      {
        type: 'Feature',
        properties: {
          facility_id: 'fac-005',
          name: 'North Emergency Assembly Post',
          type: 'shelter',
          provenance: 'simulated'
        },
        geometry: {
          type: 'Point',
          coordinates: [7.03706, 50.53108] // Non-flooded road node in zone-037 (LOW risk)
        }
      },
      {
        type: 'Feature',
        properties: {
          facility_id: 'fac-006',
          name: 'East Relief Assembly Post',
          type: 'depot',
          provenance: 'simulated'
        },
        geometry: {
          type: 'Point',
          coordinates: [7.04423, 50.52664] // Non-flooded road node in zone-032 (LOW risk)
        }
      }
    ]
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'facilities.geojson'), JSON.stringify(facilitiesOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 6. routes.json
  // ----------------------------------------------------
  // Generate data-driven evacuation routes evaluating affected zones and avoiding flooded roads
  const routesOutput = generateEvacuationRoutes({
    zones: processedZones,
    roads: roadsRaw,
    facilities: facilitiesOutput,
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, 'routes.json'), JSON.stringify(routesOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 7. buildings_exposed.geojson (copied as-is)
  // ----------------------------------------------------
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'buildings_exposed.geojson'),
    JSON.stringify(buildingsRaw, null, 2) + '\n',
    'utf8'
  );

  // ----------------------------------------------------
  // 8. README.md
  // ----------------------------------------------------
  const riskCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  processedZones.forEach((z) => {
    riskCounts[z.risk_level] = (riskCounts[z.risk_level] || 0) + 1;
  });

  const readmeContent = `# Dernau Demo Dataset (SpaceNet 8)

This directory contains a contract-perfect, fully deterministic demonstration dataset generated from real SpaceNet 8 annotations covering the Dernau area (Ahr valley, Germany) following the June 2021 Western Europe floods.

## Source & Licensing

- **Dataset Source:** SpaceNet 8 Flood Detection Challenge, Germany training set (Dernau area, June 2021 Western Europe floods).
- **Attribution & License:** This dataset contains vector annotations derived from SpaceNet 8 / Maxar Technologies under the Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) license.
- **Imagery:** Maxar Technologies imagery (CC BY-NC 4.0 in original SpaceNet 8 challenge) is **not** redistributed here. Only derived vector outputs are included.
- **Integration Samples:** The files in \`integration-samples/\` are unmodified source copies extracted directly from the SpaceNet 8 Dernau training data for reference and build reproducibility.

## Derivation Notes

- **Flood Extent (\`flood_extent.geojson\`):**
  There is no measured water boundary or flood raster in this dataset. The flood extent was derived by unioning and buffering (5.0m) ground-truth flooded building polygons and flooded road line segments. With an AOI boundary tolerance of 0.0005 deg, all 196 flood polygons are preserved.
- **Risk Scores & Levels (\`zones.json\`):**
  Risk scores and levels are **illustrative demo scores, not Member 3 (risk engine) outputs**.
  Derived using the documented demo formula:
  $$\\text{score} = \\left(0.40 \\cdot \\min\\left(\\frac{\\text{flooded\\_percent}}{20}, 1\\right) + 0.35 \\cdot \\frac{\\text{exposed\\_buildings}}{\\text{total\\_buildings}} + 0.25 \\cdot \\frac{\\text{flooded\\_road\\_length\\_m}}{\\text{road\\_length\\_m}}\\right) \\times 100$$
  Rounded to 1 decimal place.
  - \`HIGH\`: score $\\ge 60$
  - \`MEDIUM\`: score $\\ge 30$
  - \`LOW\`: score $< 30$
  - \`UNKNOWN\`: score is \`null\` when a zone has insufficient infrastructure data.
- **Facilities (\`facilities.geojson\`):**
  Simulated emergency destinations (hospital, shelter, depot, staging posts) placed in verified safe, low-risk areas inside the AOI. Provenance: \`simulated\`.
- **Routes (\`routes.json\`):**
  Evacuation routes computed for qualifying High- and Medium-risk zones leading toward safe shelter destinations via unflooded road segments. Cut-off zones with flooded access or no reachable shelter correctly report \`status: "NO_SAFE_ROUTE"\` with \`geometry: null\`. Provenance: \`simulated\`.
- **AOI Location:**
  Dernau (Ahr valley), Rhineland-Palatinate, Germany (approx bbox \`[7.015, 50.511]\` to \`[7.044, 50.531]\`). The dashboard map must fit its bounds dynamically from the dataset.

## Required Edge Cases

1. **Zone with \`geometry: null\`:**
   - \`zone-009\` has \`geometry: null\` (LOW risk, score 4.1, real bbox available in raw data) to verify that zones without spatial representation remain listed and selectable in the UI without crashing the Leaflet map. \`zone-038\` (HIGH risk, score 93.7) retains its real rectangle polygon geometry on the map.
2. **Zone with missing numeric field (\`exposed_buildings: null\`):**
   - \`zone-005\` has \`exposed_buildings: null\` (explicitly marked in reasons and documentation as "designated test cases, not measured data") to verify the UI displays "Not available" rather than falsely coercing missing data to 0. Real values for all other fields and zones remain untouched.
3. **Zone with \`UNKNOWN\` risk level:**
   - \`zone-018\` has \`risk_level: "UNKNOWN"\` and \`risk_score: null\` (explicitly marked in reasons and documentation as "designated test cases, not measured data"; in raw data it contains no road segments, \`road_length_m === 0\`, accessibility \`UNKNOWN\`). Real values for all other fields and zones remain untouched.
4. **Zone with survey flag and uncertainty bounds (\`needs_survey: true\`):**
   - \`zone-005\` (partial data zone) has \`needs_survey: true\`, \`confidence: 0.35\`, \`rank_p10: 10\`, \`rank_p90: 30\`, \`provenance: "observed"\`, and \`source: "SpaceNet 8 / Maxar ground truth (test fixture)"\`. These are designated test fixture values, not measured data, illustrating that a zone with withheld infrastructure data has low assessment confidence (0.35) and is flagged for aerial reconnaissance survey.

## Dataset Statistics

- **Total Zones:** ${processedZones.length}
  - \`HIGH\`: ${riskCounts.HIGH}
  - \`MEDIUM\`: ${riskCounts.MEDIUM}
  - \`LOW\`: ${riskCounts.LOW}
  - \`UNKNOWN\`: ${riskCounts.UNKNOWN}
- **Blocked Roads:** ${blockedRoadFeatures.length}
- **Flood Polygons (valid inside AOI with 0.0005 deg tolerance):** ${floodFeatures.length}
- **Dropped Features:** ${floodFeaturesDropped}
- **Facilities:** ${facilitiesOutput.features.length}
- **Routes:** ${routesOutput.routes.length} (${routesOutput.routes.filter((r) => r.status === 'OK').length} OK, ${routesOutput.routes.filter((r) => r.status !== 'OK').length} NO_SAFE_ROUTE)
- **Exposed Buildings:** ${buildingsRaw.features.length}
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readmeContent, 'utf8');

  console.log('Build completed successfully.');
  console.log(`- Zones: ${processedZones.length} (HIGH: ${riskCounts.HIGH}, MED: ${riskCounts.MEDIUM}, LOW: ${riskCounts.LOW}, UNK: ${riskCounts.UNKNOWN})`);
  console.log(`- Blocked roads: ${blockedRoadFeatures.length}`);
  console.log(`- Flood polygons: ${floodFeatures.length} (dropped: ${floodFeaturesDropped})`);
  console.log(`- Facilities: ${facilitiesOutput.features.length}`);
  console.log(`- Routes: ${routesOutput.routes.length}`);
  console.log(`- Buildings: ${buildingsRaw.features.length}`);
}

buildDernauDemo();
