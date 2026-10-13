import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FloodMap from '../components/FloodMap.jsx';

describe('FloodMap component (T3.1, T3.4, T3.6, T3.8)', () => {
  const sampleZones = [
    {
      zoneId: 'zone-001',
      name: 'Zone 001 - Bellandur Basin',
      riskLevel: 'HIGH',
      riskScore: 82,
      hasGeometry: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.655, 12.925],
            [77.690, 12.925],
            [77.690, 12.960],
            [77.655, 12.960],
            [77.655, 12.925],
          ],
        ],
      },
    },
    {
      zoneId: 'zone-009',
      name: 'Zone 009 - Non-spatial',
      riskLevel: 'LOW',
      riskScore: 10,
      hasGeometry: false,
      geometry: null,
    },
  ];

  const sampleFlood = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { feature_id: 'flood-001', water_depth_m: 1.4 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [77.66, 12.93],
              [77.68, 12.93],
              [77.68, 12.95],
              [77.66, 12.95],
              [77.66, 12.93],
            ],
          ],
        },
      },
    ],
  };

  it('renders Leaflet container and floating legend', () => {
    render(
      <FloodMap
        floodGeoJSON={sampleFlood}
        riskZones={sampleZones}
        visibleLayers={{ flood: true, risk: true, roads: false, facilities: false, routes: false }}
      />
    );

    expect(screen.getByRole('region', { name: 'Map Legend' })).toBeInTheDocument();
  });

  it('displays bad geometry count notification when features are dropped', () => {
    render(
      <FloodMap
        floodGeoJSON={sampleFlood}
        riskZones={sampleZones}
        droppedCount={3}
      />
    );

    expect(screen.getByText(/3 malformed features skipped/i)).toBeInTheDocument();
  });
});
