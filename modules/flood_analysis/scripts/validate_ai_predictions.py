"""Validate ai_predictions.json against the SN8 human-labelled ground truth.

Ground-truth method (documented): for each AOI tile, load its raw annotation
geojson (data/raw/annotations/{tile_id}.geojson), the same source the main
processor pipeline uses. A tile's ground-truth label is "flooded" if ANY
labelled building or road feature in that tile has flooded == 'yes'
(majority-style tile aggregation: one of the labelled flooded features present
is enough to call the tile flooded, since most tiles have very few flooded
features total). Tiles with zero building/road features are excluded.

Run: python scripts/validate_ai_predictions.py
"""
import json
import os

BASE = os.path.join(os.path.dirname(__file__), "..")
ANNOTATIONS_DIR = os.path.join(BASE, "data", "raw", "annotations")
PREDICTIONS_PATH = os.path.join(BASE, "output", "ai_predictions.json")
OUT_PATH = os.path.join(BASE, "output", "ai_validation_summary.json")

AOI_TILE_IDS = [f"0_{row}_{col}" for row in range(36, 42) for col in range(59, 63)]


def tile_ground_truth(tile_id):
    fp = os.path.join(ANNOTATIONS_DIR, f"{tile_id}.geojson")
    if not os.path.exists(fp):
        return None
    d = json.load(open(fp))
    features = [
        f for f in d["features"]
        if f["properties"].get("building") is not None or f["properties"].get("highway") is not None
    ]
    if not features:
        return None
    return any(f["properties"].get("flooded") == "yes" for f in features)


def main():
    if not os.path.exists(PREDICTIONS_PATH):
        raise SystemExit(f"No predictions found at {PREDICTIONS_PATH}. Run ai_flood_detect.py first.")

    predictions = json.load(open(PREDICTIONS_PATH))

    tp = tn = fp = fn = 0
    skipped_no_truth = []
    skipped_no_prediction = []
    skipped_error = []
    per_tile = {}

    for tile_id in AOI_TILE_IDS:
        truth = tile_ground_truth(tile_id)
        if truth is None:
            skipped_no_truth.append(tile_id)
            continue

        pred_entry = predictions.get(tile_id)
        if pred_entry is None:
            skipped_no_prediction.append(tile_id)
            continue
        if "ERROR" in pred_entry:
            skipped_error.append(tile_id)
            continue

        pred = pred_entry["flood_damage_detected"]
        per_tile[tile_id] = {"ground_truth_flooded": truth, "ai_predicted_flooded": pred}

        if truth and pred:
            tp += 1
        elif (not truth) and (not pred):
            tn += 1
        elif (not truth) and pred:
            fp += 1
        elif truth and (not pred):
            fn += 1

    n_compared = tp + tn + fp + fn
    accuracy = (tp + tn) / n_compared if n_compared else None

    summary = {
        "method": (
            "Ground truth per tile = any labelled building/road feature in that tile has "
            "flooded == 'yes' (from data/raw/annotations/{tile}.geojson, same source as the "
            "main processor pipeline). Tiles with no building/road features are excluded."
        ),
        "tiles_total_in_aoi": len(AOI_TILE_IDS),
        "tiles_compared": n_compared,
        "tiles_skipped_no_ground_truth_features": skipped_no_truth,
        "tiles_skipped_no_prediction": skipped_no_prediction,
        "tiles_skipped_prediction_error": skipped_error,
        "accuracy": accuracy,
        "confusion": {
            "true_positive_flooded_correctly_caught": tp,
            "true_negative_dry_correctly_identified": tn,
            "false_positive_false_alarm": fp,
            "false_negative_flooded_missed": fn,
        },
        "per_tile": per_tile,
    }

    with open(OUT_PATH, "w") as fh:
        json.dump(summary, fh, indent=2)

    print(f"Tiles compared: {n_compared}")
    print(f"Accuracy: {accuracy}")
    print(f"TP={tp} TN={tn} FP={fp} FN={fn}")
    print(f"Skipped (no ground-truth features): {skipped_no_truth}")
    print(f"Skipped (no prediction yet): {skipped_no_prediction}")
    print(f"Skipped (prediction error): {skipped_error}")
    print(f"Written to {OUT_PATH}")


if __name__ == "__main__":
    main()
