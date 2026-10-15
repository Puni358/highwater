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
  dataSource = null,
  source = null,
  onRefresh,
  loading = false,
  lastRefreshedAt = null,
}) {
  const activeSource = dataSource || (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_DATA_SOURCE : null);

  const isFloodWatch =
    activeSource === 'mock-floodwatch' ||
    (typeof source === 'string' && source.includes('FloodWatch')) ||
    (typeof studyArea === 'string' && studyArea.includes('FloodWatch'));

  const isDernau =
    !isFloodWatch &&
    dataMode === 'demo' &&
    !studyArea?.includes('Bengaluru') &&
    (activeSource === 'mock-dernau' ||
      (typeof source === 'string' && source.includes('SpaceNet')) ||
      (typeof studyArea === 'string' && studyArea.includes('Dernau')));

  const isDemo = dataMode === 'demo' && !isDernau && !isFloodWatch;

  const formatTimestamp = (ts) => {
    if (!ts) return 'Timestamp not available';
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Local';
    } catch {
      return ts;
    }
  };

  const formatHHMM = (ts) => {
    if (!ts) return null;
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return null;
      const h = String(date.getHours()).padStart(2, '0');
      const m = String(date.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    } catch {
      return null;
    }
  };

  const lastRefreshedTime = formatHHMM(lastRefreshedAt);

  const cleanStudyArea =
    typeof studyArea === 'string'
      ? studyArea
          .replace(/SpaceNet\s*8\s*/gi, '')
          .replace(/Germany AOI/g, 'Ahr Valley Sector')
          .trim()
      : studyArea;

  return (
    <header className="h-14 bg-navy-900 text-white px-4 md:px-6 flex items-center justify-between border-b border-navy-700 shadow-sm shrink-0 font-sans">
      {/* Left: Logo & Brand */}
      <div className="flex items-center space-x-3">
        <div className="p-1.5 bg-flood/20 rounded-md text-flood flex items-center justify-center">
          <Waves className="w-5 h-5 text-flood" aria-hidden="true" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-title font-bold tracking-wider text-white">HIGHWATER</span>
          <span className="hidden sm:inline-block text-[11px] font-semibold tracking-wider uppercase text-sky-300 px-1.5 py-0.5 rounded bg-navy-700/80 border border-navy-700">
            Flood Ops
          </span>
        </div>
      </div>

      {/* Center: Context & Study Area */}
      <div className="flex items-center space-x-2 sm:space-x-4 text-xs">
        <div className="hidden md:flex items-center space-x-1.5 text-slate-300">
          <span className="font-semibold text-white">Area:</span>
          <span>{cleanStudyArea}</span>
        </div>
        <span className="hidden md:inline text-slate-600">•</span>
        <div className="flex items-center space-x-1.5 text-slate-300">
          <span className="font-semibold text-white">Data generated:</span>
          <span>{formatTimestamp(timestamp)}</span>
        </div>
        {lastRefreshedTime && (
          <>
            <span className="hidden lg:inline text-slate-600">•</span>
            <div className="flex items-center space-x-1.5 text-slate-300">
              <span className="font-semibold text-white">Last refreshed:</span>
              <span className="font-mono">{lastRefreshedTime}</span>
            </div>
          </>
        )}
      </div>

      {/* Right: Mode Badge & Refresh Action */}
      <div className="flex items-center space-x-3">
        {isFloodWatch || isDernau ? (
          <div
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-badge bg-sky-950/70 text-sky-200 text-xs font-semibold tracking-wider uppercase border border-sky-600/40 shadow-xs"
            role="status"
            aria-label="Simulated operations environment active"
          >
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" aria-hidden="true" />
            <span>Simulated Ops</span>
          </div>
        ) : isDemo ? (
          <div
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-badge bg-sky-950/70 text-sky-200 text-xs font-semibold tracking-wider uppercase border border-sky-600/40 shadow-xs"
            role="status"
            aria-label="Demonstration mode active"
          >
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" aria-hidden="true" />
            <span>DEMO MODE</span>
          </div>
        ) : (
          <div
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-badge bg-emerald-950/70 text-emerald-300 text-xs font-semibold tracking-wider uppercase border border-emerald-600/40 shadow-xs"
            role="status"
            aria-label="Connected data active"
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Connected data</span>
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
