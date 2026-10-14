import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDashboardData } from '../services/dashboardApi.js';
import { adaptDashboardData } from '../data/dataAdapter.js';

/**
 * Custom hook to load and manage dashboard data.
 * Manages loading, error, and refresh states with in-flight guard.
 */
export function useDashboardData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  const loadData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const raw = await fetchDashboardData();
      const normalized = adaptDashboardData(raw);
      setData(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    data,
    loading,
    error,
    refresh: loadData,
  };
}
