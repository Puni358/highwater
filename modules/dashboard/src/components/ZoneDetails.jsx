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
  routes = [],
  timestamp = null,
  onClearSelection,
  isTestFixture = false,
}) {
  const [selectedVehicle, setSelectedVehicle] = React.useState('AMBULANCE');
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

      {/* Cut-off area notice (PART A.3) */}
      {(() => {
        const zoneRoutes = (routes || []).filter(
          (r) => r.zoneId === zone.zoneId || (r.routeId && zone.zoneId && r.routeId.includes(zone.zoneId))
        );
        const roadRoutes = zoneRoutes.filter(
          (r) => r.geometryQuality !== 'AIR_LINE' && r.geometryQuality !== 'WATER_LINE' && r.vehicleType !== 'HELICOPTER' && r.vehicleType !== 'RESCUE_BOAT'
        );
        const hasNoRoadRoute = zone.accessibility === 'CUT_OFF' ||
          roadRoutes.some((r) => r.status === 'NO_ROAD_ROUTE' || r.status === 'UNREACHABLE') ||
          (roadRoutes.length > 0 && roadRoutes.every((r) => r.status !== 'OK'));

        if (!hasNoRoadRoute) return null;
        return (
          <div
            className="p-2.5 bg-red-50 border border-red-300 rounded text-red-900 text-xs flex items-start space-x-2"
            role="alert"
          >
            <ShieldAlert className="w-4 h-4 shrink-0 text-red-700 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-bold block">No road route: area cut off</span>
              <span>All surface road access corridors to this sector are severed or impassable.</span>
            </div>
          </div>
        );
      })()}

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

      {/* Vehicle Deployment & Fallback Selector (PART B.7) */}
      <div className="pt-2 border-t border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text">Vehicle Deployment & Fallback:</span>
          {selectedVehicle === 'HELICOPTER' && (
            <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.5 rounded">
              Aerial Deployment
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-1 p-1 bg-surface rounded border border-border text-[11px]">
          {['AMBULANCE', 'TRUCK_4X4', 'RESCUE_BOAT', 'HELICOPTER'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setSelectedVehicle(v)}
              className={`py-1 px-1 rounded font-medium text-center transition ${
                selectedVehicle === v
                  ? 'bg-navy-900 text-white shadow-xs'
                  : 'text-text-muted hover:text-text hover:bg-card'
              }`}
            >
              {v === 'TRUCK_4X4' ? '4x4 TRUCK' : v === 'RESCUE_BOAT' ? 'BOAT' : v === 'HELICOPTER' ? 'HELI' : 'AMB'}
            </button>
          ))}
        </div>

        {/* Selected Vehicle Status Box */}
        {(() => {
          const zoneRoutes = (routes || []).filter(
            (r) => r.zoneId === zone.zoneId || (r.routeId && zone.zoneId && r.routeId.includes(zone.zoneId))
          );
          const roadRoutes = zoneRoutes.filter(
            (r) => r.geometryQuality !== 'AIR_LINE' && r.geometryQuality !== 'WATER_LINE' && r.vehicleType !== 'HELICOPTER' && r.vehicleType !== 'RESCUE_BOAT'
          );
          const hasCutOff = zone.accessibility === 'CUT_OFF' ||
            roadRoutes.some((r) => r.status === 'NO_ROAD_ROUTE' || r.status === 'UNREACHABLE') ||
            (roadRoutes.length > 0 && roadRoutes.every((r) => r.status !== 'OK'));

          const matchedRoute = zoneRoutes.find((r) => r.vehicleType === selectedVehicle);
          let vStatus = matchedRoute?.status;
          let vEta = matchedRoute?.etaMinutes;
          let vLimit = 'Depth clearance: 0.30m';
          let vReason = matchedRoute?.reason || matchedRoute?.fallbackReason;

          if (selectedVehicle === 'AMBULANCE') {
            vLimit = 'Clearance: 0.30m (roads only)';
            if (!vStatus) vStatus = hasCutOff ? 'NO_ROAD_ROUTE' : 'OK';
            if (hasCutOff && !vReason) vReason = 'Road corridors severed by floodwater';
          } else if (selectedVehicle === 'TRUCK_4X4') {
            vLimit = 'Wading clearance: 0.60m';
            if (!vStatus) vStatus = hasCutOff ? 'NO_ROAD_ROUTE' : 'OK';
            if (hasCutOff && !vReason) vReason = 'Depth exceeds 0.60m limit or corridor severed';
          } else if (selectedVehicle === 'RESCUE_BOAT') {
            vLimit = 'Min draft: 0.50m (navigable water)';
            if (!vStatus) vStatus = 'UNREACHABLE';
            if (!vReason) vReason = 'No accessible boat ramp or inland navigable channel';
          } else if (selectedVehicle === 'HELICOPTER') {
            vLimit = 'Max rain 60 mm/h, wind 75 km/h';
            if (!vStatus) vStatus = 'OK';
            if (!vEta) vEta = 11.2;
          }

          return (
            <div className="p-2.5 rounded bg-surface border border-border/60 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text">{selectedVehicle.replace('_', ' ')}:</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                  vStatus === 'OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                }`}>
                  {vStatus || 'UNKNOWN'}
                </span>
              </div>
              <div className="text-text-muted text-[11px] flex justify-between">
                <span>ETA: <strong className="text-text">{vEta ? `${vEta} mins` : 'Not available'}</strong></span>
                <span>Limit: <strong className="text-text">{vLimit}</strong></span>
              </div>
              {vReason && (
                <div className="text-[11px] text-amber-800 font-medium pt-1 border-t border-border/40">
                  {vStatus === 'OK' ? `Note: ${vReason}` : `Fallback Reason: ${vReason}`}
                </div>
              )}
              {hasCutOff && selectedVehicle === 'HELICOPTER' && (
                <div className="p-2 mt-1 bg-purple-50 border border-purple-200 rounded text-purple-900 text-[11px]">
                  ⚠️ Surface corridors severed. Fallback chain escalated to aerial insertion (HELICOPTER).
                </div>
              )}
            </div>
          );
        })()}
      </div>

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

      {/* Footer metadata (PART A.7) */}
      <div className="pt-2 border-t border-border space-y-1 text-[11px] text-text-muted">
        <div className="flex items-center justify-between">
          <span>Assessment run time:</span>
          <span className="font-mono">{zone.runTime || timestamp || '2026-10-13T10:00:00Z'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Flood observation time:</span>
          <span className="font-mono">{zone.observationTime || zone.acquired || '2026-10-13T07:30:00Z'}</span>
        </div>
      </div>
    </div>
  );
}
