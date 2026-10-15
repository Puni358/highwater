# HighWater — Model Validation Results

SegFormer-B0 detects water extent across diverse geographies. Same model, different environmental manifestations.

---

## Validation Summary

| Metric | Value |
|:---|:---|
| **Ground-Truth Accuracy** | 80.67% (evaluated against human pixel annotations) |
| **Processing Latency** | ~0.5s per image (fully offline) |
| **Total Images Validated** | 48 real flood images |

---

## Datasets

### Kerala 2018 (Sentinel-2 Satellite)
- **Source:** ESA Sentinel-2 MSI, Aug 22 2018 (post-flood), false-color bands 11-8-3; Kuttanad region. Verified against NASA Earth Observatory's published before/after Kerala flood comparison. Satellite tiles, not drone photography — the earlier 26-tile "kerala_fresh" set was dropped after visual inspection showed it was cropped from a pre-flood GeoTIFF and contained no real floodwater.
- **Count:** 15 tiles
- **Coverage Range:** 98.45% → 18.76%
- **Average Confidence:** 88.61%

### Hurricane Harvey 2017 (FloodNet)
- **Count:** 33 images
- **Coverage Range:** 64.81% → 0.00%
- **Average Confidence:** 84.60%
