import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDashboardData } from '../hooks/useDashboardData.js';
import * as dashboardApi from '../services/dashboardApi.js';

describe('useDashboardData hook (T4.2, test matrix #18)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads dashboard fixtures and sets data correctly', async () => {
    const mockRaw = {
      rawZones: {
        schema_version: '1.0',
        data_mode: 'demo',
        study_area: 'Test Area',
        zones: [
          {
            zone_id: 'zone-001',
            name: 'Test Zone',
            risk_level: 'HIGH',
            risk_score: 80,
          },
        ],
      },
      rawFloodExtent: { type: 'FeatureCollection', features: [] },
      rawBlockedRoads: { type: 'FeatureCollection', features: [] },
      rawFacilities: { type: 'FeatureCollection', features: [] },
      rawRoutes: { schema_version: '1.0', data_mode: 'demo', routes: [] },
    };

    vi.spyOn(dashboardApi, 'fetchDashboardData').mockResolvedValue(mockRaw);

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    expect(result.current.data.zones).toHaveLength(1);
    expect(result.current.data.zones[0].zoneId).toBe('zone-001');
    expect(result.current.error).toBeNull();
  });

  it('prevents duplicate in-flight requests when refresh is called repeatedly (test matrix #18)', async () => {
    let resolveFirst;
    const pendingPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    const mockFetch = vi.spyOn(dashboardApi, 'fetchDashboardData').mockImplementation(() => pendingPromise);

    const { result } = renderHook(() => useDashboardData());

    // Initially called on mount (1st call)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    // Call refresh multiple times while initial request is still in-flight
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });

    // In-flight guard should prevent duplicate requests
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Now resolve the in-flight request
    await act(async () => {
      resolveFirst({
        rawZones: { schema_version: '1.0', zones: [] },
        rawFloodExtent: { type: 'FeatureCollection', features: [] },
        rawBlockedRoads: { type: 'FeatureCollection', features: [] },
        rawFacilities: { type: 'FeatureCollection', features: [] },
        rawRoutes: { routes: [] },
      });
      await pendingPromise;
    });

    expect(result.current.loading).toBe(false);

    // Subsequent refresh after completion is now permitted
    await act(async () => {
      mockFetch.mockResolvedValueOnce({
        rawZones: { schema_version: '1.0', zones: [] },
        rawFloodExtent: { type: 'FeatureCollection', features: [] },
        rawBlockedRoads: { type: 'FeatureCollection', features: [] },
        rawFacilities: { type: 'FeatureCollection', features: [] },
        rawRoutes: { routes: [] },
      });
      await result.current.refresh();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
