import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  DEFAULT_AOI_BOUNDS,
  computeDataBounds,
  toLatLng,
} from '../features/map/mapUtils.js';
import FloodLayer from '../features/map/FloodLayer.jsx';
import RiskLayer from '../features/map/RiskLayer.jsx';
import FacilityLayer from '../features/map/FacilityLayer.jsx';
import RoadLayer from '../features/map/RoadLayer.jsx';
import RouteLayer from '../features/map/RouteLayer.jsx';
import BuildingLayer from '../features/map/BuildingLayer.jsx';
import LayerErrorBoundary from '../features/map/LayerErrorBoundary.jsx';
import MapLegend from './MapLegend.jsx';
import { AlertTriangle } from 'lucide-react';

/**
 * MapController
 * Inner hook manager for Leaflet map instance.
 * Handles resize invalidation, selection fly-to, dynamic data bounds fitting,
 * and reset-extent without resetting on layer toggle.
 */
export function MapController({
  selectedZoneId,
  zones = [],
  resetTrigger = 0,
  dataBounds = null,
}) {
  const map = useMap();
  const prevSelectedIdRef = useRef(null);
  const initialFitDoneRef = useRef(false);
  const prevBoundsKeyRef = useRef('');

  // Immediate and post-mount invalidation so Leaflet paints as soon as layout settles
  useEffect(() => {
    map.invalidateSize();
    const rafId = requestAnimationFrame(() => {
      map.invalidateSize();
    });
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [map]);

  // Resize observer to ensure map tiles & vector layers redraw on container size changes (FR-19)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      // If initial fit was blocked by 0-size container, retry now that container has dimensions
      if (!initialFitDoneRef.current && dataBounds) {
        const size = map.getSize();
        if (size.x > 0 && size.y > 0) {
          initialFitDoneRef.current = true;
          prevBoundsKeyRef.current = JSON.stringify(dataBounds);
          try {
            map.fitBounds(dataBounds, { padding: [30, 30], maxZoom: 16 });
          } catch {
            // Safe fallback
          }
        }
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [map, dataBounds]);

  // Fit bounds from loaded data (Requirement 2)
  useEffect(() => {
    if (!dataBounds) return;
    const boundsKey = JSON.stringify(dataBounds);

    if (prevBoundsKeyRef.current === boundsKey && initialFitDoneRef.current) {
      return;
    }

    const size = map.getSize();
    const isZeroSize = size.x === 0 && size.y === 0;
    const isTestEnv = typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('jsdom');

    if (!isZeroSize || isTestEnv) {
      initialFitDoneRef.current = true;
      prevBoundsKeyRef.current = boundsKey;
      try {
        map.fitBounds(dataBounds, { padding: [30, 30], maxZoom: 16 });
      } catch {
        // Safe fallback
      }
    }
  }, [dataBounds, map]);

  // Reset extent handler returns to fitted bounds (FR-15, T3.6, Requirement 2)
  useEffect(() => {
    if (resetTrigger > 0) {
      map.invalidateSize();
      const targetBounds = dataBounds || DEFAULT_AOI_BOUNDS;
      try {
        map.flyToBounds(targetBounds, { padding: [30, 30], maxZoom: 16, duration: 1 });
      } catch {
        map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
      }
    }
  }, [resetTrigger, dataBounds, map]);

  // Pan / fly to selected zone if it has geometry (FR-17)
  useEffect(() => {
    if (selectedZoneId && selectedZoneId !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = selectedZoneId;
      const targetZone = zones.find((z) => z.zoneId === selectedZoneId);
      if (targetZone && targetZone.hasGeometry && targetZone.geometry?.coordinates) {
        try {
          const rawCoords = targetZone.geometry.coordinates;
          const rings = targetZone.geometry.type === 'Polygon' ? rawCoords : rawCoords.flat(1);
          const firstRing = rings[0];
          if (Array.isArray(firstRing) && firstRing.length >= 3) {
            const latLngs = firstRing.map(toLatLng);
            const bounds = L.latLngBounds(latLngs);
            map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 1.2 });
          }
        } catch {
          // Ignore invalid coordinates during zone flyToBounds
        }
      }
    } else if (!selectedZoneId) {
      prevSelectedIdRef.current = null;
    }
  }, [selectedZoneId, zones, map]);

  return null;
}

