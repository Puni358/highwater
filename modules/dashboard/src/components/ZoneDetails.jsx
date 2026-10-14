import React from 'react';
import RiskBadge from './RiskBadge.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import { AlertCircle, CheckCircle, Ban, HelpCircle, X, ShieldAlert, MapPinOff } from 'lucide-react';

/**
 * Maps operational accessibility enum to human-friendly operational copy (design.md Section 5)
 */
function getAccessibilityDisplay(accessibility) {
  switch (accessibility) {
    case 'OPEN':
      return {
        label: 'Open access',
        icon: CheckCircle,
        className: 'text-risk-low bg-emerald-50 border-emerald-200',
      };
    case 'LIMITED':
      return {
        label: 'Restricted access',
        icon: AlertCircle,
        className: 'text-risk-medium bg-amber-50 border-amber-200',
      };
    case 'BLOCKED':
      return {
        label: 'Blocked access',
        icon: Ban,
        className: 'text-risk-high bg-red-50 border-red-200',
      };
    case 'CUT_OFF':
      return {
        label: 'Cut off',
        icon: ShieldAlert,
        className: 'text-risk-high bg-red-100 border-red-300 font-bold',
      };
    default:
      return {
        label: 'Not available',
        icon: HelpCircle,
        className: 'text-text-muted bg-surface border-border',
      };
  }
}

/**
 * ZoneDetails component (FR-20, FR-21, T4.5)
 * Displays in-depth assessment data for the selected zone.
 * Strictly adheres to rules.md:
 * - Missing data displays "Not available", never 0 or assumed values.
 * - Non-spatial zones show an explicit note.
 * - Reasons list renders directly from supplied data.
 */
