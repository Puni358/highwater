import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import FloodMap from '../components/FloodMap.jsx';
import MapControls from '../components/MapControls.jsx';
import FloodWatchObservedLayer from '../features/map/FloodWatchObservedLayer.jsx';
import FloodWatchPredictedLayer from '../features/map/FloodWatchPredictedLayer.jsx';
import {
  adaptFloodWatchFeature,
  adaptFloodWatchCollection,
} from '../data/dataAdapter.js';

describe('FloodWatch Layers & Unobstructed Map Integration (Step 6)', () => {
  const sampleGroundTruth = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'gt-bldg-1',
        properties: {
          feature_id: 'gt-bldg-1',
          tile_id: '0_41_58',
          feature_type: 'building',
          provenance: 'observed',
          flooded: 'yes',
          in_training_pool: true,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[7.039, 50.531], [7.044, 50.531], [7.044, 50.535], [7.039, 50.535], [7.039, 50.531]]],
        },
      },
      {
        type: 'Feature',
        id: 'gt-road-1',
        properties: {
          feature_id: 'gt-road-1',
          tile_id: '0_41_58',
          feature_type: 'road',
          provenance: 'observed',
          flooded: 'yes',
          in_training_pool: true,
        },
        geometry: {
          type: 'LineString',
          coordinates: [[7.039, 50.531], [7.042, 50.533]],
        },
      },
    ],
  };

  const samplePredictedFast = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'pred-fast-1',
        properties: {
          feature_id: 'pred-fast-1',
          tile_id: '0_41_58',
          mode: 'fast',
          provenance: 'derived',
          mask_pixels: 2395,
          in_training_pool: true,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[7.040, 50.532], [7.043, 50.532], [7.043, 50.534], [7.040, 50.534], [7.040, 50.532]]],
        },
      },
    ],
  };

  const samplePredictedAccurate = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'pred-acc-1',
        properties: {
          feature_id: 'pred-acc-1',
          tile_id: '0_41_58',
          mode: 'accurate',
          provenance: 'derived',
          mask_pixels: 3120,
          in_training_pool: true,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[7.040, 50.532], [7.043, 50.532], [7.043, 50.534], [7.040, 50.534], [7.040, 50.532]]],
        },
      },
    ],
  };

  it('1. Panel collapses and expands cleanly, with keyboard accessibility', () => {
    render(
      <FloodMap
        floodGroundTruth={sampleGroundTruth}
        floodPredictedFast={samplePredictedFast}
        floodPredictedAccurate={samplePredictedAccurate}
      />
    );

    const toggleBtn = screen.getByRole('button', { name: /collapse side panel/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /map layer controls/i })).toBeInTheDocument();

    // Collapse
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: /expand side panel/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /map layer controls/i })).not.toBeInTheDocument();

    // Expand
    const expandBtn = screen.getByRole('button', { name: /expand side panel/i });
    fireEvent.click(expandBtn);
    expect(screen.getByRole('button', { name: /collapse side panel/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /map layer controls/i })).toBeInTheDocument();
  });

  it('2. Map container has nothing covering it except zoom, reset-extent and attribution', () => {
    const { container } = render(
      <FloodMap
        floodGroundTruth={sampleGroundTruth}
        floodPredictedFast={samplePredictedFast}
        floodPredictedAccurate={samplePredictedAccurate}
      />
    );

    // Map viewport container is the first relative div
    const mapViewport = container.querySelector('.bg-slate-200');
    expect(mapViewport).toBeInTheDocument();

    // Within the map viewport, verify no legends, banners, or layer controls exist
    expect(mapViewport.querySelector('[aria-label="Map Layer Controls"]')).toBeNull();
    expect(mapViewport.querySelector('[aria-label="Map Legend"]')).toBeNull();
    expect(mapViewport.querySelector('[role="alert"]')).toBeNull();

    // Only ResetExtentControl and Leaflet map elements exist in the viewport
    const resetExtentBtn = mapViewport.querySelector('button[aria-label="Reset map extent"]');
    expect(resetExtentBtn).not.toBeNull();
  });

  it('3. map.invalidateSize() is triggered on side panel toggle via resize event', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <FloodMap
        floodGroundTruth={sampleGroundTruth}
        floodPredictedFast={samplePredictedFast}
      />
    );

    const toggleBtn = screen.getByRole('button', { name: /collapse side panel/i });
    fireEvent.click(toggleBtn);

    // Wait for timeout debounce
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('4. Adapter passes provenance and in_training_pool through, counts skipped features, and leaves missing fields null', () => {
    const rawFeatures = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'valid-feat',
          properties: {
            tile_id: '0_41_58',
            mode: 'accurate',
            in_training_pool: true,
            // provenance, feature_type, mask_pixels omitted
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[[7.0, 50.0], [7.1, 50.0], [7.1, 50.1], [7.0, 50.1], [7.0, 50.0]]],
          },
        },
        {
          type: 'Feature',
          id: 'bad-ring',
          geometry: {
            type: 'Polygon',
            coordinates: [[[7.0, 50.0], [7.1, 50.0], [7.1, 50.1]]], // unclosed
          },
        },
      ],
    };

    let dropped = 0;
    const adapted = adaptFloodWatchCollection(rawFeatures, () => { dropped += 1; }, 'derived');

    expect(adapted.features).toHaveLength(1);
    expect(dropped).toBe(1);

    const feat = adapted.features[0];
    expect(feat.properties.tile_id).toBe('0_41_58');
    expect(feat.properties.mode).toBe('accurate');
    expect(feat.properties.in_training_pool).toBe(true);
    expect(feat.properties.provenance).toBe('derived');
    expect(feat.properties.feature_type).toBeNull(); // missing remains null
    expect(feat.properties.mask_pixels).toBeNull(); // missing remains null
  });

  it('5. Layer toggles turn layers on/off independently in MapControls', () => {
    const onToggle = vi.fn();
    const visibleLayers = {
      flood: false,
      risk: false,
      roads: false,
      facilities: false,
      routes: false,
      buildings: false,
      floodGroundTruth: true,
      floodPredicted: false,
    };

    render(
      <MapControls
        visibleLayers={visibleLayers}
        onToggleLayer={onToggle}
        onResetExtent={() => {}}
        hasFloodWatch={true}
      />
    );

    const gtToggle = screen.getByLabelText('Toggle Observed labels (SpaceNet 8) overlay');
    const predToggle = screen.getByLabelText('Toggle Model output (derived) overlay');

    expect(gtToggle).toBeChecked();
    expect(predToggle).not.toBeChecked();

    fireEvent.click(predToggle);
    expect(onToggle).toHaveBeenCalledWith('floodPredicted');

    fireEvent.click(gtToggle);
    expect(onToggle).toHaveBeenCalledWith('floodGroundTruth');
  });

  it('6. Fast/accurate mode toggle swaps inference mode', () => {
    const onModeChange = vi.fn();
    const visibleLayers = {
      flood: false,
      risk: false,
      roads: false,
      facilities: false,
      routes: false,
      buildings: false,
      floodGroundTruth: true,
      floodPredicted: true,
    };

    render(
      <MapControls
        visibleLayers={visibleLayers}
        onToggleLayer={() => {}}
        onResetExtent={() => {}}
        modelMode="fast"
        onChangeModelMode={onModeChange}
        hasFloodWatch={true}
      />
    );

    const accurateBtn = screen.getByRole('button', { name: 'Accurate' });
    fireEvent.click(accurateBtn);
    expect(onModeChange).toHaveBeenCalledWith('accurate');

    const fastBtn = screen.getByRole('button', { name: 'Fast' });
    fireEvent.click(fastBtn);
    expect(onModeChange).toHaveBeenCalledWith('fast');
  });

  it('7. Training-pool note appears only when relevant in the side panel', () => {
    // When model layer is ON and features have in_training_pool: true
    const { rerender } = render(
      <FloodMap
        floodGroundTruth={sampleGroundTruth}
        floodPredictedFast={samplePredictedFast}
        visibleLayers={{
          flood: false,
          risk: false,
          roads: false,
          facilities: false,
          routes: false,
          buildings: false,
          floodGroundTruth: true,
          floodPredicted: true,
        }}
      />
    );

    expect(
      screen.getByText(/Tiles shown were in the model's training pool; agreement with labels is not a held-out result./i)
    ).toBeInTheDocument();

    // When model layer is toggled OFF
    rerender(
      <FloodMap
        floodGroundTruth={sampleGroundTruth}
        floodPredictedFast={samplePredictedFast}
        visibleLayers={{
          flood: false,
          risk: false,
          roads: false,
          facilities: false,
          routes: false,
          buildings: false,
          floodGroundTruth: true,
          floodPredicted: false,
        }}
      />
    );

    expect(
      screen.queryByText(/Tiles shown were in the model's training pool; agreement with labels is not a held-out result./i)
    ).not.toBeInTheDocument();
  });

  it('8. Model feature popups contain the mandatory text "Model output, not observed flooding"', () => {
    const { container } = render(
      <MapContainer center={[50.53, 7.04]} zoom={14}>
        <FloodWatchPredictedLayer data={samplePredictedFast} selectedTileId="ALL" />
      </MapContainer>
    );

    const path = container.querySelector('.leaflet-overlay-pane svg path');
    expect(path).not.toBeNull();
    fireEvent.click(path);

    // Popup text is rendered in the layer markup
    expect(screen.getByText('Model output, not observed flooding')).toBeInTheDocument();
    expect(screen.getByText(/Tile ID:/i)).toBeInTheDocument();
    expect(screen.getByText('0_41_58')).toBeInTheDocument();
  });
});
