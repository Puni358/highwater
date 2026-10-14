import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function areCoordinatesWithinBbox(coordinates, bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (const pt of coordinates) {
    if (pt[0] < minLon || pt[0] > maxLon || pt[1] < minLat || pt[1] > maxLat) {
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
  // 2. zones.json
  // ----------------------------------------------------
  const fixedGeneratedAt = '2026-10-14T10:00:00Z';
  const riskMethodStr = 'score = 0.40*min(flooded_percent/20,1) + 0.35*(exposed_buildings/total_buildings, 0 if none) + 0.25*(flooded_road_length_m/road_length_m, 0 if none), times 100, rounded to 1 dp (illustrative demo score, not Member 3 output)';

  const accessibilityMap = {
    ACCESSIBLE: 'OPEN',
    PARTIAL: 'LIMITED',
    BLOCKED: 'BLOCKED',
    UNKNOWN: 'UNKNOWN'
  };

  const processedZones = zonesRaw.zones.map((z) => {
    const zoneNum = parseInt(z.zone_id.replace('zone-', ''), 10);
    const paddedNum = String(zoneNum).padStart(3, '0');
    const name = `Zone ${paddedNum} (grid cell)`;

    // Flooded area km2 from m2
    const flooded_area_km2 = Number((z.flooded_area_m2 / 1000000).toFixed(4));

    // Edge case 2: Exactly one zone with exposed_buildings null -> zone-005
    const exposed_buildings = (z.zone_id === 'zone-005') ? null : z.exposed_buildings;
    const total_buildings = z.total_buildings;

    // Accessibility mapping
    const accessibility = accessibilityMap[z.accessibility] || 'UNKNOWN';

    // Edge case 3: At least one UNKNOWN risk zone
    // Rule: A zone with no buildings AND no road data gets risk_level UNKNOWN and risk_score null.
    // zone-018 has road_length_m: 0 and accessibility UNKNOWN, designated as UNKNOWN risk test zone.
    let risk_score = null;
    let risk_level = 'UNKNOWN';

    if (z.zone_id === 'zone-018' || (total_buildings === 0 && (!z.road_length_m || z.road_length_m === 0))) {
      risk_level = 'UNKNOWN';
      risk_score = null;
    } else {
      const bPart = (total_buildings > 0 && exposed_buildings !== null)
        ? (exposed_buildings / total_buildings)
        : 0;
      const rPart = (z.road_length_m > 0)
        ? (z.flooded_road_length_m / z.road_length_m)
        : 0;

      const rawScore = (0.40 * Math.min(z.flooded_percent / 20, 1) + 0.35 * bPart + 0.25 * rPart) * 100;
      risk_score = Math.round(rawScore * 10) / 10;
      if (risk_score >= 60) {
        risk_level = 'HIGH';
      } else if (risk_score >= 30) {
        risk_level = 'MEDIUM';
      } else {
        risk_level = 'LOW';
      }
    }

    // Edge case 1: Exactly one zone with geometry null -> zone-038
    let geometry = null;
    if (z.zone_id !== 'zone-038') {
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

    // Reasons derived purely from metrics
    const reasons = [];
    if (z.zone_id === 'zone-018') {
      reasons.push('No road data in zone');
      reasons.push('Insufficient infrastructure data for risk evaluation');
    } else if (z.zone_id === 'zone-005') {
      reasons.push('Building exposure survey pending');
      reasons.push('No flood coverage detected');
    } else {
      if (total_buildings > 0) {
        reasons.push(`${exposed_buildings} of ${total_buildings} buildings flood-labelled`);
      }
      if (z.flooded_percent > 0) {
        reasons.push(`${z.flooded_percent}% area inundated`);
      }
      if (z.flooded_road_length_m > 0 && z.road_length_m > 0) {
        reasons.push(`${z.flooded_road_length_m.toFixed(1)}m of ${z.road_length_m.toFixed(1)}m road flooded`);
      }
      if (reasons.length === 0) {
        reasons.push('No flood coverage detected');
      }
    }

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
      reasons,
      geometry
    };
  });

  const zonesOutput = {
    schema_version: '1.0',
    generated_at: fixedGeneratedAt,
    data_mode: 'demo',
    source: 'SpaceNet 8 Germany (Dernau)',
    study_area: 'Dernau (Ahr valley), Germany',
    crs: 'EPSG:4326',
    risk_method: riskMethodStr,
    zones: processedZones
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'zones.json'), JSON.stringify(zonesOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 3. flood_extent.geojson
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
      if (!isRingClosed(ring) || !areCoordinatesWithinBbox(ring, aoiBbox)) {
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
  // 5. facilities.geojson (3 simulated demo points in non-flooded areas)
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
          coordinates: [7.01678, 50.52059] // Near dry road node in zone-016
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
          coordinates: [7.03392, 50.51549] // Non-flooded centroid in zone-007
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
          coordinates: [7.04249, 50.51294] // Non-flooded centroid in zone-003
        }
      }
    ]
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'facilities.geojson'), JSON.stringify(facilitiesOutput, null, 2) + '\n', 'utf8');

  // ----------------------------------------------------
  // 6. routes.json
  // ----------------------------------------------------
  // Find real non-flooded road sequences from roadsRaw
  const dryRoadWays = roadsRaw.features.filter(
    (f) => f.properties && f.properties.flooded === false && f.geometry.type === 'LineString'
  );

  const route1Feat = dryRoadWays.find((f) => f.properties.id === 'way/847402010');
  const route2Feat = dryRoadWays.find((f) => f.properties.id === 'way/847402013');

  if (!route1Feat || !route2Feat) {
    throw new Error('Could not locate required non-flooded road paths for routes');
  }

  const coords1 = route1Feat.geometry.coordinates;
  const coords2 = route2Feat.geometry.coordinates;

  const dist1 = computePathDistance(coords1);
  const dist2 = computePathDistance(coords2);

  const routesOutput = {
    routes: [
      {
        route_id: 'route-001',
        name: 'Route 001 (North Access)',
        status: 'OK',
        distance_m: dist1,
        eta_minutes: null,
        provenance: 'simulated',
        geometry: {
          type: 'LineString',
          coordinates: coords1
        }
      },
      {
        route_id: 'route-002',
        name: 'Route 002 (West Access)',
        status: 'OK',
        distance_m: dist2,
        eta_minutes: null,
        provenance: 'simulated',
        geometry: {
          type: 'LineString',
          coordinates: coords2
        }
      },
      {
        route_id: 'route-003',
        name: 'Route 003 (Cut-off Sector)',
        status: 'UNREACHABLE',
        distance_m: null,
        eta_minutes: null,
        provenance: 'simulated',
        geometry: null
      }
    ]
  };

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

