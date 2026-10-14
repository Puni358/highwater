import React from 'react';
import { Waves, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';

/**
 * Header component (compact, ~56px)
 * Displays brand, study area, timestamp, DEMO MODE badge, and refresh trigger.
 */
export default function Header({
  studyArea = 'Bengaluru, Karnataka',
  timestamp = null,
  dataMode = 'demo',
  onRefresh,
  loading = false,
}) {
  const isDemo = dataMode === 'demo';

  const formatTimestamp = (ts) => {
    if (!ts) return 'Timestamp not available';
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Local';
    } catch {
      return ts;
    }
  };

  return (
    <header className="h-14 bg-navy-900 text-white px-4 md:px-6 flex items-center justify-between border-b border-navy-700 shadow-sm shrink-0">
      {/* Left: Logo & Brand */}
      <div className="flex items-center space-x-3">
        <div className="p-1.5 bg-flood/20 rounded-md text-flood flex items-center justify-center">
          <Waves className="w-5 h-5 text-flood" aria-hidden="true" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-title font-bold tracking-wider text-white">HIGHWATER</span>
          <span className="hidden sm:inline-block text-xs text-text-muted px-1.5 py-0.5 rounded bg-navy-700/60">
            Flood Ops
          </span>
        </div>
      </div>

      {/* Center: Context & Study Area */}
      <div className="flex items-center space-x-2 sm:space-x-4 text-xs">
        <div className="hidden md:flex items-center space-x-1.5 text-slate-300">
          <span className="font-semibold text-white">Area:</span>
          <span>{studyArea}</span>
        </div>
        <span className="hidden md:inline text-slate-600">•</span>
        <div className="flex items-center space-x-1.5 text-slate-300">
          <span className="font-semibold text-white">Updated:</span>
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>

      {/* Right: Mode Badge & Refresh Action */}
      <div className="flex items-center space-x-3">
        {isDemo ? (
          <div
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-badge bg-demo-bg text-demo-text text-xs font-semibold tracking-wide border border-amber-300/60"
            role="status"
            aria-label="Demonstration mode active"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-demo-text" aria-hidden="true" />
            <span>DEMO MODE</span>
          </div>
        ) : (
          <div
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-badge bg-risk-low/20 text-emerald-300 text-xs font-medium border border-risk-low/40"
            role="status"
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>OPERATIONAL</span>
          </div>
        )}

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh dashboard data"
          className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-navy-700 hover:bg-navy-700/80 active:scale-95 text-white text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-flood"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </header>
  );
}
