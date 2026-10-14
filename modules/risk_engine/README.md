# Risk & Prioritization Engine (Module 3)

HighWater Mission 6 — Disaster Response Drones. Consumes the zone grid
produced by Module 2 (`modules/flood_analysis/output/zones.json`) and ranks
zones by a configurable, documented priority score to guide drone
reconnaissance and resource dispatch decisions.

> **Important**: Scores are **provisional decision-support heuristics** based
> on SpaceNet 8 ground-truth labels for a single flood event (Dernau, June
> 2021). They have not been validated against historical casualty or response
> data. Do not treat them as predictions of life-safety risk.

---

## Quick start

```bash
# From modules/risk_engine/:
PYTHONPATH=src python -m risk_engine.cli \
    --zones ../flood_analysis/output/zones.json \
    --out output/

# Export in dashboard format (writes output/zones.json):
PYTHONPATH=src python -m risk_engine.cli \
    --zones ../flood_analysis/output/zones.json \
    --out output/ \
    --format dashboard \
    --data-mode historical

# With a custom weights file:
PYTHONPATH=src python -m risk_engine.cli \
    --zones ../flood_analysis/output/zones.json \
    --out output/ \
    --config config/weights.json
```

Output is written to:
- `output/risk_scores.json` when `--format standard` (default)
- `output/zones.json` when `--format dashboard`

### CLI Exit Codes
- `0`: Success.
- `1`: Input validation failure (`InputValidationError`).
- `2`: Configuration or file not found error (`ConfigError` / `FileNotFoundError`).
- `3`: Unexpected internal runtime failure.
- `--debug`: Pass to output full stack traces on error.

### Install / Run Tests
```bash
pip install -e .
python -m pytest tests/ -v
```

---

## Scoring Formula & Weights

```
raw_score = w_flood_pct     * min(flooded_percent  / FLOOD_PCT_MAX,  1.0)
          + w_exposure      * min(exposed_buildings / EXPOSED_MAX,    1.0)
          + w_isolation     * isolation_score[accessibility]
          + w_flood_area    * min(flooded_area_m2   / FLOOD_AREA_MAX, 1.0)
          + w_exp_frac      * min(exposed_buildings / total_buildings, 1.0)

score_0_100 = round(raw_score * 100, 1)
```

### Default Weights (`config/weights.json`)

| Component           | Weight | Description |
|---------------------|--------|-------------|
| `flood_percent`     | 0.35   | Estimated percentage of zone area flooded |
| `exposure`          | 0.40   | Number of buildings tagged as flooded |
| `isolation`         | 0.15   | Road accessibility status proxy |
| `flood_area_density`| 0.10   | Absolute flooded area in m² |
| `exposure_fraction` | 0.00   | Optional ratio of exposed to total buildings (defaults to 0.0) |

*Caveat*: `flood_percent` and `flood_area_density` both measure flood extent (relative saturation vs. absolute inundation scale). Both components derive from the same flood extent labels.

### Normalisation Ceilings (Default)

| Field               | Ceiling    |
|---------------------|------------|
| `flooded_percent`   | 30.0 %     |
| `exposed_buildings` | 75         |
| `flooded_area_m2`   | 15 000 m²  |

### Isolation Scores

| `accessibility` | Component Value |
|-----------------|-----------------|
| `ACCESSIBLE`    | 0.0             |
| `PARTIAL`       | 0.5             |
| `BLOCKED`       | 1.0             |
| `UNKNOWN`       | 0.5             |

### Priority Thresholds

| Priority   | Score Range |
|------------|-------------|
| `CRITICAL` | ≥ 70        |
| `HIGH`     | ≥ 45        |
| `MEDIUM`   | ≥ 20        |
| `LOW`      | < 20        |

---

## Configuration Validation Rules

Configuration is strictly validated before input data is loaded:
1. Weights must contain the 4 base keys (`flood_percent`, `exposure`, `isolation`, `flood_area_density`) with optional `exposure_fraction`. No unexpected keys permitted.
2. All weights must be non-negative finite numbers and sum to 1.0.
3. Normalization ceilings must be positive finite numbers.
4. Isolation scores must satisfy monotonic ordering: `ACCESSIBLE <= PARTIAL <= BLOCKED` and `UNKNOWN >= PARTIAL`.
5. Thresholds must satisfy strict descending order: `CRITICAL > HIGH > MEDIUM > LOW >= 0`.
6. Underscore-prefixed keys (`_comment`) are stripped from numeric scoring blocks and output.

