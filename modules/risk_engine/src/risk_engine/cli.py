"""CLI entry point for the HighWater Risk & Prioritization Engine (Module 3).

Usage:
    python -m risk_engine.cli --zones <path/to/zones.json> --out <output_dir>
    python -m risk_engine.cli --zones <path/to/zones.json> --out <output_dir> --config <path/to/weights.json>

Examples:
    # Process the real Module 2 output using the bundled default weights:
    PYTHONPATH=src python -m risk_engine.cli \\
        --zones ../flood_analysis/output/zones.json \\
        --out output/

    # Use a custom weights file:
    PYTHONPATH=src python -m risk_engine.cli \\
        --zones ../flood_analysis/output/zones.json \\
        --out output/ \\
        --config config/weights.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from risk_engine.scorer import (
    InputValidationError,
    load_config,
    load_zones,
    records_to_dict,
    score_zones,
)


def run(zones_path: Path, out_dir: Path, config_path: Path | None = None) -> dict:
    """Core logic — callable from tests without argument parsing."""
    out_dir.mkdir(parents=True, exist_ok=True)

    config = load_config(config_path)
    zones_doc, warnings = load_zones(zones_path)

    if not zones_doc["zones"]:
        print("WARNING: zones.json contains zero zones — output will be empty.")

    records = score_zones(zones_doc, config, warnings)
    output = records_to_dict(records, warnings, zones_doc, config)

    out_path = out_dir / "risk_scores.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2)

    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HighWater Module 3 — Risk & Prioritization Engine"
    )
    parser.add_argument(
        "--zones",
        required=True,
        type=Path,
        help="Path to zones.json produced by Module 2 (flood_analysis)",
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Directory where risk_scores.json will be written",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Optional path to a custom weights.json (defaults to config/weights.json)",
    )
    args = parser.parse_args()

    try:
        output = run(args.zones, args.out, args.config)
    except InputValidationError as exc:
        print(f"ERROR: Input validation failed — {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Unexpected failure — {exc}", file=sys.stderr)
        sys.exit(2)

    summary = output["summary"]
    counts = summary["priority_counts"]
    dq_count = len(output["data_quality_warnings"])
    top5 = output["ranked_zones"][:5]

    print(
        f"Scored {summary['total_zones']} zones -> "
        f"CRITICAL={counts['CRITICAL']} HIGH={counts['HIGH']} "
        f"MEDIUM={counts['MEDIUM']} LOW={counts['LOW']}"
    )
    if dq_count:
        print(f"Data-quality warnings: {dq_count}")

    print("\nTop-5 priority zones:")
    for z in top5:
        warn_flag = " [WARNINGS]" if z["warnings"] else ""
        print(
            f"  #{z['rank']:2d}  {z['zone_id']}  score={z['score']:5.1f}"
            f"  {z['priority']}{warn_flag}"
        )

    out_file = args.out / "risk_scores.json"
    print(f"\nOutput written to: {out_file}")


if __name__ == "__main__":
    main()
