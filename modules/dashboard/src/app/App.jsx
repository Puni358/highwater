import React from 'react';
import DashboardLayout from './DashboardLayout.jsx';
import { useDashboardData } from '../hooks/useDashboardData.js';

/**
 * App root component
 * Wires the useDashboardData hook to DashboardLayout.
 */
export default function App() {
  const { data, loading, error, refresh } = useDashboardData();

  return (
    <DashboardLayout
      data={data}
      loading={loading}
      error={error}
      onRefresh={refresh}
    />
  );
}
