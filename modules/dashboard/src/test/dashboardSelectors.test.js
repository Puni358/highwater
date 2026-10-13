import { describe, it, expect } from 'vitest';
import { selectSummaryStats } from '../features/dashboard/dashboardSelectors.js';

describe('dashboardSelectors', () => {
  it('correctly calculates summary metrics from normalised zones', () => {
    const mockData = {
      metadata: { dataMode: 'demo' },
      zones: [
        { zoneId: 'z1', riskLevel: 'HIGH', floodedAreaKm2: 2.4, exposedBuildings: 30 },
        { zoneId: 'z2', riskLevel: 'MEDIUM', floodedAreaKm2: 1.1, exposedBuildings: 10 },
        { zoneId: 'z3', riskLevel: 'HIGH', floodedAreaKm2: 3.8, exposedBuildings: 60 },
        { zoneId: 'z4', riskLevel: 'UNKNOWN', floodedAreaKm2: null, exposedBuildings: null },
      ],
      blockedRoads: {
        features: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
      },
    };

    const stats = selectSummaryStats(mockData);

    expect(stats.floodedAreaKm2).toBe(7.3); // 2.4 + 1.1 + 3.8
    expect(stats.highPriorityCount).toBe(2); // 2 HIGH zones
    expect(stats.exposedBuildingsCount).toBe(100); // 30 + 10 + 60
    expect(stats.blockedRoadsCount).toBe(3);
    expect(stats.isDemo).toBe(true);
  });

  it('handles null/missing numeric fields without coercing to zero', () => {
    const emptyNumericData = {
      metadata: { dataMode: 'demo' },
      zones: [
        { zoneId: 'z1', riskLevel: 'UNKNOWN', floodedAreaKm2: null, exposedBuildings: null },
      ],
      blockedRoads: { features: [] },
    };

    const stats = selectSummaryStats(emptyNumericData);
    expect(stats.floodedAreaKm2).toBeNull();
    expect(stats.exposedBuildingsCount).toBeNull();
  });
});
