"""Risk scorer for HighWater Module 3.

Validation Policy:
    Input documents must strictly conform to expected types and schema:
    - Wrong TYPE (string, bool, list, NaN/inf): Raises `InputValidationError` identifying zone and field.
      Booleans are strictly rejected for every numeric field (since bool subclasses int in Python).
      Integral floats (e.g. 5.0) are accepted for `exposed_buildings` and coerced to integers;
      non-integral floats raise `InputValidationError`.
    - Negative exposure counts: Raises `InputValidationError` identifying zone and field by default.
      Configuring `data_quality.on_negative_exposure="warn_zero"` emits a warning and treats the value as 0.
    - Out-of-range numeric: Handled conservatively and transparently with warnings.
      Percentages outside [0, 100] are clamped to bounds.
    - Cross-field checks: Warnings are emitted when `flooded_road_length_m > road_length_m` (capped at 100%),
      when `exposed_buildings > total_buildings` (capped at 100%), and for negative road/building counts (clamped to 0).
    - Geometry: Centroid (2 finite numbers) and bbox (4 finite numbers) are validated. On failure,
      a warning is emitted and an empty array `[]` is output. CRS is passed through verbatim or marked as "unknown",
      never assuming EPSG:4326.

Missing Flood Area & Partial Scoring:
    `flooded_area_m2` null is scored as 0 ONLY when `flooded_percent == 0` (full scoring, no components dropped).
    If `flooded_area_m2` is null while `flooded_percent > 0` (inconsistent data), a warning is emitted and
    the `flood_area_density` component is omitted, renormalizing the remaining active weights for that zone.
    The zone output records `score_basis="partial"` and lists `omitted_components=["flood_area_density"]`.

Score Components & Shared Label Caveats:
    `flood_percent` and `flood_area_density` both measure flood extent (relative saturation vs. absolute area scale).
    All components derive from the same underlying flood and OSM labels. Scores are provisional decision-support
    heuristics, not validated predictions of life-safety risk. Road accessibility is an isolation proxy,
    not a claim that any route is safe.

Deterministic Ranking Policy:
    Zones are sorted by:
    1. Unrounded raw score descending
    2. Exposed buildings descending
    3. Flooded percentage descending
    4. Natural-sort zone ID ascending (e.g. zone-2 precedes zone-10)
    Tied zones receive distinct sequential integer ranks (1..N).
"""

from __future__ import annotations

import hashlib
import importlib.resources as pkg_resources
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Data structures & Exceptions
# ---------------------------------------------------------------------------

ACCESSIBILITY_VALUES = {"ACCESSIBLE", "PARTIAL", "BLOCKED", "UNKNOWN"}
REQUIRED_BASE_WEIGHT_KEYS = {
    "flood_percent",
    "exposure",
    "isolation",
    "flood_area_density",
}
ALLOWED_WEIGHT_KEYS = REQUIRED_BASE_WEIGHT_KEYS | {"exposure_fraction"}

ACCESSIBILITY_DASHBOARD_MAP = {
    "ACCESSIBLE": "OPEN",
    "PARTIAL": "LIMITED",
    "BLOCKED": "BLOCKED",
    "UNKNOWN": "UNKNOWN",
}


class InputValidationError(ValueError):
    """Raised when zone input data fails structural or type validation."""
    pass


class ConfigError(ValueError, FileNotFoundError):
    """Raised when engine configuration fails validation or cannot be loaded."""
    pass


@dataclass
class DataQualityWarning:
    zone_id: str
    field: str
    issue: str


@dataclass
class ZoneRiskRecord:
    zone_id: str
    rank: int
    score: float          # 0.0 – 100.0 (display rounded)
    priority: str         # CRITICAL | HIGH | MEDIUM | LOW
    raw_score: float      # Unrounded [0.0, 1.0] for deterministic ranking
    reasons: list[str]
    warnings: list[str]
    score_basis: str      # "full" | "partial"
    omitted_components: list[str]
    # Component contributions (each 0.0-1.0, before weighting)
    flood_percent_component: float
    exposure_component: float
    isolation_component: float
    flood_area_component: float
    exposure_fraction_component: float
    # Raw inputs
    flooded_percent: float
    exposed_buildings: int
    total_buildings: int
    accessibility: str
    road_length_m: float
    flooded_road_length_m: float
    flooded_area_m2: float
    centroid: list[float]
    bbox: list[float]