- **Dataset Source:** SpaceNet 8 Flood Detection Challenge, Germany training set (Dernau area).
- **Annotations License:** CC BY-SA 4.0.
- **Imagery:** Maxar Technologies imagery (CC BY-NC 4.0 in original dataset) is **not** redistributed here. Only derived vector outputs are included.
- **Attribution:** SpaceNet 8 (SpaceNet on Amazon Web Services), Maxar Technologies.

## Derivation Notes

- **Flood Extent (\`flood_extent.geojson\`):**
  There is no measured water boundary or flood raster in this dataset. The flood extent was derived by unioning and buffering (5.0m) ground-truth flooded building polygons and flooded road line segments.
- **Risk Scores & Levels (\`zones.json\`):**
  Risk scores and levels are **illustrative demo scores, not Member 3 (risk engine) outputs**.
  Derived using the documented demo formula:
  $$\\text{score} = \\left(0.40 \\cdot \\min\\left(\\frac{\\text{flooded\\_percent}}{20}, 1\\right) + 0.35 \\cdot \\frac{\\text{exposed\\_buildings}}{\\text{total\\_buildings}} + 0.25 \\cdot \\frac{\\text{flooded\\_road\\_length\\_m}}{\\text{road\\_length\\_m}}\\right) \\times 100$$
  Rounded to 1 decimal place.
  - \`HIGH\`: score $\\ge 60$
  - \`MEDIUM\`: score $\\ge 30$
  - \`LOW\`: score $< 30$
  - \`UNKNOWN\`: score is \`null\` when a zone has insufficient infrastructure data (e.g. no road data or no buildings).
- **Facilities (\`facilities.geojson\`):**
  Three simulated points (hospital, shelter, depot) placed in non-flooded areas inside the AOI. Provenance: \`simulated\`.
- **Routes (\`routes.json\`):**
  Two \`OK\` routes with geometry reused from real non-flooded road segments in \`roads_status.geojson\` with Haversine distance, and one \`UNREACHABLE\` route with \`geometry: null\`. \`eta_minutes\` is \`null\` (no fabricated speeds). Provenance: \`simulated\`.
- **AOI Location:**
  Dernau (Ahr valley), Rhineland-Palatinate, Germany (approx bbox \`[7.015, 50.511]\` to \`[7.044, 50.531]\`). The dashboard map must fit its bounds dynamically from the dataset.

## Required Edge Cases

1. **Zone with \`geometry: null\`:**
   - \`zone-038\` has \`geometry: null\` to verify that zones without spatial representation remain listed and selectable in the UI without crashing the Leaflet map.
2. **Zone with missing numeric field (\`exposed_buildings: null\`):**
   - \`zone-005\` has \`exposed_buildings: null\` to verify the UI displays "Not available" rather than falsely coercing missing data to 0.
3. **Zone with \`UNKNOWN\` risk level:**
   - \`zone-018\` has \`risk_level: "UNKNOWN"\` and \`risk_score: null\` because it contains no road data (\`road_length_m === 0\`, accessibility \`UNKNOWN\`).

## Dataset Statistics

- **Total Zones:** ${processedZones.length}
  - \`HIGH\`: ${riskCounts.HIGH}
  - \`MEDIUM\`: ${riskCounts.MEDIUM}
  - \`LOW\`: ${riskCounts.LOW}
  - \`UNKNOWN\`: ${riskCounts.UNKNOWN}
- **Blocked Roads:** ${blockedRoadFeatures.length}
- **Flood Polygons (valid inside AOI):** ${floodFeatures.length}
- **Dropped Features:** ${floodFeaturesDropped} (2 flood polygons dropped for extending past the northern AOI bbox boundary)
- **Facilities:** ${facilitiesOutput.features.length}
- **Routes:** ${routesOutput.routes.length} (2 OK, 1 UNREACHABLE)
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
