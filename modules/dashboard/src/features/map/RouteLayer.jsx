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

  // Filter routes that have valid geometry and are not unreachable or cut off
  const validRoutes = routes.filter((r) => {
    if (r.status === 'UNREACHABLE' || r.status === 'NO_ROAD_ROUTE' || !r.geometry || !r.geometry.coordinates) {
      return false;
    }
    return Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length >= 2;
  });

  if (validRoutes.length === 0) {
    return null;
  }

  return (
    <>
      {validRoutes.map((route, idx) => {
        const id = route.routeId || `route-${idx}`;
        const rawCoords = route.geometry.coordinates;
        const latLngs = rawCoords.map(toLatLng);

        const isAir = route.geometryQuality === 'AIR_LINE' || route.corridorType === 'AIR_LINE' || route.vehicleType === 'HELICOPTER';
        const isWater = route.geometryQuality === 'WATER_LINE' || route.corridorType === 'WATER_LINE' || route.vehicleType === 'RESCUE_BOAT';
        const isAirOrBoat = isAir || isWater;

        const routeStyle = isAirOrBoat
          ? {
              color: isWater ? '#06b6d4' : '#8b5cf6',
              weight: 3.5,
              dashArray: '6, 8',
              lineCap: 'round',
              lineJoin: 'round',
              opacity: 0.85,
            }
          : {
              color: THEME.colors.route,
              weight: 5,
              lineCap: 'round',
              lineJoin: 'round',
              opacity: 0.9,
            };

        const formatDistance = (m) => {
          if (!m && m !== 0) return 'Not available';
          return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
        };

        const headerTitle = isAir
          ? '🚁 Air line, not a road route'
          : isWater
          ? '🚤 Boat line, not a road route'
          : '🚗 Lowest-risk route (model)';

        return (
          <Polyline
            key={id}
            positions={latLngs}
            pathOptions={routeStyle}
          >
            <Tooltip sticky>
              <div className="text-xs font-sans">
                <span className={`font-bold ${isAirOrBoat ? 'text-purple-700' : 'text-route'}`}>
                  {isAirOrBoat ? 'AIR/BOAT LINE (NOT ROAD ROUTE)' : 'LOWEST-RISK ROUTE (MODEL)'}
                </span>
                <div>{route.destinationName || id}</div>
                {route.etaMinutes && <div>ETA: {route.etaMinutes} mins</div>}
              </div>
            </Tooltip>
            <Popup>
              <div className="text-xs font-sans p-1 min-w-[190px]">
                <div className={`font-bold ${isAirOrBoat ? 'text-purple-700' : 'text-route'} border-b pb-1 mb-1`}>
                  {headerTitle}
                </div>
                <div className="space-y-0.5 text-text-muted">
                  <div>Destination: <span className="font-semibold text-text">{route.destinationName || id}</span></div>
                  <div>Mode / Vehicle: <span className="font-semibold text-text">{route.vehicleType || 'AMBULANCE'}</span></div>
                  <div>Distance / Length: <span className="font-semibold text-text">{formatDistance(route.distanceM)}</span></div>
                  {route.etaMinutes && <div>ETA: <span className="font-semibold text-text">{route.etaMinutes} mins</span></div>}
                  {route.uncertainSegments !== undefined && (
                    <div>UNCERTAIN segments: <span className="font-semibold text-text">{route.uncertainSegments}</span></div>
                  )}
                  {route.maxWaterDepthM !== undefined && (
                    <div>Max water depth: <span className="font-semibold text-text">{route.maxWaterDepthM} m</span></div>
                  )}
                  {route.dataAgeHours !== undefined && route.dataAgeHours !== null && (
                    <div>Data age: <span className="font-semibold text-text">{route.dataAgeHours}h</span></div>
                  )}
                  {route.fallbackReason && (
                    <div className="pt-1 mt-1 border-t text-amber-700 font-medium">
                      Notice: {route.fallbackReason}
                    </div>
                  )}
                  {isAirOrBoat && (
                    <div className="pt-1 mt-1 border-t text-purple-700 font-semibold italic text-[11px]">
                      Air/boat line, not a road route
                    </div>
                  )}
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
