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

  // Resize observer to ensure map tiles & vector layers redraw on container size changes (FR-19)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [map]);

  // Fit bounds from loaded data (Requirement 2)
  useEffect(() => {
    if (dataBounds && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true;
      map.fitBounds(dataBounds, { padding: [30, 30] });
    }
  }, [dataBounds, map]);

  // Reset extent handler returns to fitted bounds (FR-15, T3.6, Requirement 2)
  useEffect(() => {
    if (resetTrigger > 0) {
      map.flyToBounds(dataBounds || DEFAULT_AOI_BOUNDS, { duration: 1 });
    }
  }, [resetTrigger, dataBounds, map]);

  // Pan / fly to selected zone if it has geometry (FR-17)
  useEffect(() => {
    if (selectedZoneId && selectedZoneId !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = selectedZoneId;
      const targetZone = zones.find((z) => z.zoneId === selectedZoneId);
      if (targetZone && targetZone.hasGeometry && targetZone.geometry?.coordinates) {
        const ring = targetZone.geometry.coordinates[0];
        const latLngs = ring.map(toLatLng);
        const bounds = L.latLngBounds(latLngs);
        map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 1.2 });
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
  const [internalReset, setInternalReset] = useState(0);
  const [layerErrors, setLayerErrors] = useState({});
  const [internalTilesOffline, setInternalTilesOffline] = useState(false);
  const tilesOfflineRef = useRef(false);

  const isTilesOffline = tilesOfflineProp !== null ? tilesOfflineProp : internalTilesOffline;
  const activeReset = resetTrigger || internalReset;

  const dataBounds = useMemo(() => {
    return computeDataBounds(riskZones, floodGeoJSON);
  }, [riskZones, floodGeoJSON]);

  const tileUrl = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution = import.meta.env.VITE_TILE_ATTRIBUTION || '© OpenStreetMap contributors';

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
    <div className="relative w-full h-full min-h-[380px] flex-1 overflow-hidden font-sans">
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
        className="w-full h-full z-0 bg-slate-200"
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
