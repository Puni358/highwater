import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ZoneDetails from '../components/ZoneDetails.jsx';

describe('ZoneDetails component (T4.5, FR-20, FR-21)', () => {
  const completeZone = {
    zoneId: 'zone-001',
    name: 'Bellandur Basin',
    riskLevel: 'HIGH',
    riskScore: 82,
    floodedAreaKm2: 2.4,
    floodedPercent: 68,
    exposedBuildings: 34,
    accessibility: 'LIMITED',
    reasons: ['Critical stormwater drainage blockage', 'Submerged access routes'],
    hasGeometry: true,
  };

  const missingDataZone = {
    zoneId: 'zone-009',
    name: 'Peripheral Relief Staging',
    riskLevel: 'UNKNOWN',
    riskScore: null,
    floodedAreaKm2: null,
    floodedPercent: null,
    exposedBuildings: null,
    accessibility: 'UNKNOWN',
    reasons: [],
    hasGeometry: false,
  };

  it('renders complete zone details with metrics, risk badge, and reasons', () => {
    render(
      <ZoneDetails
        zone={completeZone}
        timestamp="2026-10-12T10:00:00Z"
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByText('Bellandur Basin')).toBeInTheDocument();
    expect(screen.getByText('Zone ID:')).toBeInTheDocument();
    expect(screen.getByText('zone-001')).toBeInTheDocument();
    expect(screen.getByText('82 / 100')).toBeInTheDocument();
    expect(screen.getByText('2.4 km²')).toBeInTheDocument();
    expect(screen.getByText('Coverage: 68%')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('Restricted access')).toBeInTheDocument();
    expect(screen.getByText('Critical stormwater drainage blockage')).toBeInTheDocument();
    expect(screen.getByText('Submerged access routes')).toBeInTheDocument();
    expect(screen.getByText('2026-10-12T10:00:00Z')).toBeInTheDocument();
  });

  it('renders "Not available" for missing fields and never coerces to 0 (T4.5, test matrix #8)', () => {
    render(
      <ZoneDetails
        zone={missingDataZone}
        timestamp={null}
        onClearSelection={vi.fn()}
      />
    );

    expect(screen.getByText('Peripheral Relief Staging')).toBeInTheDocument();
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('None reported')).toBeInTheDocument();
    expect(screen.getByText('Non-spatial staging area')).toBeInTheDocument();
    expect(screen.getByText('Partial data')).toBeInTheDocument();
  });

  it('renders "Partial data" note and preserves risk level when risk_level is supplied but other fields are null', () => {
    const partialZone = {
      zoneId: 'zone-partial',
      name: 'Partial High Zone',
      riskLevel: 'HIGH',
      riskScore: 92,
      floodedAreaKm2: 1.5,
      floodedPercent: 25,
      exposedBuildings: null, // missing numeric
      accessibility: 'OPEN',
      reasons: ['High flood impact'],
      hasGeometry: true,
      partialData: true,
    };

    render(<ZoneDetails zone={partialZone} onClearSelection={vi.fn()} />);

    expect(screen.getByText('Partial High Zone')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('92 / 100')).toBeInTheDocument();
    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state when no zone is selected', () => {
    render(<ZoneDetails zone={null} />);

    expect(screen.getByText('No Zone Selected')).toBeInTheDocument();
    expect(screen.getByText(/Select a zone on the map or in the list/i)).toBeInTheDocument();
  });

  it('calls onClearSelection when clear button is clicked', () => {
    const handleClear = vi.fn();
    render(<ZoneDetails zone={completeZone} onClearSelection={handleClear} />);

    const clearBtn = screen.getByTitle('Clear zone selection');
    fireEvent.click(clearBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);
  });
});
