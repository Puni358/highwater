import React from 'react';
import { Polyline, Popup, Tooltip } from 'react-leaflet';
import { THEME } from '../../config/theme.js';
import { toLatLng } from './mapUtils.js';

/**
 * RouteLayer component (FR-40, FR-42, T3.5)
 * Draws evacuation routes as prominent purple solid lines.
 * Unreachable routes or routes without geometry draw nothing.
 */
export default function RouteLayer({ routes = [] }) {
  if (!routes || routes.length === 0) {
    return null;
  }

  // Filter routes that are strictly successful and have valid geometry
  const validRoutes = routes.filter((r) => {
    if (r.status !== 'OK' || !r.geometry || !r.geometry.coordinates) {
      return false;
    }
    if (r.geometry.type === 'LineString') {
      return Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length >= 2;
    }
    if (r.geometry.type === 'MultiLineString') {
      return Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length > 0 &&
        r.geometry.coordinates.every((line) => Array.isArray(line) && line.length >= 2);
    }
    return false;
  });

  if (validRoutes.length === 0) {
    return null;
  }

  const routeStyle = {
    color: THEME.colors.route,
    weight: 5,
    lineCap: 'round',
    lineJoin: 'round',
    opacity: 0.9,
  };

  return (
    <>
      {validRoutes.map((route, idx) => {
        const id = route.routeId || `route-${idx}`;
        const rawCoords = route.geometry.coordinates;
        const latLngs = route.geometry.type === 'MultiLineString'
          ? rawCoords.map((line) => line.map(toLatLng))
          : rawCoords.map(toLatLng);

        const formatDistance = (m) => {
          if (!m && m !== 0) return 'Not available';
          return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
        };

        const originLabel = route.zoneName || route.zoneId ? `${route.zoneName || route.zoneId}` : null;
        const destLabel = route.destinationName || id;

        return (
          <Polyline
            key={id}
            positions={latLngs}
            pathOptions={routeStyle}
          >
            <Tooltip sticky>
              <div className="text-xs font-sans">
                <span className="font-bold text-route">EVACUATION ROUTE</span>
                <div>{originLabel ? `${originLabel} → ` : ''}{destLabel}</div>
                {route.etaMinutes && <div>ETA: {route.etaMinutes} mins</div>}
              </div>
            </Tooltip>
            <Popup>
              <div className="text-xs font-sans p-1 min-w-[170px]">
                <div className="font-bold text-route border-b pb-1 mb-1">
                  🚗 {destLabel}
                </div>
                <div className="space-y-0.5 text-text-muted">
                  {originLabel && <div>Origin: <span className="font-semibold text-text">{originLabel}</span></div>}
                  <div>Status: <span className="font-bold text-emerald-600">CLEAR</span></div>
                  <div>Distance: <span className="font-semibold text-text">{formatDistance(route.distanceM)}</span></div>
                  {route.etaMinutes && <div>ETA: <span className="font-semibold text-text">{route.etaMinutes} mins</span></div>}
                  {route.reason && <div className="text-[11px] text-slate-500 italic mt-1 pt-1 border-t">{route.reason}</div>}
                  {route.provenance && (
                    <div className="pt-1 mt-1 border-t">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 uppercase font-semibold">
                        Provenance: {route.provenance}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </Polyline>
        );
      })}
    </>
  );
}
