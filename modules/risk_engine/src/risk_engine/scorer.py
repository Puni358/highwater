"""Risk scorer for HighWater Module 3.

Scoring formula (all components normalised to [0, 1] before weighting):

    raw = w_flood_pct     * min(flooded_percent / FLOOD_PCT_MAX, 1.0)
        + w_exposure      * min(exposed_buildings / EXPOSED_MAX, 1.0)
        + w_isolation     * isolation_score[accessibility]
        + w_flood_area    * min(flooded_area_m2 / FLOOD_AREA_MAX, 1.0)

    score_0_100 = round(raw * 100, 1)

This is a PROVISIONAL DECISION-SUPPORT HEURISTIC. It has not been validated
against historical flood casualties or response outcomes. Do not present
scores as predictions of life-safety risk. Road accessibility is used only as
a proxy for zone isolation (difficulty of reaching the zone), NOT as a claim
that any route is safe to travel.

Missing / unknown data is flagged with explicit warnings and handled
conservatively (UNKNOWN accessibility gets an intermediate isolation penalty;
null flooded_area_m2 is treated as 0 m² with a warning).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

ACCESSIBILITY_VALUES = {"ACCESSIBLE", "PARTIAL", "BLOCKED", "UNKNOWN"}


@dataclass
class DataQualityWarning:
    zone_id: str
    field: str
    issue: str


@dataclass
class ZoneRiskRecord:
    zone_id: str
    rank: int
    score: float          # 0.0 – 100.0
    priority: str         # CRITICAL | HIGH | MEDIUM | LOW
    reasons: list[str]
    warnings: list[str]
    # Component contributions (each 0.0-1.0, before weighting)
    flood_percent_component: float
    exposure_component: float
    isolation_component: float
    flood_area_component: float
    # Raw inputs (passed through for dashboard use)
    zone_id_raw: str
    flooded_percent: float
    exposed_buildings: int
    total_buildings: int
    accessibility: str
    road_length_m: float
    flooded_road_length_m: float
    flooded_area_m2: float | None
    centroid: list[float]
    bbox: list[float]


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "weights.json"


def load_config(config_path: Path | None = None) -> dict[str, Any]:
    """Load scoring config from *config_path*, falling back to the bundled default."""
    path = config_path or _DEFAULT_CONFIG_PATH
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _extract_weights(cfg: dict) -> dict[str, float]:
    w = cfg["scoring"]["weights"]
    total = sum(w.values())
    if not math.isclose(total, 1.0, rel_tol=1e-6):
        raise ValueError(
            f"Scoring weights must sum to 1.0; got {total:.6f}. "
            f"Edit config/weights.json to fix."
        )
    return w


def _extract_norms(cfg: dict) -> dict[str, float]:
    n = cfg["scoring"]["normalization"]
    for key in ("flood_percent_max", "exposed_buildings_max", "flood_area_m2_max"):
        if n[key] <= 0:
            raise ValueError(f"Normalisation ceiling '{key}' must be > 0; got {n[key]}")
    return n


def _extract_isolation(cfg: dict) -> dict[str, float]:
    iso = cfg["scoring"]["isolation_score"]
    for cat in ACCESSIBILITY_VALUES:
        if cat not in iso:
            raise ValueError(f"isolation_score missing entry for '{cat}' in config")
    for cat, val in iso.items():
        if cat.startswith("_"):
            continue  # skip JSON comment keys
        if not isinstance(val, (int, float)):
            raise ValueError(
                f"isolation_score['{cat}'] = {val!r} is not a number"
            )
        if not (0.0 <= val <= 1.0):
            raise ValueError(
                f"isolation_score['{cat}'] = {val} is outside [0, 1]"
            )
    # Return only real keys (drop comment keys)
    return {k: float(v) for k, v in iso.items() if not k.startswith("_")}


def _extract_thresholds(cfg: dict) -> dict[str, int]:
    t = cfg["priority_thresholds"]
    for key in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        if key not in t:
            raise ValueError(f"priority_thresholds missing '{key}'")
    return t


# ---------------------------------------------------------------------------
# Zone input loading + validation
# ---------------------------------------------------------------------------

class InputValidationError(ValueError):
    pass


def load_zones(zones_json_path: Path) -> tuple[dict[str, Any], list[DataQualityWarning]]:
    """Load and coerce a zones.json file produced by Module 2.

    Returns (zones_doc, warnings). Raises InputValidationError for
    structurally invalid documents.
    """
    if not zones_json_path.exists():
        raise InputValidationError(f"zones.json not found: {zones_json_path}")

    with open(zones_json_path, encoding="utf-8") as fh:
        try:
            doc = json.load(fh)
        except json.JSONDecodeError as exc:
            raise InputValidationError(f"zones.json is not valid JSON: {exc}") from exc

    if not isinstance(doc, dict):
        raise InputValidationError("zones.json top level must be a JSON object")

    if "zones" not in doc:
        raise InputValidationError("zones.json missing required 'zones' key")

    zones = doc["zones"]
    if not isinstance(zones, list):
        raise InputValidationError("'zones' must be a JSON array")

    warnings: list[DataQualityWarning] = []

    required_fields = {
        "zone_id": str,
        "flooded_percent": (int, float),
        "exposed_buildings": int,
        "accessibility": str,
    }
    optional_numeric = {
        "total_buildings": (int, float),
        "road_length_m": (int, float),
        "flooded_road_length_m": (int, float),
        "flooded_area_m2": (int, float, type(None)),
    }

    seen_ids: set[str] = set()
    coerced_zones: list[dict[str, Any]] = []

    for idx, zone in enumerate(zones):
        if not isinstance(zone, dict):
            raise InputValidationError(
                f"zones[{idx}] is not a JSON object"
            )

        zone_id = zone.get("zone_id", f"<index {idx}>")
        if not isinstance(zone_id, str) or not zone_id:
            raise InputValidationError(
                f"zones[{idx}].zone_id is missing or not a string"
            )
        if zone_id in seen_ids:
            raise InputValidationError(f"Duplicate zone_id: '{zone_id}'")
        seen_ids.add(zone_id)

        # Required fields type-check
        for fname, ftype in required_fields.items():
            val = zone.get(fname)
            if val is None and fname != "flooded_area_m2":
                raise InputValidationError(
                    f"zones[{idx}] ('{zone_id}') missing required field '{fname}'"
                )
            if val is not None and not isinstance(val, ftype):
                raise InputValidationError(
                    f"zones[{idx}] ('{zone_id}') field '{fname}' expected "
                    f"{ftype}, got {type(val).__name__}"
                )

        # Accessibility enum check
        acc = zone["accessibility"]
        if acc not in ACCESSIBILITY_VALUES:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="accessibility",
                issue=f"Unrecognised accessibility value '{acc}'; treating as UNKNOWN",
            ))
            zone = dict(zone)
            zone["accessibility"] = "UNKNOWN"

        # flooded_percent range
        fp = zone["flooded_percent"]
        if not isinstance(fp, (int, float)) or not math.isfinite(fp):
            raise InputValidationError(
                f"zones '{zone_id}' flooded_percent is not a finite number: {fp!r}"
            )
        if not (0.0 <= fp <= 100.0):
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_percent",
                issue=f"flooded_percent {fp} is outside [0, 100]; clamped",
            ))
            zone = dict(zone)
            zone["flooded_percent"] = max(0.0, min(100.0, float(fp)))

        # exposed_buildings non-negative
        eb = zone["exposed_buildings"]
        if not isinstance(eb, int) or eb < 0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="exposed_buildings",
                issue=f"exposed_buildings {eb!r} is not a non-negative integer; treating as 0",
            ))
            zone = dict(zone)
            zone["exposed_buildings"] = 0

        # flooded_area_m2 nullable
        fam = zone.get("flooded_area_m2")
        if fam is None:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_area_m2",
                issue="flooded_area_m2 is null; treating as 0 m² for scoring",
            ))
            zone = dict(zone)
            zone["flooded_area_m2"] = 0.0
        elif not isinstance(fam, (int, float)) or not math.isfinite(fam) or fam < 0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_area_m2",
                issue=f"flooded_area_m2 {fam!r} is not a non-negative finite number; treating as 0 m²",
            ))
            zone = dict(zone)
            zone["flooded_area_m2"] = 0.0

        # Optional numeric defaults
        for fname in ("total_buildings", "road_length_m", "flooded_road_length_m"):
            val = zone.get(fname)
            if val is None:
                zone = dict(zone)
                zone[fname] = 0
            elif not isinstance(val, (int, float)) or not math.isfinite(val):
                warnings.append(DataQualityWarning(
                    zone_id=zone_id,
                    field=fname,
                    issue=f"'{fname}' is not a finite number ({val!r}); treating as 0",
                ))
                zone = dict(zone)
                zone[fname] = 0

        # bbox / centroid are passed through without scoring impact
        for gfield in ("bbox", "centroid"):
            if gfield not in zone:
                zone = dict(zone)
                zone[gfield] = []

        coerced_zones.append(zone)

    doc = dict(doc)
    doc["zones"] = coerced_zones
    return doc, warnings


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _priority_label(score: float, thresholds: dict[str, int]) -> str:
    if score >= thresholds["CRITICAL"]:
        return "CRITICAL"
    if score >= thresholds["HIGH"]:
        return "HIGH"
    if score >= thresholds["MEDIUM"]:
        return "MEDIUM"
    return "LOW"


def _build_reasons(
    zone: dict[str, Any],
    flood_c: float,
    exposure_c: float,
    isolation_c: float,
    flood_area_c: float,
    cfg_dq: dict[str, Any],
) -> list[str]:
    """Generate human-readable reasons explaining the score components."""
    reasons: list[str] = []

    fp = zone["flooded_percent"]
    eb = zone["exposed_buildings"]
    tb = zone["total_buildings"]
    acc = zone["accessibility"]
    fam = zone.get("flooded_area_m2", 0.0) or 0.0
    rl = zone.get("road_length_m", 0.0) or 0.0
    frl = zone.get("flooded_road_length_m", 0.0) or 0.0

    if flood_c > 0:
        reasons.append(
            f"{fp:.1f}% of zone area estimated as flooded "
            f"(derived from labelled building/road extents)"
        )
    else:
        reasons.append("No derived flood coverage in this zone")

    if tb > 0:
        reasons.append(
            f"{eb} of {tb} buildings have a human-labelled 'flooded' tag"
        )
    else:
        reasons.append("No buildings recorded in this zone")

    if acc == "BLOCKED":
        frl_pct = (frl / rl * 100) if rl > 0 else 100.0
        reasons.append(
            f"Zone roads are {frl_pct:.0f}% flooded — reaching this zone "
            f"is severely restricted (road isolation penalty applied)"
        )
    elif acc == "PARTIAL":
        frl_pct = (frl / rl * 100) if rl > 0 else 0.0
        reasons.append(
            f"Zone roads are {frl_pct:.0f}% flooded — partial road isolation penalty applied"
        )
    elif acc == "UNKNOWN":
        reasons.append(
            "No road data for this zone — isolation status unknown "
            "(intermediate penalty applied)"
        )
    else:
        reasons.append("Roads in this zone are not significantly flooded")

    if fam > 0:
        reasons.append(
            f"Derived flood-extent area: {fam:.0f} m²"
        )

    # Data quality hint for suspicious zero-exposure / high flood
    warn_thresh = cfg_dq.get("warn_on_zero_exposure_with_high_flood_percent_threshold", 5.0)
    if eb == 0 and fp >= warn_thresh and tb > 0:
        reasons.append(
            f"NOTE: flooded_percent={fp:.1f}% but no buildings have a "
            f"'flooded' label — extent may not overlap recorded structures"
        )

    return reasons


def _build_zone_warnings(
    zone: dict[str, Any],
    global_warnings: list[DataQualityWarning],
    cfg_dq: dict[str, Any],
) -> list[str]:
    """Collect per-zone warning strings from global warning list + heuristic checks."""
    zid = zone["zone_id"]
    msgs: list[str] = [w.issue for w in global_warnings if w.zone_id == zid]

    acc = zone["accessibility"]
    fp = zone["flooded_percent"]
    eb = zone["exposed_buildings"]
    warn_thresh = cfg_dq.get("warn_on_zero_exposure_with_high_flood_percent_threshold", 5.0)

    if acc == "UNKNOWN" and cfg_dq.get("warn_on_unknown_accessibility", True):
        msgs.append(
            "accessibility=UNKNOWN: no road data; isolation status cannot be determined"
        )

    if eb == 0 and fp >= warn_thresh:
        msgs.append(
            f"flooded_percent={fp:.1f}% but exposed_buildings=0: "
            f"flood extent may not coincide with recorded building footprints"
        )

    return msgs


def score_zones(
    zones_doc: dict[str, Any],
    config: dict[str, Any],
    global_warnings: list[DataQualityWarning],
) -> list[ZoneRiskRecord]:
    """Compute risk scores for all zones and return them ranked highest-first.

    Tie-breaking is deterministic: ties resolved by zone_id lexicographic order.
    """
    weights = _extract_weights(config)
    norms = _extract_norms(config)
    iso_scores = _extract_isolation(config)
    thresholds = _extract_thresholds(config)
    cfg_dq = config.get("data_quality", {})

    records: list[ZoneRiskRecord] = []

    for zone in zones_doc["zones"]:
        fp = float(zone["flooded_percent"])
        eb = int(zone["exposed_buildings"])
        acc = zone["accessibility"]
        fam = float(zone.get("flooded_area_m2") or 0.0)

        # --- Component normalisation (each in [0, 1]) ---
        flood_c = min(fp / norms["flood_percent_max"], 1.0)
        exposure_c = min(eb / norms["exposed_buildings_max"], 1.0)
        isolation_c = iso_scores.get(acc, iso_scores["UNKNOWN"])
        flood_area_c = min(fam / norms["flood_area_m2_max"], 1.0)

        raw = (
            weights["flood_percent"]     * flood_c
            + weights["exposure"]        * exposure_c
            + weights["isolation"]       * isolation_c
            + weights["flood_area_density"] * flood_area_c
        )
        score = round(raw * 100, 1)

        priority = _priority_label(score, thresholds)
        reasons = _build_reasons(zone, flood_c, exposure_c, isolation_c, flood_area_c, cfg_dq)
        zone_warnings = _build_zone_warnings(zone, global_warnings, cfg_dq)

        records.append(ZoneRiskRecord(
            zone_id=zone["zone_id"],
            rank=0,  # filled below after sorting
            score=score,
            priority=priority,
            reasons=reasons,
            warnings=zone_warnings,
            flood_percent_component=round(flood_c, 4),
            exposure_component=round(exposure_c, 4),
            isolation_component=round(isolation_c, 4),
            flood_area_component=round(flood_area_c, 4),
            zone_id_raw=zone["zone_id"],
            flooded_percent=fp,
            exposed_buildings=eb,
            total_buildings=int(zone.get("total_buildings") or 0),
            accessibility=acc,
            road_length_m=float(zone.get("road_length_m") or 0.0),
            flooded_road_length_m=float(zone.get("flooded_road_length_m") or 0.0),
            flooded_area_m2=fam,
            centroid=list(zone.get("centroid") or []),
            bbox=list(zone.get("bbox") or []),
        ))

    # Sort: score descending, then zone_id ascending (deterministic tie-break)
    records.sort(key=lambda r: (-r.score, r.zone_id))
    for i, rec in enumerate(records, start=1):
        rec.rank = i

    return records


# ---------------------------------------------------------------------------
# Output serialisation
# ---------------------------------------------------------------------------

OUTPUT_SCHEMA_VERSION = "1.0"


def records_to_dict(
    records: list[ZoneRiskRecord],
    global_warnings: list[DataQualityWarning],
    source_doc: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Serialise scored records to a dict suitable for JSON output."""
    weights = config["scoring"]["weights"]
    # Strip JSON-comment keys (any key starting with "_") before writing to output
    # so downstream consumers do not encounter unexpected string-typed entries.
    norms = {k: v for k, v in config["scoring"]["normalization"].items() if not k.startswith("_")}
    thresholds = {k: v for k, v in config["priority_thresholds"].items() if not k.startswith("_")}

    scored_zones = []
    for r in records:
        scored_zones.append({
            "rank": r.rank,
            "zone_id": r.zone_id,
            "score": r.score,
            "priority": r.priority,
            "reasons": r.reasons,
            "warnings": r.warnings,
            "score_components": {
                "flood_percent": r.flood_percent_component,
                "exposure": r.exposure_component,
                "isolation": r.isolation_component,
                "flood_area_density": r.flood_area_component,
            },
            "inputs": {
                "flooded_percent": r.flooded_percent,
                "exposed_buildings": r.exposed_buildings,
                "total_buildings": r.total_buildings,
                "accessibility": r.accessibility,
                "road_length_m": r.road_length_m,
                "flooded_road_length_m": r.flooded_road_length_m,
                "flooded_area_m2": r.flooded_area_m2,
            },
            "geometry": {
                "centroid": r.centroid,
                "bbox": r.bbox,
                "crs": source_doc.get("crs", "EPSG:4326"),
            },
        })

    priority_counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for r in records:
        priority_counts[r.priority] = priority_counts.get(r.priority, 0) + 1

    all_warnings = [
        {"zone_id": w.zone_id, "field": w.field, "issue": w.issue}
        for w in global_warnings
    ]

    return {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "module": "risk_engine",
        "module_version": "1.0",
        "disclaimer": (
            "PROVISIONAL DECISION-SUPPORT HEURISTIC — scores reflect configurable "
            "weightings applied to Module 2 ground-truth labels from a single "
            "flood event (Dernau, June 2021). They have NOT been validated against "
            "historical flood casualties or response outcomes. Do not treat scores "
            "as predictions of life-safety risk. Road accessibility data indicates "
            "zone isolation only — it makes no claim about route safety."
        ),
        "source_metadata": {
            "input_schema_version": source_doc.get("schema_version", "unknown"),
            "input_source": source_doc.get("source", "unknown"),
            "input_crs": source_doc.get("crs", "unknown"),
        },
        "scoring_config": {
            "weights": weights,
            "normalization_ceilings": norms,
            "priority_thresholds": thresholds,
        },
        "summary": {
            "total_zones": len(records),
            "priority_counts": priority_counts,
        },
        "data_quality_warnings": all_warnings,
        "ranked_zones": scored_zones,
    }
