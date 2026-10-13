import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, DEFAULT_AOI_BOUNDS, toLatLng } from '../features/map/mapUtils.js';
import FloodLayer from '../features/map/FloodLayer.jsx';
import RiskLayer from '../features/map/RiskLayer.jsx';
import FacilityLayer from '../features/map/FacilityLayer.jsx';
import RoadLayer from '../features/map/RoadLayer.jsx';
import RouteLayer from '../features/map/RouteLayer.jsx';
import LayerErrorBoundary from '../features/map/LayerErrorBoundary.jsx';
import MapLegend from './MapLegend.jsx';
import { AlertTriangle } from 'lucide-react';

/**
 * MapController
 * Inner hook manager for Leaflet map instance.
 * Handles resize invalidation, selection fly-to, and reset-extent without resetting on layer toggle.
 */
function MapController({
  selectedZoneId,
  zones,
  resetTrigger,
}) {
  const map = useMap();
  const prevSelectedIdRef = useRef(null);

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

  // Reset extent handler (FR-15)
  useEffect(() => {
    if (resetTrigger > 0) {
      map.flyToBounds(DEFAULT_AOI_BOUNDS, { duration: 1 });
    }
  }, [resetTrigger, map]);

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
 * High-performance Leaflet WebGIS surface with 5 isolated overlay layers.
 */
export default function FloodMap({
  floodGeoJSON = null,
  riskZones = [],
  blockedRoads = null,
  facilities = null,
  routes = [],
  selectedZoneId = null,
  visibleLayers = { flood: true, risk: true, roads: true, facilities: true, routes: false },
  onZoneSelect,
  droppedCount = 0,
}) {
  const [resetTrigger, setResetTrigger] = useState(0);
  const [layerErrors, setLayerErrors] = useState({});
  const [tilesOffline, setTilesOffline] = useState(false);

  const tileUrl = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution = import.meta.env.VITE_TILE_ATTRIBUTION || '© OpenStreetMap contributors';

  const handleResetExtent = useCallback(() => {
    setResetTrigger((prev) => prev + 1);
  }, []);

  const handleLayerError = useCallback((layerKey, err) => {
    setLayerErrors((prev) => ({ ...prev, [layerKey]: err.message || 'Rendering failed' }));
  }, []);

  return (
    <div className="relative w-full h-full min-h-[380px] flex-1 overflow-hidden font-sans">
      {/* Offline Tiles Warning Notice (Section 5 Non-functional requirements) */}
      {tilesOffline && (
        <div
          role="alert"
          className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-100 border border-amber-300 text-amber-900 px-3 py-1.5 rounded-card text-xs flex items-center space-x-2 shadow"
        >
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>Base map tiles unreachable. Vector flood overlays continue to operate offline.</span>
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
            tileerror: () => setTilesOffline(true),
          }}
        />

        <MapController
          selectedZoneId={selectedZoneId}
          zones={riskZones}
          resetTrigger={resetTrigger}
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
      </MapContainer>

      {/* Floating Dynamic Legend (bottom-right on map) */}
      <div className="absolute bottom-4 right-4 z-[999] pointer-events-auto">
        <MapLegend visibleLayers={visibleLayers} />
      </div>
    </div>
  );
}