# ---------------------------------------------------------------------------
# Config validation & loading
# ---------------------------------------------------------------------------

def _strip_comments(d: dict[str, Any]) -> dict[str, Any]:
    """Return dictionary with all keys starting with '_' removed."""
    return {k: v for k, v in d.items() if not k.startswith("_")}


def validate_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Validate full configuration structure and value constraints.

    Fails fast before zone data is read.
    """
    if not isinstance(cfg, dict):
        raise ConfigError("Configuration must be a JSON object")

    if "scoring" not in cfg or not isinstance(cfg["scoring"], dict):
        raise ConfigError("Configuration missing 'scoring' section")

    scoring = cfg["scoring"]

    # 1. Weights validation
    if "weights" not in scoring or not isinstance(scoring["weights"], dict):
        raise ConfigError("Configuration missing 'scoring.weights' section")

    raw_weights = scoring["weights"]
    weights = _strip_comments(raw_weights)
    weight_keys = set(weights.keys())

    # Check required base weights and disallowed extra keys
    missing_base = REQUIRED_BASE_WEIGHT_KEYS - weight_keys
    if missing_base:
        raise ConfigError(f"scoring.weights missing required keys: {sorted(missing_base)}")

    extra_keys = weight_keys - ALLOWED_WEIGHT_KEYS
    if extra_keys:
        raise ConfigError(f"scoring.weights contains unexpected extra keys: {sorted(extra_keys)}")

    for k, v in weights.items():
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ConfigError(f"scoring.weights['{k}'] must be a finite number; got {v!r}")
        if v < 0.0:
            raise ConfigError(f"scoring.weights['{k}'] must be non-negative; got {v}")

    total_w = sum(weights.values())
    if not math.isclose(total_w, 1.0, rel_tol=1e-6):
        raise ConfigError(f"scoring.weights must sum to 1.0; got {total_w:.6f}")

    # 2. Normalization ceilings validation
    if "normalization" not in scoring or not isinstance(scoring["normalization"], dict):
        raise ConfigError("Configuration missing 'scoring.normalization' section")

    norms = _strip_comments(scoring["normalization"])
    required_norms = {"flood_percent_max", "exposed_buildings_max", "flood_area_m2_max"}
    for k in required_norms:
        if k not in norms:
            raise ConfigError(f"scoring.normalization missing required ceiling '{k}'")
        v = norms[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
            raise ConfigError(f"scoring.normalization['{k}'] must be a positive finite number; got {v!r}")

    # 3. Isolation scores validation
    if "isolation_score" not in scoring or not isinstance(scoring["isolation_score"], dict):
        raise ConfigError("Configuration missing 'scoring.isolation_score' section")

    iso = _strip_comments(scoring["isolation_score"])
    for cat in ACCESSIBILITY_VALUES:
        if cat not in iso:
            raise ConfigError(f"scoring.isolation_score missing required entry for '{cat}'")
        v = iso[cat]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not (0.0 <= v <= 1.0):
            raise ConfigError(f"scoring.isolation_score['{cat}'] must be a number in [0.0, 1.0]; got {v!r}")

    if not (iso["ACCESSIBLE"] <= iso["PARTIAL"] <= iso["BLOCKED"]):
        raise ConfigError(
            f"Isolation ordering constraint violated: expected ACCESSIBLE ({iso['ACCESSIBLE']}) <= "
            f"PARTIAL ({iso['PARTIAL']}) <= BLOCKED ({iso['BLOCKED']})"
        )
    if not (iso["UNKNOWN"] >= iso["PARTIAL"]):
        raise ConfigError(
            f"Isolation ordering constraint violated: expected UNKNOWN ({iso['UNKNOWN']}) >= "
            f"PARTIAL ({iso['PARTIAL']})"
        )

    # 4. Priority thresholds validation
    if "priority_thresholds" not in cfg or not isinstance(cfg["priority_thresholds"], dict):
        raise ConfigError("Configuration missing 'priority_thresholds' section")

    thresholds = _strip_comments(cfg["priority_thresholds"])
    for level in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        if level not in thresholds:
            raise ConfigError(f"priority_thresholds missing '{level}'")
        v = thresholds[level]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ConfigError(f"priority_thresholds['{level}'] must be a finite number; got {v!r}")

    if not (thresholds["CRITICAL"] > thresholds["HIGH"] > thresholds["MEDIUM"] > thresholds["LOW"] >= 0):
        raise ConfigError(
            f"Priority thresholds ordering violated: expected CRITICAL ({thresholds['CRITICAL']}) > "
            f"HIGH ({thresholds['HIGH']}) > MEDIUM ({thresholds['MEDIUM']}) > LOW ({thresholds['LOW']}) >= 0"
        )

    scoring["weights"] = weights
    scoring["normalization"] = norms
    scoring["isolation_score"] = iso
    cfg["priority_thresholds"] = thresholds

    return cfg


def load_config(config_path: Path | None = None) -> dict[str, Any]:
    """Load and validate scoring config from path or package defaults.

    First checks explicit config_path, then importlib.resources, then repository-relative fallbacks.
    """
    if config_path is not None:
        path = Path(config_path)
        if not path.is_file():
            raise ConfigError(f"Configuration file not found: {path}")
        with open(path, encoding="utf-8") as fh:
            try:
                raw_cfg = json.load(fh)
            except json.JSONDecodeError as exc:
                raise ConfigError(f"Configuration file {path} contains invalid JSON: {exc}") from exc
        return validate_config(raw_cfg)

    # Try importlib.resources
    raw_cfg = None
    try:
        ref = pkg_resources.files("risk_engine") / "weights.json"
        if ref.is_file():
            raw_cfg = json.loads(ref.read_text(encoding="utf-8"))
    except Exception:
        raw_cfg = None

    if raw_cfg is None:
        candidates = [
            Path(__file__).resolve().parent.parent.parent / "config" / "weights.json",
            Path(__file__).resolve().parent / "weights.json",
            Path("config/weights.json"),
            Path("modules/risk_engine/config/weights.json"),
        ]
        for c in candidates:
            if c.is_file():
                with open(c, encoding="utf-8") as fh:
                    raw_cfg = json.load(fh)
                break

    if raw_cfg is None:
        raise ConfigError("Default weights.json configuration could not be located")

    return validate_config(raw_cfg)


# ---------------------------------------------------------------------------
# Zone input loading + validation
# ---------------------------------------------------------------------------

def _is_finite_num(v: Any) -> bool:
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def _validate_geometry(
    zone_id: str,
    raw_geo: Any,
    expected_len: int,
    field_name: str,
    warnings: list[DataQualityWarning],
) -> list[float]:
    """Validate bbox or centroid coordinate list."""
    if not isinstance(raw_geo, (list, tuple)) or len(raw_geo) != expected_len:
        warnings.append(DataQualityWarning(
            zone_id=zone_id,
            field=field_name,
            issue=f"Invalid {field_name}: expected list of {expected_len} numbers; got {raw_geo!r}",
        ))
        return []

    for idx, c in enumerate(raw_geo):
        if not _is_finite_num(c):
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field=field_name,
                issue=f"Invalid {field_name}[{idx}]: expected finite coordinate number; got {c!r}",
            ))
            return []

    return [float(c) for c in raw_geo]


def load_zones(
    zones_json_path: Path,
    config: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[DataQualityWarning]]:
    """Load and validate a zones.json file produced by Module 2.

    Returns (zones_doc, warnings).
    Raises InputValidationError for structural and schema validation errors.
    """
    path = Path(zones_json_path)
    if not path.is_file():
        raise InputValidationError(f"zones.json not found: {path}")

    with open(path, encoding="utf-8") as fh:
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
    seen_ids: set[str] = set()
    coerced_zones: list[dict[str, Any]] = []

    cfg_dq = (config or {}).get("data_quality", {})
    on_neg_exposure = cfg_dq.get("on_negative_exposure", "error")

    for idx, zone in enumerate(zones):
        if not isinstance(zone, dict):
            raise InputValidationError(f"zones[{idx}] is not a JSON object")

        zone_id = zone.get("zone_id")
        if not isinstance(zone_id, str) or not zone_id.strip():
            raise InputValidationError(f"zones[{idx}]: 'zone_id' must be a non-empty string; got {zone_id!r}")
        if zone_id in seen_ids:
            raise InputValidationError(f"Duplicate zone_id: '{zone_id}'")
        seen_ids.add(zone_id)

        # 1. Required field checks
        for req in ("flooded_percent", "exposed_buildings", "accessibility"):
            if req not in zone or zone[req] is None:
                raise InputValidationError(f"Zone '{zone_id}', field '{req}': missing required field")

        # 2. flooded_percent validation
        fp = zone["flooded_percent"]
        if not _is_finite_num(fp):
            raise InputValidationError(
                f"Zone '{zone_id}', field 'flooded_percent': expected finite number, got {fp!r}"
            )
        fp_float = float(fp)
        if fp_float < 0.0 or fp_float > 100.0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_percent",
                issue=f"flooded_percent {fp_float} is outside [0, 100]; clamped",
            ))
            fp_float = max(0.0, min(100.0, fp_float))

        # 3. exposed_buildings validation
        eb = zone["exposed_buildings"]
        if isinstance(eb, bool) or not isinstance(eb, (int, float)):
            raise InputValidationError(
                f"Zone '{zone_id}', field 'exposed_buildings': expected integer, got {type(eb).__name__} ({eb!r})"
            )
        if isinstance(eb, float):
            if not eb.is_integer():
                raise InputValidationError(
                    f"Zone '{zone_id}', field 'exposed_buildings': non-integral float count {eb!r}"
                )
            eb_int = int(eb)
        else:
            eb_int = eb

        if eb_int < 0:
            if on_neg_exposure == "warn_zero":
                warnings.append(DataQualityWarning(
                    zone_id=zone_id,
                    field="exposed_buildings",
                    issue=f"exposed_buildings {eb_int} is negative; treated as 0",
                ))
                eb_int = 0
            else:
                raise InputValidationError(
                    f"Zone '{zone_id}', field 'exposed_buildings': negative exposure count {eb_int}"
                )

        # 4. accessibility validation
        acc = zone["accessibility"]
        if not isinstance(acc, str):
            raise InputValidationError(
                f"Zone '{zone_id}', field 'accessibility': expected string, got {type(acc).__name__}"
            )
        if acc not in ACCESSIBILITY_VALUES:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="accessibility",
                issue=f"Unrecognised accessibility value '{acc}'; treating as UNKNOWN",
            ))
            acc = "UNKNOWN"

        # 5. flooded_area_m2 validation (nullable)
        fam = zone.get("flooded_area_m2")
        fam_val: float | None
        if fam is None:
            fam_val = None
        elif not _is_finite_num(fam):
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_area_m2",
                issue=f"flooded_area_m2 is non-numeric or non-finite ({fam!r}); treated as null",
            ))
            fam_val = None
        elif fam < 0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_area_m2",
                issue=f"flooded_area_m2 {fam} is negative; treated as null",
            ))
            fam_val = None
        else:
            fam_val = float(fam)

        # 6. Optional numeric fields validation
        tb_raw = zone.get("total_buildings", 0)
        if tb_raw is None:
            tb_raw = 0
        if not _is_finite_num(tb_raw):
            raise InputValidationError(
                f"Zone '{zone_id}', field 'total_buildings': expected finite number, got {tb_raw!r}"
            )
        tb_int = int(tb_raw)
        if tb_int < 0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="total_buildings",
                issue=f"total_buildings {tb_int} is negative; treated as 0",
            ))
            tb_int = 0

        rl_raw = zone.get("road_length_m", 0.0)
        if rl_raw is None:
            rl_raw = 0.0
        if not _is_finite_num(rl_raw):
            raise InputValidationError(
                f"Zone '{zone_id}', field 'road_length_m': expected finite number, got {rl_raw!r}"
            )
        rl_float = float(rl_raw)
        if rl_float < 0.0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="road_length_m",
                issue=f"road_length_m {rl_float} is negative; treated as 0.0",
            ))
            rl_float = 0.0

        frl_raw = zone.get("flooded_road_length_m", 0.0)
        if frl_raw is None:
            frl_raw = 0.0
        if not _is_finite_num(frl_raw):
            raise InputValidationError(
                f"Zone '{zone_id}', field 'flooded_road_length_m': expected finite number, got {frl_raw!r}"
            )
        frl_float = float(frl_raw)
        if frl_float < 0.0:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_road_length_m",
                issue=f"flooded_road_length_m {frl_float} is negative; treated as 0.0",
            ))
            frl_float = 0.0

        # Cross-field checks
        if rl_float > 0 and frl_float > rl_float:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="flooded_road_length_m",
                issue=f"flooded_road_length_m ({frl_float}) exceeds total road_length_m ({rl_float}); clamped ratio to 100%",
            ))

        if tb_int > 0 and eb_int > tb_int:
            warnings.append(DataQualityWarning(
                zone_id=zone_id,
                field="exposed_buildings",
                issue=f"exposed_buildings ({eb_int}) exceeds total_buildings ({tb_int}); clamped ratio to 100%",
            ))

        # Geometry validation
        centroid_clean = _validate_geometry(zone_id, zone.get("centroid", []), 2, "centroid", warnings)
        bbox_clean = _validate_geometry(zone_id, zone.get("bbox", []), 4, "bbox", warnings)

        coerced = dict(zone)
        coerced["zone_id"] = zone_id
        coerced["flooded_percent"] = fp_float
        coerced["exposed_buildings"] = eb_int
        coerced["accessibility"] = acc
        coerced["flooded_area_m2"] = fam_val
        coerced["total_buildings"] = tb_int
        coerced["road_length_m"] = rl_float
        coerced["flooded_road_length_m"] = frl_float
        coerced["centroid"] = centroid_clean
        coerced["bbox"] = bbox_clean
        coerced_zones.append(coerced)

    result_doc = dict(doc)
    result_doc["zones"] = coerced_zones
    return result_doc, warnings


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _natural_sort_key(s: str) -> list[int | str]:
    """Sort key for natural sort ordering (e.g. zone-2 before zone-10)."""
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", s)]


def _priority_label(score: float, thresholds: dict[str, Any]) -> str:
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
    has_flood_area: bool,
    cfg_dq: dict[str, Any],
) -> list[str]:
    """Generate human-readable explanations for score components."""
    reasons: list[str] = []

    fp = zone["flooded_percent"]
    eb = zone["exposed_buildings"]
    tb = zone["total_buildings"]
    acc = zone["accessibility"]
    fam = zone.get("flooded_area_m2")
    rl = zone.get("road_length_m", 0.0)
    frl = zone.get("flooded_road_length_m", 0.0)

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
        if rl <= 0:
            reasons.append(
                "Zone roads are BLOCKED (No road length recorded; cannot compute % flooded) "
                "— reaching this zone is severely restricted (road isolation penalty applied)"
            )
        else:
            frl_pct = min(100.0, (frl / rl * 100))
            reasons.append(
                f"Zone roads are {frl_pct:.0f}% flooded — reaching this zone "
                f"is severely restricted (road isolation penalty applied)"
            )
    elif acc == "PARTIAL":
        if rl <= 0:
            reasons.append(
                "Zone roads are PARTIAL (No road length recorded; cannot compute % flooded) "
                "— partial road isolation penalty applied"
            )
        else:
            frl_pct = min(100.0, (frl / rl * 100))
            reasons.append(
                f"Zone roads are {frl_pct:.0f}% flooded — partial road isolation penalty applied"
            )
    elif acc == "UNKNOWN":
        reasons.append(
            "No road data for this zone — isolation status unknown (intermediate penalty applied)"
        )
    else:
        reasons.append("Roads in this zone are not significantly flooded")

    if has_flood_area and fam is not None and fam > 0:
        reasons.append(f"Derived flood-extent area: {fam:.0f} m²")

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
    """Collect per-zone warning strings from global warnings and heuristic flags."""
    zid = zone["zone_id"]
    msgs: list[str] = [w.issue for w in global_warnings if w.zone_id == zid]

    acc = zone["accessibility"]
    fp = zone["flooded_percent"]
    eb = zone["exposed_buildings"]
    warn_thresh = cfg_dq.get("warn_on_zero_exposure_with_high_flood_percent_threshold", 5.0)

    # Emit exactly one warning for UNKNOWN accessibility
    if acc == "UNKNOWN" and cfg_dq.get("warn_on_unknown_accessibility", True):
        msg = "accessibility=UNKNOWN: no road data; isolation status cannot be determined"
        if msg not in msgs:
            msgs.append(msg)

    if eb == 0 and fp >= warn_thresh:
        msg = (
            f"flooded_percent={fp:.1f}% but exposed_buildings=0: "
            f"flood extent may not coincide with recorded building footprints"
        )
        if msg not in msgs:
            msgs.append(msg)

    return msgs


def score_zones(
    zones_doc: dict[str, Any],
    config: dict[str, Any],
    global_warnings: list[DataQualityWarning],
) -> list[ZoneRiskRecord]:
    """Compute risk scores for all zones and rank them deterministically.

    Ranking Order:
        1. Unrounded raw score descending
        2. Exposed buildings descending
        3. Flooded percentage descending
        4. Natural-sort zone_id ascending
    """
    weights_clean = _strip_comments(config["scoring"]["weights"])
    norms = _strip_comments(config["scoring"]["normalization"])
    iso_scores = _strip_comments(config["scoring"]["isolation_score"])
    thresholds = _strip_comments(config["priority_thresholds"])
    cfg_dq = config.get("data_quality", {})

    warn_on_null_area = cfg_dq.get("warn_on_null_flooded_area_m2", True)

    records: list[ZoneRiskRecord] = []

    for zone in zones_doc["zones"]:
        zid = zone["zone_id"]
        fp = float(zone["flooded_percent"])
        eb = int(zone["exposed_buildings"])
        tb = int(zone.get("total_buildings", 0))
        acc = zone["accessibility"]
        fam = zone.get("flooded_area_m2")

        # 1. Component normalization [0.0, 1.0]
        flood_c = min(fp / norms["flood_percent_max"], 1.0)
        exposure_c = min(eb / norms["exposed_buildings_max"], 1.0)
        isolation_c = iso_scores.get(acc, iso_scores["UNKNOWN"])
        exp_frac_c = min(1.0, max(0.0, eb / tb)) if tb > 0 else 0.0

        # 2. Handling missing flooded_area_m2:
        # Score as 0 ONLY when flooded_percent == 0.
        # If null while flooded_percent > 0, drop component and renormalize remaining weights.
        zone_warnings = _build_zone_warnings(zone, global_warnings, cfg_dq)

        if fam is not None and fam >= 0.0:
            flood_area_c = min(float(fam) / norms["flood_area_m2_max"], 1.0)
            score_basis = "full"
            omitted_components: list[str] = []
            active_weights = dict(weights_clean)
            has_flood_area = True
        elif fp == 0.0:
            # flooded_percent == 0 and flooded_area_m2 is null: score as 0 without dropping component
            flood_area_c = 0.0
            score_basis = "full"
            omitted_components = []
            active_weights = dict(weights_clean)
            has_flood_area = False
        else:
            # Inconsistent: flooded_area_m2 is null/invalid while flooded_percent > 0
            flood_area_c = 0.0
            score_basis = "partial"
            omitted_components = ["flood_area_density"]
            has_flood_area = False
            active_weights = {k: v for k, v in weights_clean.items() if k != "flood_area_density"}
            rem_sum = sum(active_weights.values())
            if rem_sum > 0:
                active_weights = {k: v / rem_sum for k, v in active_weights.items()}
            if warn_on_null_area:
                warn_msg = (
                    "flooded_area_m2 is null while flooded_percent > 0; "
                    "omitted flood_area_density component and renormalized remaining weights"
                )
                if warn_msg not in zone_warnings:
                    zone_warnings.append(warn_msg)

        # 3. Compute raw score
        raw = (
            active_weights.get("flood_percent", 0.0) * flood_c
            + active_weights.get("exposure", 0.0) * exposure_c
            + active_weights.get("isolation", 0.0) * isolation_c
            + active_weights.get("flood_area_density", 0.0) * flood_area_c
            + active_weights.get("exposure_fraction", 0.0) * exp_frac_c
        )
        raw = max(0.0, min(1.0, raw))
        score = round(raw * 100, 1)

        priority = _priority_label(score, thresholds)
        reasons = _build_reasons(zone, flood_c, has_flood_area, cfg_dq)

        records.append(ZoneRiskRecord(
            zone_id=zid,
            rank=0,
            score=score,
            priority=priority,
            raw_score=raw,
            reasons=reasons,
            warnings=zone_warnings,
            score_basis=score_basis,
            omitted_components=omitted_components,
            flood_percent_component=round(flood_c, 4),
            exposure_component=round(exposure_c, 4),
            isolation_component=round(isolation_c, 4),
            flood_area_component=round(flood_area_c, 4),
            exposure_fraction_component=round(exp_frac_c, 4),
            flooded_percent=fp,
            exposed_buildings=eb,
            total_buildings=tb,
            accessibility=acc,
            road_length_m=float(zone.get("road_length_m", 0.0)),
            flooded_road_length_m=float(zone.get("flooded_road_length_m", 0.0)),
            flooded_area_m2=float(fam) if fam is not None else 0.0,
            centroid=list(zone.get("centroid") or []),
            bbox=list(zone.get("bbox") or []),
        ))

    # Deterministic Ranking
    records.sort(
        key=lambda r: (
            -r.raw_score,
            -r.exposed_buildings,
            -r.flooded_percent,
            _natural_sort_key(r.zone_id),
        )
    )

    for i, rec in enumerate(records, start=1):
        rec.rank = i

    return records


# ---------------------------------------------------------------------------
# Output serialisation & Dashboard Exporter
# ---------------------------------------------------------------------------

OUTPUT_SCHEMA_VERSION = "1.1"


def records_to_dict(
    records: list[ZoneRiskRecord],
    global_warnings: list[DataQualityWarning],
    source_doc: dict[str, Any],
    config: dict[str, Any],
    input_file_sha256: str | None = None,
) -> dict[str, Any]:
    """Serialise scored records to a dictionary matching the output contract."""
    weights = _strip_comments(config["scoring"]["weights"])
    norms = _strip_comments(config["scoring"]["normalization"])
    thresholds = _strip_comments(config["priority_thresholds"])
    config_ver = config.get("config_version", "1.0")

    effective_config_clean = {
        "config_version": config_ver,
        "scoring": {
            "weights": weights,
            "normalization": norms,
            "isolation_score": _strip_comments(config["scoring"]["isolation_score"]),
        },
        "priority_thresholds": thresholds,
    }
    cfg_hash = hashlib.sha256(
        json.dumps(effective_config_clean, sort_keys=True).encode("utf-8")
    ).hexdigest()

    if input_file_sha256 is None:
        input_file_sha256 = hashlib.sha256(
            json.dumps(source_doc, sort_keys=True).encode("utf-8")
        ).hexdigest()

    now_utc = datetime.now(timezone.utc).isoformat()
    crs_val = source_doc.get("crs", "unknown")

    # Build disclaimer based on context hierarchy
    disclaimer_ctx = config.get("disclaimer_context")
    if not disclaimer_ctx:
        disclaimer_ctx = (
            source_doc.get("disclaimer_context")
            or source_doc.get("context")
            or source_doc.get("event")
            or source_doc.get("source")
        )

    if disclaimer_ctx:
        disclaimer = (
            f"PROVISIONAL DECISION-SUPPORT HEURISTIC — scores reflect configurable weightings "
            f"applied to flood analysis labels for {disclaimer_ctx}. They have NOT been validated against "
            f"historical flood casualties or response outcomes. Do not treat scores as predictions "
            f"of life-safety risk. Road accessibility data indicates zone isolation only — it makes "
            f"no claim about route safety."
        )
    else:
        disclaimer = (
            "PROVISIONAL DECISION-SUPPORT HEURISTIC — scores reflect configurable weightings "
            "applied to flood analysis labels. They have NOT been validated against historical flood "
            "casualties or response outcomes. Do not treat scores as predictions of life-safety risk. "
            "Road accessibility data indicates zone isolation only — it makes no claim about route safety."
        )

    scored_zones = []
    for r in records:
        scored_zones.append({
            "rank": r.rank,
            "zone_id": r.zone_id,
            "score": r.score,
            "priority": r.priority,
            "score_basis": r.score_basis,
            "omitted_components": r.omitted_components,
            "reasons": r.reasons,
            "warnings": r.warnings,
            "score_components": {
                "flood_percent": r.flood_percent_component,
                "exposure": r.exposure_component,
                "isolation": r.isolation_component,
                "flood_area_density": r.flood_area_component,
                "exposure_fraction": r.exposure_fraction_component,
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
                "crs": crs_val,
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
        "generated_at": now_utc,
        "disclaimer": disclaimer,
        "source_metadata": {
            "input_schema_version": source_doc.get("schema_version", "unknown"),
            "input_source": source_doc.get("source", "unknown"),
            "input_crs": crs_val,
            "input_file_sha256": input_file_sha256,
            "config_hash_sha256": cfg_hash,
        },
        "scoring_config": {
            "config_version": config_ver,
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


def export_dashboard(
    output_dict: dict[str, Any],
    source_doc: dict[str, Any],
    data_mode: str = "historical",
) -> dict[str, Any]:
    """Export scored zones matching dashboard architecture section 5.1."""
    study_area = (
        source_doc.get("study_area")
        or source_doc.get("source")
        or output_dict.get("source_metadata", {}).get("input_source")
        or "unknown"
    )

    dashboard_zones = []
    for z in output_dict["ranked_zones"]:
        inp = z["inputs"]
        bbox = z["geometry"]["bbox"]

        # Build closed GeoJSON Polygon ring from bbox [min_lng, min_lat, max_lng, max_lat]
        if isinstance(bbox, list) and len(bbox) == 4:
            min_lng, min_lat, max_lng, max_lat = bbox
            coordinates = [
                [
                    [min_lng, min_lat],
                    [max_lng, min_lat],
                    [max_lng, max_lat],
                    [min_lng, max_lat],
                    [min_lng, min_lat],
                ]
            ]
            geometry = {
                "type": "Polygon",
                "coordinates": coordinates,
            }
        else:
            geometry = {
                "type": "Polygon",
                "coordinates": [],
            }

        acc_raw = inp.get("accessibility", "UNKNOWN")
        acc_mapped = ACCESSIBILITY_DASHBOARD_MAP.get(acc_raw, "UNKNOWN")

        fam_m2 = inp.get("flooded_area_m2") or 0.0
        fam_km2 = round(fam_m2 / 1e6, 6)

        dashboard_zones.append({
            "zone_id": z["zone_id"],
            "name": f"Zone {z['zone_id']}",
            "risk_level": z["priority"],
            "risk_score": round(float(z["score"]), 1),
            "flooded_percent": float(inp.get("flooded_percent", 0.0)),
            "flooded_area_km2": fam_km2,
            "exposed_buildings": int(inp.get("exposed_buildings", 0)),
            "total_buildings": int(inp.get("total_buildings", 0)),
            "accessibility": acc_mapped,
            "reasons": z.get("reasons", []),
            "geometry": geometry,
        })

    return {
        "schema_version": "1.1",
        "generated_at": output_dict.get("generated_at", datetime.now(timezone.utc).isoformat()),
        "data_mode": data_mode,
        "study_area": study_area,
        "score_scale": "0-100",
        "zones": dashboard_zones,
    }
