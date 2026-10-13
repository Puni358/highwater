# Chapter 09: UI System States & Resilient Fault Tolerance

---

### 9.1 The Philosophy of Fault-Tolerant Disaster UX

In an active disaster response environment, the client interface cannot afford to fail with an unhandled runtime error or a white screen of death. Responders in the field encounter flaky cellular networks, power interruptions, and evolving backend microservices.

The HighWater UI state machine guarantees continuous operation across five primary states:

```
                      ┌───────────────┐
                      │    IDLE       │
                      └───────┬───────┘
                              │ fetchDashboardData()
                              ▼
                      ┌───────────────┐
                      │   LOADING     │ ──► [ LoadingSkeleton ]
                      └───────┬───────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
     ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
     │   SUCCESS   │   │    EMPTY    │   │    ERROR    │
     └──────┬──────┘   └─────────────┘   └─────────────┘
            │                 ▲                 ▲
            │ (Age > 15m)     │ (0 Results)     │ (500/Network)
            ▼                 │                 │
     ┌─────────────┐          │                 │
     │ STALE DATA  │   [ EmptyState ]    [ ErrorState + Retry ]
     └─────────────┘
```

---

### 9.2 Loading Skeletons (`src/components/common/LoadingSkeleton.jsx`)

Provides visual stability during initial data fetch and refreshes, preventing disruptive layout shifts (CLS):

```jsx
import React from 'react';

export function DashboardSkeleton() {
  return (
    <div className="flex h-screen flex-col bg-slate-100 p-4 animate-pulse">
      {/* 1. Header Skeleton */}
      <div className="h-14 w-full rounded-xl bg-slate-200 mb-4" />

      {/* 2. Stat Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-200" />
        ))}
      </div>

      {/* 3. Main Workspace Split: Map & Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Map Canvas Skeleton */}
        <div className="lg:col-span-2 rounded-xl bg-slate-200 relative flex items-center justify-center">
          <div className="text-slate-400 font-medium text-sm flex items-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
            Loading GIS Tile Engine & Satellite Inundation Polygons...
          </div>
        </div>

        {/* Sidebar / List Skeleton */}
        <div className="rounded-xl bg-slate-200 p-4 space-y-3">
          <div className="h-9 w-full bg-slate-300 rounded-lg" />
          <div className="space-y-2 mt-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-300/70 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### 9.3 Empty State Component (`src/components/common/EmptyState.jsx`)

Handles scenarios where no zones match search filters, or the server reports zero flood impact:

```jsx
import React from 'react';
import { SearchX, FilterX } from 'lucide-react';

export function EmptyState({
  title = 'No Matching Zones Found',
  message = 'Try modifying your search term or clearing the active risk filter.',
  onReset,
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="rounded-full bg-slate-100 p-3 text-slate-400">
        <SearchX className="h-6 w-6 stroke-1.5" />
      </div>
      <h3 className="mt-3 text-sm font-bold text-slate-800">{title}</h3>
      <p className="mt-1 text-xs text-slate-500 max-w-xs">{message}</p>

      {onReset && (
        <button
          onClick={onReset}
          className="mt-4 flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <FilterX className="h-3.5 w-3.5" />
          Reset All Filters
        </button>
      )}
    </div>
  );
}
```

---

### 9.4 Error State Component with Retry (`src/components/common/ErrorState.jsx`)

When network requests fail or endpoints return 500 errors:

```jsx
import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

export function ErrorState({ error, onRetry }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
      <div className="rounded-full bg-red-100 p-3 text-red-600">
        <AlertTriangle className="h-8 w-8" />
      </div>

      <h3 className="mt-4 text-base font-bold text-slate-900">
        Unable to Load Disaster Telemetry
      </h3>
      <p className="mt-1 max-w-md text-xs text-slate-600">
        The dashboard encountered an error while communicating with the data engine. This could be due to network interruptions or offline field conditions.
      </p>

      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry Connection
        </button>
      )}

      {error && (
        <div className="mt-6 max-w-lg w-full">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center justify-center gap-1 mx-auto text-[11px] font-medium text-slate-400 hover:text-slate-600"
          >
            <span>Technical details</span>
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showDetails && (
            <div className="mt-2 rounded-lg bg-slate-900 p-3 text-left font-mono text-[11px] text-red-400 overflow-x-auto shadow-inner">
              {error.stack || error.message || String(error)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### 9.5 Stale Data Alert Banner (`src/components/common/StaleDataBanner.jsx`)

Warns decision-makers if upstream drone telemetry has ceased broadcasting:

```jsx
import React from 'react';
import { Clock, AlertCircle } from 'lucide-react';

export function StaleDataBanner({ ageMinutes, onRefresh }) {
  if (!ageMinutes || ageMinutes <= 15) return null;

  return (
    <div className="flex items-center justify-between bg-amber-500 text-white px-4 py-2 text-xs font-medium shadow-sm">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>
          <strong>Telemetry Stale Warning:</strong> The latest situation report was generated{' '}
          <strong>{ageMinutes} minutes ago</strong>. Flood crests or road conditions may have changed.
        </span>
      </div>

      <button
        onClick={onRefresh}
        className="rounded bg-amber-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-800 transition-colors shrink-0"
      >
        Force Refresh
      </button>
    </div>
  );
}
```