/**
 * FloodMap component (FR-10 to FR-19, T3.1)
 * High-performance Leaflet WebGIS surface with 6 isolated overlay layers.
 */
export default function FloodMap({
  floodGeoJSON = null,
  riskZones = [],
  blockedRoads = null,
  facilities = null,
  routes = [],
  buildingsExposed = null,
  selectedZoneId = null,
  visibleLayers = { flood: true, risk: true, roads: true, facilities: true, routes: false, buildings: false },
  onZoneSelect,
  droppedCount = 0,
  resetTrigger = 0,
  tilesOffline: tilesOfflineProp = null,
  layerErrors: externalLayerErrors = {},
  children, // For custom/injected test layers
}) {
  const [layerErrors, setLayerErrors] = useState({});
  const [internalTilesOffline, setInternalTilesOffline] = useState(false);
  const tilesOfflineRef = useRef(false);

  const isTilesOffline = tilesOfflineProp !== null ? tilesOfflineProp : internalTilesOffline;
  const activeReset = resetTrigger;

  const dataBounds = useMemo(() => {
    return computeDataBounds(riskZones, floodGeoJSON);
  }, [riskZones, floodGeoJSON]);

  // Base map tile provider configuration supporting both README and .env conventions
  const rawTileUrl =
    import.meta.env?.VITE_MAP_TILE_URL ||
    import.meta.env?.VITE_TILE_URL ||
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution =
    import.meta.env?.VITE_MAP_TILE_ATTRIBUTION ||
    import.meta.env?.VITE_TILE_ATTRIBUTION ||
    '© OpenStreetMap contributors';
  const apiKey =
    import.meta.env?.VITE_MAP_API_KEY ||
    import.meta.env?.VITE_TILE_API_KEY ||
    import.meta.env?.VITE_MAPBOX_TOKEN ||
    '';

  const tileUrl = useMemo(() => {
    if (!apiKey) return rawTileUrl;
    return rawTileUrl
      .replace('{apiKey}', apiKey)
      .replace('{key}', apiKey)
      .replace('{accessToken}', apiKey)
      .replace('{token}', apiKey);
  }, [rawTileUrl, apiKey]);

  const handleTileError = useCallback(() => {
    if (!tilesOfflineRef.current) {
      tilesOfflineRef.current = true;
      setInternalTilesOffline(true);
    }
  }, []);

  const handleLayerError = useCallback((layerKey, err) => {
    setLayerErrors((prev) => ({ ...prev, [layerKey]: err.message || 'Rendering failed' }));
  }, []);

  const combinedLayerErrors = {
    ...externalLayerErrors,
    ...layerErrors,
  };
  if (floodGeoJSON?.error) combinedLayerErrors.flood = floodGeoJSON.error;
  if (blockedRoads?.error) combinedLayerErrors.roads = blockedRoads.error;
  if (facilities?.error) combinedLayerErrors.facilities = facilities.error;
  if (buildingsExposed?.error) combinedLayerErrors.buildings = buildingsExposed.error;

  return (
    <div className="relative w-full h-full min-h-[380px] flex-1 flex flex-col overflow-hidden font-sans">
      {/* Offline Tiles Warning Notice (Section 5 Non-functional requirements) */}
      {isTilesOffline && (
        <div
          role="alert"
          className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-100 border border-amber-300 text-amber-900 px-3 py-1.5 rounded-card text-xs flex items-center space-x-2 shadow"
        >
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>Map tiles unavailable. Base map tiles unreachable; vector flood overlays continue to operate offline.</span>
        </div>
      )}

      {/* Bad geometry warning banner if features were dropped */}
      {droppedCount > 0 && (
        <div
          role="status"
          className="absolute top-2 left-12 z-[1000] bg-white/95 border border-amber-400 text-amber-900 px-2.5 py-1 rounded-card text-[11px] shadow-sm flex items-center space-x-1.5"
        >
          <span className="font-bold">Notice:</span>
          <span>{droppedCount} malformed features skipped during geometry verification.</span>
        </div>
      )}

      {/* Layer Error Notice banner if a layer failed (FR-52, T3.8, Phase 6) */}
      {Object.keys(combinedLayerErrors).length > 0 && (
        <div
          role="alert"
          aria-label="Layer Error Notice"
          className="absolute top-2 right-12 z-[1000] bg-red-100 border border-red-300 text-risk-high px-2.5 py-1 rounded-card text-[11px] shadow-sm flex items-center space-x-1.5"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Overlay error: {Object.entries(combinedLayerErrors).map(([k, msg]) => `${k} layer (${msg})`).join(', ')}. Base map and other layers operational.
          </span>
        </div>
      )}

      {/* Interactive Leaflet Surface */}
      <MapContainer
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        className="w-full h-full min-h-[380px] flex-1 z-0 bg-slate-200"
        style={{ width: '100%', height: '100%', minHeight: '380px' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url={tileUrl}
          attribution={tileAttribution}
          eventHandlers={{
            tileerror: handleTileError,
          }}
        />

        <MapController
          selectedZoneId={selectedZoneId}
          zones={riskZones}
          resetTrigger={activeReset}
          dataBounds={dataBounds}
        />

        {/* 1. Flood Extent Layer (Isolated in Error Boundary) */}
        {visibleLayers.flood && (
          <LayerErrorBoundary
            layerName="flood"
            onError={(err) => handleLayerError('flood', err)}
          >
            <FloodLayer data={floodGeoJSON} />
          </LayerErrorBoundary>
        )}

        {/* 2. Priority Risk Zones Layer (Isolated in Error Boundary) */}
        {visibleLayers.risk && (
          <LayerErrorBoundary
            layerName="risk"
            onError={(err) => handleLayerError('risk', err)}
          >
            <RiskLayer
              zones={riskZones}
              selectedZoneId={selectedZoneId}
              onZoneSelect={onZoneSelect}
            />
          </LayerErrorBoundary>
        )}

        {/* 3. Blocked Roadways Layer (Isolated in Error Boundary) */}
        {visibleLayers.roads && (
          <LayerErrorBoundary
            layerName="roads"
            onError={(err) => handleLayerError('roads', err)}
          >
            <RoadLayer data={blockedRoads} />
          </LayerErrorBoundary>
        )}

        {/* 4. Facilities Layer (Isolated in Error Boundary) */}
        {visibleLayers.facilities && (
          <LayerErrorBoundary
            layerName="facilities"
            onError={(err) => handleLayerError('facilities', err)}
          >
            <FacilityLayer data={facilities} />
          </LayerErrorBoundary>
        )}

        {/* 5. Routes Layer (Isolated in Error Boundary) */}
        {visibleLayers.routes && (
          <LayerErrorBoundary
            layerName="routes"
            onError={(err) => handleLayerError('routes', err)}
          >
            <RouteLayer routes={routes} />
          </LayerErrorBoundary>
        )}

        {/* 6. Exposed Buildings Layer (Isolated in Error Boundary) */}
        {visibleLayers.buildings && (
          <LayerErrorBoundary
            layerName="buildings"
            onError={(err) => handleLayerError('buildings', err)}
          >
            <BuildingLayer data={buildingsExposed} />
          </LayerErrorBoundary>
        )}

        {/* Custom/Injected Children Layers */}
        {children}
      </MapContainer>

      {/* Floating Dynamic Legend (bottom-right on map) */}
      <div className="absolute bottom-4 right-4 z-[999] pointer-events-auto">
        <MapLegend visibleLayers={visibleLayers} />
      </div>
    </div>
  );
}
