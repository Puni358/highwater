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
import MapControls from './MapControls.jsx';
import { AlertTriangle, RotateCcw, PanelRightClose, PanelRightOpen, Info } from 'lucide-react';

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
  onMapReady = null,
}) {
  const map = useMap();
  const prevSelectedIdRef = useRef(null);
  const initialFitDoneRef = useRef(false);

  useEffect(() => {
    if (onMapReady) {
      onMapReady(map);
    }
  }, [map, onMapReady]);

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
 * ResetExtentControl
 * Compact, unobtrusive button positioned in Leaflet top-left control stack.
 */
function ResetExtentControl({ onReset }) {
  return (
    <div className="leaflet-top leaflet-left !top-[76px] pointer-events-auto">
      <div className="leaflet-bar leaflet-control">
        <button
          type="button"
          onClick={onReset}
          title="Reset map extent"
          aria-label="Reset map extent"
          className="flex items-center justify-center w-[30px] h-[30px] bg-white hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * FloodMap component (FR-10 to FR-19, T3.1)
 * High-performance Leaflet WebGIS surface with docked, collapsible side panel.
 * Map remains 100% unobstructed: only Zoom, Reset Extent, and Attribution sit on the map.
 * All controls, legends, notices, and provenance notes are docked in the side panel.
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
  onToggleLayer = () => {},
  onZoneSelect,
  droppedCount = 0,
  resetTrigger = 0,
  onResetExtent,
  tilesOffline: tilesOfflineProp = null,
  layerErrors: externalLayerErrors = {},
  isFromCache = false,
  cachedAt = null,
  children, // For custom/injected test layers
}) {
  const [internalReset, setInternalReset] = useState(0);
  const [layerErrors, setLayerErrors] = useState({});
  const [internalTilesOffline, setInternalTilesOffline] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const tilesOfflineRef = useRef(false);
  const mapInstanceRef = useRef(null);

  const isTilesOffline = tilesOfflineProp !== null ? tilesOfflineProp : internalTilesOffline;
  const activeReset = resetTrigger || internalReset;

  const handleResetExtent = useCallback(() => {
    if (onResetExtent) {
      onResetExtent();
    } else {
      setInternalReset((prev) => prev + 1);
    }
  }, [onResetExtent]);

  const handleMapReady = useCallback((map) => {
    mapInstanceRef.current = map;
  }, []);

  const handleTogglePanel = useCallback(() => {
    setIsPanelCollapsed((prev) => !prev);
  }, []);

  // Invalidate map size whenever panel expands/collapses or breakpoint changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.invalidateSize();
    }
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
      window.dispatchEvent(new Event('resize'));
    }, 150);
    return () => clearTimeout(timer);
  }, [isPanelCollapsed]);

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
    <div className="flex flex-col lg:flex-row w-full h-full min-h-[440px] overflow-hidden font-sans bg-card relative">
      {/* 1. Unobstructed Leaflet Map Viewport */}
      <div className="relative flex-1 h-[420px] lg:h-full w-full min-w-0 overflow-hidden bg-slate-200">
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
            onMapReady={handleMapReady}
          />

          {/* Reset Extent Button Control directly on map (unobtrusive under zoom controls) */}
          <ResetExtentControl onReset={handleResetExtent} />

          {/* 1. Flood Extent Layer */}
          {visibleLayers.flood && (
            <LayerErrorBoundary
              layerName="flood"
              onError={(err) => handleLayerError('flood', err)}
            >
              <FloodLayer data={floodGeoJSON} />
            </LayerErrorBoundary>
          )}

          {/* 2. Priority Risk Zones Layer */}
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

          {/* 3. Blocked Roadways Layer */}
          {visibleLayers.roads && (
            <LayerErrorBoundary
              layerName="roads"
              onError={(err) => handleLayerError('roads', err)}
            >
              <RoadLayer data={blockedRoads} />
            </LayerErrorBoundary>
          )}

          {/* 4. Facilities Layer */}
          {visibleLayers.facilities && (
            <LayerErrorBoundary
              layerName="facilities"
              onError={(err) => handleLayerError('facilities', err)}
            >
              <FacilityLayer data={facilities} />
            </LayerErrorBoundary>
          )}

          {/* 5. Routes Layer */}
          {visibleLayers.routes && (
            <LayerErrorBoundary
              layerName="routes"
              onError={(err) => handleLayerError('routes', err)}
            >
              <RouteLayer routes={routes} />
            </LayerErrorBoundary>
          )}

          {/* 6. Exposed Buildings Layer */}
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
      </div>

      {/* 2. Docked Side Panel (Beside map on desktop, below on mobile/tablet) */}
      <aside
        aria-label="Map Controls and Legend Side Panel"
        className={`border-t lg:border-t-0 lg:border-l border-border bg-slate-50/90 flex flex-col transition-all duration-200 z-10 shrink-0 ${
          isPanelCollapsed ? 'lg:w-12 w-full' : 'lg:w-80 w-full'
        }`}
      >
        {/* Panel Collapsible Header */}
        <div className="p-2 sm:p-2.5 border-b border-border bg-white flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handleTogglePanel}
            aria-expanded={!isPanelCollapsed}
            aria-controls="map-side-panel-content"
            className="min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-slate-700 hover:text-navy-900 flex items-center justify-between rounded border border-border bg-white hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-flood transition cursor-pointer select-none"
          >
            <div className="flex items-center space-x-2">
              {isPanelCollapsed ? (
                <>
                  <PanelRightOpen className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
                  <span className="lg:hidden font-medium">Expand Side Panel</span>
                </>
              ) : (
                <>
                  <PanelRightClose className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
                  <span className="font-medium">Collapse Side Panel</span>
                </>
              )}
            </div>
            {!isPanelCollapsed && (
              <span className="text-[11px] text-slate-500 font-normal hidden sm:inline ml-2">
                Unobstruct Map
              </span>
            )}
          </button>
          {!isPanelCollapsed && (
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider hidden sm:inline">
              Layers & Legend
            </span>
          )}
        </div>

        {/* Panel Content (Visible when expanded) */}
        {!isPanelCollapsed && (
          <div
            id="map-side-panel-content"
            className="p-3 overflow-y-auto space-y-3 flex-1 text-xs max-h-[480px] lg:max-h-full"
          >
            {/* Offline Base Map Tiles Warning Notice */}
            {isTilesOffline && (
              <div
                role="alert"
                className="p-2.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start space-x-2 shadow-sm"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Map tiles unavailable. Base map tiles unreachable; vector flood overlays continue to operate offline.
                </span>
              </div>
            )}

            {/* Offline Cached Data Notice */}
            {isFromCache && (
              <div
                role="status"
                className="p-2.5 rounded bg-sky-50 border border-sky-300 text-sky-900 text-xs flex items-start space-x-2 shadow-sm"
              >
                <Info className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                <span>Offline cached snapshot loaded {cachedAt ? `from ${cachedAt}` : ''}.</span>
              </div>
            )}

            {/* Malformed Geometry Warning Notice */}
            {droppedCount > 0 && (
              <div
                role="status"
                className="p-2 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[11px] shadow-sm flex items-center space-x-1.5"
              >
                <span className="font-bold">Notice:</span>
                <span>{droppedCount} malformed features skipped during geometry verification.</span>
              </div>
            )}

            {/* Layer Error Notice */}
            {Object.keys(combinedLayerErrors).length > 0 && (
              <div
                role="alert"
                aria-label="Layer Error Notice"
                className="p-2 rounded bg-red-50 border border-red-300 text-risk-high text-[11px] shadow-sm flex items-center space-x-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Overlay error: {Object.entries(combinedLayerErrors).map(([k, msg]) => `${k} layer (${msg})`).join(', ')}. Base map and other layers operational.
                </span>
              </div>
            )}

            {/* Layer Controls Switch Panel */}
            <MapControls
              visibleLayers={visibleLayers}
              onToggleLayer={onToggleLayer}
              onResetExtent={handleResetExtent}
            />

            {/* Dynamic Map Legend */}
            <MapLegend visibleLayers={visibleLayers} />

            {/* Provenance & Data Notes */}
            <div className="p-2.5 rounded bg-white border border-border text-[11px] text-text-muted space-y-1 shadow-sm">
              <div className="font-semibold text-text">Data Notes & Provenance</div>
              <p>
                Overlays indicate observed, derived, or simulated emergency response data. Zoom or click features on the map to inspect properties.
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