---

## Deterministic Ranking & Tie-Breaking

Zones are ordered deterministically using a 4-level hierarchy:
1. Unrounded raw score descending
2. Exposed buildings descending
3. Flooded percentage descending
4. Natural-sort `zone_id` ascending (`zone-2` precedes `zone-10`)

Tied zones receive distinct sequential integer ranks (`1..N`).

---

## Output Contract & Dashboard Exporter

### Standard Output Schema 1.1 (`risk_scores.json`)
- `schema_version`: `"1.1"`
- `generated_at`: ISO UTC timestamp
- `source_metadata`: input schema version, input source, input CRS, `input_file_sha256`, `config_hash_sha256`
- `scoring_config`: echoed `config_version: "1.0"`, weights, normalization ceilings, priority thresholds
- `ranked_zones`: includes `rank`, `zone_id`, `score`, `priority`, `score_basis` (`full` or `partial`), `omitted_components`, `reasons`, `warnings`, `score_components`, `inputs`, `geometry`

### Dashboard Export (`zones.json`)
When `--format dashboard` is specified, the CLI writes `zones.json` formatted per dashboard specifications:
- `schema_version`: `"1.1"`
- `data_mode`: from `--data-mode` (default `"historical"`)
- `study_area`: dynamically resolved from input metadata (never a hardcoded fallback)
- `score_scale`: `"0-100"`
- `zones`: includes `zone_id`, `name`, `risk_level`, `risk_score` (1 dp, preserving 0.5 and 0.1), `flooded_percent`, `flooded_area_km2`, `exposed_buildings`, `total_buildings`, `accessibility` (mapped to `OPEN`, `LIMITED`, `BLOCKED`, `UNKNOWN`), `reasons`, and `geometry` as a closed 5-point GeoJSON Polygon ring built from bbox in `[lng, lat]` order.

> **Note**: The dashboard adapter must accept `CRITICAL` risk level and `score_scale` before this file displays correctly on the dashboard (that update is Member 1's responsibility).

---

## Missing Data & Partial Scoring

The engine never silently converts missing or ambiguous data into zero risk:
- **`flooded_area_m2` Null**:
  - Scored as 0.0 with full scoring ONLY when `flooded_percent == 0` (matching Module 2 behavior when no flood extent exists in the tile).
  - When `flooded_area_m2` is null/invalid while `flooded_percent > 0`, the engine omits `flood_area_density`, renormalizes remaining weights for that zone, flags `score_basis: "partial"`, and logs the omitted component.
- **Negative Exposure**:
  - Fails strictly with `InputValidationError` by default (`data_quality.on_negative_exposure = "error"`).
  - Can be configured to warn and clamp to 0 with `on_negative_exposure = "warn_zero"`.
- **`accessibility == "UNKNOWN"`**:
  - Emits exactly one warning per zone and applies intermediate penalty `0.5`.

---

## Diagnostic Tools

1. **Calibration Diagnostic** (`tools/calibrate.py`):
   - Computes distribution (min, median, p90, p95, max) for raw inputs and scores.
   - Evaluates ceiling utilization and warns if a ceiling is >25% above observed maximum or below p95.
   - Warns on empty priority classes (`CRITICAL=0` in real dataset).
   - Suggests empirical ceilings without modifying configuration files.

2. **Sensitivity Analysis** (`tools/sensitivity.py`):
   - Perturbs scoring weights by -20%, -10%, +10%, +20% (with weight renormalization).
   - Perturbs isolation scores and priority thresholds by ±10%.
   - Computes Kendall's tau rank correlation against baseline, top-5 overlap, and priority change counts.
   - Outputs table sorted by most destabilizing parameter.

---

## Known Limitations

- **Single Flood Event**: Derived and calibrated on SpaceNet 8 ground truth labels from Dernau (Ahr valley, June 2021). Not validated against other events.
- **Uncalibrated Thresholds**: Heuristic boundaries (70/45/20) have not been calibrated against operational disaster-response casualty or dispatch data.
- **Correlated Inputs**: `flooded_percent` and `flooded_area_density` both reflect flood extent and share common error modes from the underlying segmentation.
- **Absolute Exposure Counts**: Building counts do not account for building type, floor area, or population density.
