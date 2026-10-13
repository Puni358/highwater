# Chapter 03: Map Navigation Controls & Dynamic Legends

---

### 3.1 Map Navigation Architecture

Disaster commanders and field responders operate under high stress. Map navigation must be predictable, responsive, and provide immediate situational awareness without disorienting camera jumps.

Key navigation requirements:
1. **Independent Layer Visibility:** Users must be able to isolate individual GIS overlays (e.g., viewing only blocked roads and rescue centers without flood polygon occlusion).
2. **View Persistence:** Toggling a layer must never alter or reset the current camera zoom level or center coordinates.
3. **Extent Reset Control:** One-click reset to automatically compute the bounding box of the active disaster scenario and smoothly frame all relevant features.
4. **Dynamic Contextual Legend:** The legend must strictly reflect only currently visible overlays to eliminate cognitive clutter.

---

### 3.2 Layer Visibility State Model

Layer toggling state lives at the dashboard or map container level:

```javascript
export const DEFAULT_LAYER_VISIBILITY = {
  flood: true,       // Flood Inundation Extent
  risk: true,        // Risk Priority Zones
  roads: true,       // Blocked Road Segments
  facilities: true,  // Shelters & Staging Areas
  routes: true,      // Evacuation Corridors
};
```

When a user toggles an overlay, only that specific React Leaflet sub-tree is mounted/unmounted. The underlying Leaflet `MapContainer` instance remains completely untouched.

---

### 3.3 Dynamic Layer Legend Component (`src/components/map/MapLegend.jsx`)

The legend dynamically renders swatches based on the `visibleLayers` configuration:

```jsx
import React from 'react';
import { THEME } from '@/config/theme';

export function MapLegend({ visibleLayers, isCollapsed, onToggleCollapse }) {
  // If no layers are visible, legend displays a concise hint
  const anyVisible = Object.values(visibleLayers).some(Boolean);

  return (
    <div className="absolute bottom-6 right-4 z-[1000] bg-white/95 backdrop-blur-md rounded-lg shadow-lg border border-slate-200 text-xs w-64 transition-all duration-200">
      <div 
        className="flex items-center justify-between p-2.5 cursor-pointer border-b border-slate-100 hover:bg-slate-50 select-none"
        onClick={onToggleCollapse}
      >
        <span className="font-semibold text-slate-800 tracking-wide uppercase text-[10px]">Active Map Layers</span>
        <span className="text-slate-400 text-xs">{isCollapsed ? '▲ Expand' : '▼ Collapse'}</span>
      </div>

      {!isCollapsed && (
        <div className="p-3 space-y-2.5 max-h-72 overflow-y-auto">
          {!anyVisible && (
            <p className="text-slate-400 italic text-center py-2">All overlays are currently hidden</p>
          )}

          {/* Risk Zones Swatches */}
          {visibleLayers.risk && (
            <div className="space-y-1">
              <span className="font-medium text-slate-700 block text-[11px]">Risk Priority Zones</span>
              <div className="grid grid-cols-2 gap-1.5 pl-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded border border-red-600 bg-red-500/30" />
                  <span className="text-slate-600">High Risk</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded border border-amber-600 bg-amber-500/30" />
                  <span className="text-slate-600">Medium</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded border border-green-600 bg-green-500/30" />
                  <span className="text-slate-600">Low Risk</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded border border-dashed border-slate-500 bg-slate-400/30" />
                  <span className="text-slate-600">Unknown</span>
                </div>
              </div>
            </div>
          )}

          {/* Flood Extent Swatch */}
          {visibleLayers.flood && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <span className="w-4 h-3.5 rounded border border-blue-600 bg-blue-500/40" />
              <span className="text-slate-700 font-medium">Inundated Water Extent</span>
            </div>
          )}

          {/* Blocked Road Swatch */}
          {visibleLayers.roads && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-red-600" />
              <span className="text-slate-700 font-medium">Blocked Roadways</span>
            </div>
          )}

          {/* Rescue Facilities Swatch */}
          {visibleLayers.facilities && (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-violet-600 border border-white shadow-sm flex items-center justify-center text-[8px] text-white font-bold">+</span>
              <span className="text-slate-700 font-medium">Rescue Staging & Shelters</span>
            </div>
          )}

          {/* Evacuation Route Swatch */}
          {visibleLayers.routes && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-1 rounded bg-emerald-600" />
              <span className="text-slate-700 font-medium">Active Evacuation Route</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### 3.4 Extent Reset & Bounding Box Engine (`ResetExtentControl.jsx`)

When data loads or after a user has zoomed in on a specific street corner, they need to quickly snap back to the full study area.

The extent calculator scans all polygon rings and points, constructs a unified `L.latLngBounds`, and executes an animated transition:

```jsx
import React from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { Maximize2 } from 'lucide-react';

export function ResetExtentControl({ zonesGeoJson, defaultBounds }) {
  const map = useMap();

  const handleReset = () => {
    if (zonesGeoJson?.features?.length) {
      try {
        const geoJsonLayer = L.geoJSON(zonesGeoJson);
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          map.flyToBounds(bounds, {
            padding: [30, 30],
            duration: 1.0,
            easeLinearity: 0.25,
          });
          return;
        }
      } catch (err) {
        console.warn('Failed to calculate dynamic bounds, using default:', err);
      }
    }

    // Fallback to configured default boundary
    if (defaultBounds) {
      map.flyToBounds(defaultBounds, { padding: [20, 20], duration: 1.0 });
    }
  };

  return (
    <div className="leaflet-top leaflet-left !mt-24 !ml-3 z-[1000]">
      <button
        onClick={handleReset}
        title="Reset map to full extent"
        aria-label="Reset map extent"
        className="bg-white hover:bg-slate-50 text-slate-700 p-2 rounded-md shadow-md border border-slate-200 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
    </div>
  );
}
```

---

### 3.5 Floating Layer Toggle Bar (`LayerControls.jsx`)

Placed cleanly at the top of the map view, this pill-style control panel lets users toggle individual datasets with visual badges:

```jsx
import React from 'react';
import { Waves, AlertTriangle, ShieldAlert, Home, Navigation } from 'lucide-react';

export function LayerControls({ visibleLayers, onToggleLayer }) {
  const controls = [
    { key: 'flood', label: 'Flood', icon: Waves, activeColor: 'bg-blue-600 text-white' },
    { key: 'risk', label: 'Risk Zones', icon: AlertTriangle, activeColor: 'bg-amber-600 text-white' },
    { key: 'roads', label: 'Road Closures', icon: ShieldAlert, activeColor: 'bg-red-600 text-white' },
    { key: 'facilities', label: 'Facilities', icon: Home, activeColor: 'bg-purple-600 text-white' },
    { key: 'routes', label: 'Routes', icon: Navigation, activeColor: 'bg-emerald-600 text-white' },
  ];

  return (
    <div className="absolute top-3 left-14 z-[1000] flex items-center gap-1.5 bg-white/90 backdrop-blur-md p-1.5 rounded-lg shadow-md border border-slate-200 overflow-x-auto max-w-[calc(100%-80px)]">
      {controls.map(({ key, label, icon: Icon, activeColor }) => {
        const isActive = visibleLayers[key];
        return (
          <button
            key={key}
            onClick={() => onToggleLayer(key)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              isActive
                ? `${activeColor} shadow-sm`
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            aria-pressed={isActive}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
```