export default function ZoneDetails({
  zone = null,
  route = null,
  timestamp = null,
  onClearSelection,
  isTestFixture = false,
}) {
  if (!zone) {
    return (
      <div
        className="bg-card border border-border rounded-card p-6 text-center space-y-3"
        role="region"
        aria-live="polite"
        aria-label="Zone Inspection Details"
      >
        <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center mx-auto text-text-muted">
          <HelpCircle className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text">No Zone Selected</h3>
          <p className="text-xs text-text-muted max-w-xs mx-auto">
            Select a zone on the map or in the list to inspect damage, risk score, and accessibility.
          </p>
        </div>
      </div>
    );
  }

  const access = getAccessibilityDisplay(zone.accessibility);
  const AccessIcon = access.icon;

  const isPartial = Boolean(
    zone.partialData ||
    zone.exposedBuildings === null ||
    zone.floodedAreaKm2 === null ||
    zone.floodedPercent === null
  );

  const isFixture = Boolean(
    isTestFixture ||
    zone.isTestFixture ||
    zone.isFixture ||
    (typeof zone.source === 'string' && zone.source.toLowerCase().includes('fixture')) ||
    (Array.isArray(zone.reasons) && zone.reasons.some((r) => r.toLowerCase().includes('designated test case')))
  );

  const scoreDisplay = zone.riskScore !== null ? `${zone.riskScore} / 100` : 'Not assessed';
  const floodAreaDisplay = zone.floodedAreaKm2 !== null ? `${zone.floodedAreaKm2} km²` : 'Not available';
  const floodPctDisplay = zone.floodedPercent !== null ? `${zone.floodedPercent}%` : 'Not available';
  const exposedBldgsDisplay = zone.exposedBuildings !== null ? zone.exposedBuildings : 'Not available';
  const updatedDisplay = timestamp || 'Not available';

  return (
    <div
      className="bg-card border border-border rounded-card p-4 shadow-xs space-y-4 font-sans"
      role="region"
      aria-live="polite"
      aria-label={`Zone Inspection Details for ${zone.name}`}
    >
      {/* Header: Zone Name, Risk Badge, and Clear Button */}
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-border">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h3 className="text-sm font-bold text-navy-900 truncate">
              {zone.name}
            </h3>
            <RiskBadge level={zone.riskLevel} size="sm" />
            {isPartial && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded shrink-0"
                title="Zone contains partial data"
              >
                Partial data
              </span>
            )}
            {zone.needsSurvey === true && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-purple-800 bg-purple-50 border border-purple-300 rounded shrink-0"
                title="Ground reconnaissance survey needed"
              >
                Needs survey
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted">
            Zone ID: <span className="font-mono">{zone.zoneId}</span>
          </p>
        </div>

        {onClearSelection && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-text-muted hover:text-text p-1 rounded hover:bg-surface transition"
            aria-label="Clear zone selection"
            title="Clear zone selection"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Geometry notice if zone is non-spatial (T4.6, FR-26) */}
      {!zone.hasGeometry && (
        <div
          className="p-2.5 bg-amber-50 border border-amber-300 rounded text-amber-900 text-xs flex items-start space-x-2"
          role="note"
        >
          <MapPinOff className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
          <div>
            <span className="font-bold block">Non-spatial staging area</span>
            <span>This zone does not have map boundary data and is not plotted on the map.</span>
          </div>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Risk Score */}
        <div className="p-2.5 rounded bg-surface border border-border/50">
          <span className="text-[11px] text-text-muted block">Priority Score</span>
          <span className={`text-sm font-bold block mt-0.5 ${zone.riskScore === null ? 'text-text-muted font-normal' : 'text-navy-900'}`}>
            {scoreDisplay}
          </span>
        </div>

        {/* Accessibility Status */}
        <div className="p-2.5 rounded bg-surface border border-border/50">
          <span className="text-[11px] text-text-muted block">Accessibility</span>
          <div className="flex items-center space-x-1.5 mt-0.5">
            <AccessIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold text-text truncate">
              {access.label}
            </span>
          </div>
        </div>

        {/* Flooded Area */}
        <div className="p-2.5 rounded bg-surface border border-border/50">
          <span className="text-[11px] text-text-muted block">Flooded Area</span>
          <span className="text-sm font-bold text-navy-900 mt-0.5 block">
            {floodAreaDisplay}
          </span>
          {zone.floodedPercent !== null && (
            <span className="text-[10px] text-text-muted block">
              Coverage: {floodPctDisplay}
            </span>
          )}
        </div>

        {/* Exposed Buildings */}
        <div className="p-2.5 rounded bg-surface border border-border/50">
          <span className="text-[11px] text-text-muted block">Exposed Buildings</span>
          <span className="text-sm font-bold text-navy-900 mt-0.5 block">
            {exposedBldgsDisplay}
          </span>
        </div>

        {/* Provenance */}
        {zone.provenance !== null && zone.provenance !== undefined && (
          <div className="p-2.5 rounded bg-surface border border-border/50">
            <span className="text-[11px] text-text-muted block">Provenance</span>
            <div className="mt-1 flex items-center space-x-1.5 flex-wrap">
              <ProvenanceBadge value={zone.provenance} />
              {zone.source && (
                <span className="text-[11px] text-text-muted block">
                  {zone.source}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Confidence (as supplied, no rescaling guesses) */}
        {zone.confidence !== null && zone.confidence !== undefined && (
          <div className="p-2.5 rounded bg-surface border border-border/50">
            <div className="flex items-center space-x-1">
              <span className="text-[11px] text-text-muted">Confidence</span>
              {isFixture && (
                <span className="text-[10px] text-text-muted italic">
                  (test fixture)
                </span>
              )}
            </div>
            <span className="text-sm font-bold text-navy-900 mt-0.5 block">
              {String(zone.confidence)}
            </span>
          </div>
        )}

        {/* Uncertainty Rank Range (P10 to P90) */}
        {(zone.rank_p10 !== null && zone.rank_p10 !== undefined || zone.rank_p90 !== null && zone.rank_p90 !== undefined) && (
          <div className="p-2.5 rounded bg-surface border border-border/50">
            <div className="flex items-center space-x-1">
              <span className="text-[11px] text-text-muted">Rank Range (P10 to P90)</span>
              {isFixture && (
                <span className="text-[10px] text-text-muted italic">
                  (test fixture)
                </span>
              )}
            </div>
            <span className="text-sm font-bold text-navy-900 mt-0.5 block">
              P10: {zone.rank_p10 ?? 'N/A'} • P90: {zone.rank_p90 ?? 'N/A'}
            </span>
          </div>
        )}
      </div>

      {/* Evacuation Route Assessment */}
      {route && (
        <div
          className={`p-2.5 rounded border text-xs flex items-start space-x-2 ${
            route.status === 'OK'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-red-50 border-red-200 text-red-950'
          }`}
          role="status"
          aria-label="Evacuation Route Assessment"
        >
          {route.status === 'OK' ? (
            <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
          ) : (
            <Ban className="w-4 h-4 shrink-0 text-red-600 mt-0.5" aria-hidden="true" />
          )}
          <div className="space-y-0.5 min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-bold">
                {route.status === 'OK' ? 'Evacuation Route Clear' : 'No Safe Route (Cut Off)'}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                route.status === 'OK' ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'
              }`}>
                {route.status}
              </span>
            </div>
            {route.destinationName && (
              <div className="text-text-muted">
                Destination: <span className="font-medium text-text">{route.destinationName}</span>
                {route.distanceM !== null && (
                  <span> ({route.distanceM >= 1000 ? `${(route.distanceM / 1000).toFixed(1)} km` : `${route.distanceM} m`})</span>
                )}
              </div>
            )}
            {route.reason && (
              <p className="text-[11px] leading-snug text-text-muted mt-1">
                {route.reason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Operational Reasons (FR-21) */}
      <div className="pt-2 border-t border-border space-y-1.5">
        <span className="text-xs font-semibold text-text block">
          Operational Assessment Reasons:
        </span>
        {zone.reasons && zone.reasons.length > 0 ? (
          <ul className="space-y-1 text-xs text-text-muted pl-4 list-disc">
            {zone.reasons.map((reason, idx) => (
              <li key={idx} className="leading-snug">
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-muted italic">
            None reported
          </p>
        )}
      </div>

      {/* Footer metadata */}
      <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
        <span>Last assessment update:</span>
        <span className="font-mono">{updatedDisplay}</span>
      </div>
    </div>
  );
}
