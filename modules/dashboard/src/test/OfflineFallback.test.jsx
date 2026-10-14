import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FloodMap from '../components/FloodMap.jsx';

describe('Offline Tile Fallback (T5.6, test matrix #19)', () => {
  it('renders neutral background container for base map', () => {
    const { container } = render(
      <FloodMap
        floodGeoJSON={{ type: 'FeatureCollection', features: [] }}
        riskZones={[]}
      />
    );

    const mapContainer = container.querySelector('.leaflet-container');
    expect(mapContainer).toBeInTheDocument();
    expect(mapContainer).toHaveClass('bg-slate-200');
  });

  it('renders offline tile warning notice when tileerror fires or tiles are unreachable', () => {
    const { rerender } = render(
      <FloodMap
        floodGeoJSON={{ type: 'FeatureCollection', features: [] }}
        riskZones={[]}
        tilesOffline={false}
      />
    );

    expect(screen.queryByText(/Base map tiles unreachable/i)).not.toBeInTheDocument();

    // Re-render with tilesOffline = true (simulating tile fetch failure)
    rerender(
      <FloodMap
        floodGeoJSON={{ type: 'FeatureCollection', features: [] }}
        riskZones={[]}
        tilesOffline={true}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Base map tiles unreachable\. Vector flood overlays continue to operate offline\./i)).toBeInTheDocument();
  });
});
