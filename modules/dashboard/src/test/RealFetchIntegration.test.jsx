import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { getDashboardData, API_RESOURCE_PATHS } from '../services/dashboardApi.js';
import { adaptDashboardData } from '../data/dataAdapter.js';
import DashboardLayout from '../app/DashboardLayout.jsx';

describe('Real-Fetch Integration & Failure Tests (T6.2, T6.5)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches from configurable API endpoints when dataSource is "api"', async () => {
    const requestedUrls = [];
    global.fetch = vi.fn().mockImplementation((url) => {
      requestedUrls.push(url);
      if (url.includes('/api/v1/zones')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              schema_version: '1.0',
              data_mode: 'live',
              study_area: 'Live City Center',
              generated_at: new Date().toISOString(),
              zones: [
                {
                  zone_id: 'zone-live-01',
                  name: 'Live Core Zone',
                  risk_level: 'HIGH',
                  risk_score: 92,
                  flooded_area_km2: 4.5,
                  flooded_percent: 75,
                  exposed_buildings: 110,
                  geometry: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [77.5, 12.9],
                        [77.6, 12.9],
                        [77.6, 13.0],
                        [77.5, 13.0],
                        [77.5, 12.9],
                      ],
                    ],
                  },
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
      });
    });

    const baseUrl = 'https://api.highwater.org/api/v1';
    const raw = await getDashboardData({
      dataSource: 'api',
      baseUrl,
    });

    expect(requestedUrls).toContain(`${baseUrl}${API_RESOURCE_PATHS.zones}`);
    expect(requestedUrls).toContain(`${baseUrl}${API_RESOURCE_PATHS.floodExtent}`);
    expect(requestedUrls).toContain(`${baseUrl}${API_RESOURCE_PATHS.blockedRoads}`);
    expect(requestedUrls).toContain(`${baseUrl}${API_RESOURCE_PATHS.facilities}`);
    expect(requestedUrls).toContain(`${baseUrl}${API_RESOURCE_PATHS.routes}`);

    // Verify adapter consumes API payload without component changes
    const adapted = adaptDashboardData(raw);
    expect(adapted.metadata.studyArea).toBe('Live City Center');
    expect(adapted.metadata.dataMode).toBe('live');
    expect(adapted.zones).toHaveLength(1);
    expect(adapted.zones[0].zoneId).toBe('zone-live-01');
    expect(adapted.zones[0].riskScore).toBe(92);

    // Verify layout renders live data seamlessly without component modification
    render(<DashboardLayout data={adapted} onRefresh={vi.fn()} />);
    expect(screen.getByText('Live Core Zone')).toBeInTheDocument();
  });

  it('handles failed API response with clear error (T6.5, test matrix #17)', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/zones')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await expect(
      getDashboardData({
        dataSource: 'api',
        baseUrl: 'https://api.highwater.org',
      })
    ).rejects.toThrow(/API request failed: Failed to load zones from https:\/\/api.highwater.org\/zones \(500 Internal Server Error\)/);
  });

  it('handles empty API response cleanly, rendering EmptyState without crashing (T6.5, test matrix #7)', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            schema_version: '1.0',
            data_mode: 'live',
            study_area: 'Zero Inundation Zone',
            generated_at: new Date().toISOString(),
            zones: [],
          }),
      });
    });

    const raw = await getDashboardData({
      dataSource: 'api',
      baseUrl: 'https://api.highwater.org',
    });

    const adapted = adaptDashboardData(raw);
    expect(adapted.zones).toHaveLength(0);

    // Render DashboardLayout with empty API zones
    render(<DashboardLayout data={adapted} onRefresh={vi.fn()} />);
    expect(screen.getByText('No Zones Available')).toBeInTheDocument();
    expect(screen.getByText(/No flood risk zones or operational sectors are reported/i)).toBeInTheDocument();
  });

  it('isolates malformed secondary API layers without crashing dashboard (T6.5, test matrix #11)', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/zones')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              schema_version: '1.0',
              data_mode: 'live',
              zones: [
                {
                  zone_id: 'zone-01',
                  name: 'Safe Staging',
                  risk_level: 'LOW',
                  risk_score: 15,
                  has_geometry: false,
                },
              ],
            }),
        });
      }
      if (url.includes('/flood-extent')) {
        // Return 502 Bad Gateway for flood layer
        return Promise.resolve({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
        });
      }
      if (url.includes('/blocked-roads')) {
        // Return malformed JSON for roads layer
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
      });
    });

    const raw = await getDashboardData({
      dataSource: 'api',
      baseUrl: 'https://api.highwater.org',
    });

    // Verify secondary layers were safely isolated to null
    expect(raw.rawZones).toBeDefined();
    expect(raw.rawFloodExtent).toBeNull();
    expect(raw.rawBlockedRoads).toBeNull();

    // Verify adaptDashboardData handles null secondary layers smoothly
    const adapted = adaptDashboardData(raw);
    expect(adapted.zones).toHaveLength(1);
    expect(adapted.floodExtent.features).toEqual([]);
    expect(adapted.blockedRoads.features).toEqual([]);

    render(<DashboardLayout data={adapted} onRefresh={vi.fn()} />);
    expect(screen.getByText('Safe Staging')).toBeInTheDocument();
  });
});
