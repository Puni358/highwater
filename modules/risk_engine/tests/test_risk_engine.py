"""Pytest test suite for HighWater Module 3 — Risk & Prioritization Engine.

Preserves and strengthens existing tests, and covers all Stage 1, Stage 2, and Stage 3
requirements, including property-based tests via Hypothesis.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
from typing import Any

import pytest
from hypothesis import given, strategies as st, settings

from risk_engine.cli import main as cli_main, run as cli_run
from risk_engine.scorer import (
    ACCESSIBILITY_VALUES,
    ACCESSIBILITY_DASHBOARD_MAP,
    ConfigError,
    DataQualityWarning,
    InputValidationError,
    ZoneRiskRecord,
    _natural_sort_key,
    _priority_label,
    export_dashboard,
    load_config,
    load_zones,
    records_to_dict,
    score_zones,
    validate_config,
)
MODULE_ROOT = pathlib.Path(__file__).parent.parent
REAL_ZONES_PATH = MODULE_ROOT.parent / "flood_analysis" / "output" / "zones.json"
DEFAULT_CONFIG_PATH = MODULE_ROOT / "config" / "weights.json"

import importlib.util

def _load_tool_module(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

_sens_path = MODULE_ROOT / "tools" / "sensitivity.py"
if not _sens_path.exists():
    _sens_path = MODULE_ROOT.parent.parent / "tools" / "sensitivity.py"
_sens_mod = _load_tool_module("sensitivity", _sens_path)
compute_kendall_tau = _sens_mod.compute_kendall_tau
run_sensitivity_analysis = _sens_mod.run_sensitivity_analysis

_calib_path = MODULE_ROOT / "tools" / "calibrate.py"
if not _calib_path.exists():
    _calib_path = MODULE_ROOT.parent.parent / "tools" / "calibrate.py"
_calib_mod = _load_tool_module("calibrate", _calib_path)
analyze_calibration = _calib_mod.analyze_calibration


@pytest.fixture()
def default_config() -> dict[str, Any]:
    return load_config(DEFAULT_CONFIG_PATH)


def _make_zone(**kwargs) -> dict[str, Any]:
    """Return a minimal valid zone dict; keyword args override defaults."""
    base = {
        "zone_id": "zone-001",
        "bbox": [7.0, 50.5, 7.01, 50.51],
        "centroid": [7.005, 50.505],
        "flooded_percent": 10.0,
        "flooded_area_m2": 5000.0,
        "total_buildings": 20,
        "exposed_buildings": 5,
        "road_length_m": 400.0,
        "flooded_road_length_m": 100.0,
        "accessibility": "PARTIAL",
    }
    base.update(kwargs)
    return base


def _make_zones_doc(*zones) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "source": "test",
        "crs": "EPSG:4326",
        "zones": list(zones),
    }


def _write_zones(tmp_path: pathlib.Path, *zones) -> pathlib.Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    p = tmp_path / "zones.json"
    p.write_text(json.dumps(_make_zones_doc(*zones)), encoding="utf-8")
    return p


# ===========================================================================
# 1. Config loading & Configuration Validation Rules
# ===========================================================================

class TestConfigLoadingAndValidation:
    def test_default_config_loads(self, default_config):
        assert "scoring" in default_config
        assert "priority_thresholds" in default_config
        assert default_config.get("config_version") == "1.0"

    def test_weights_sum_to_one(self, default_config):
        weights = default_config["scoring"]["weights"]
        total = sum(v for k, v in weights.items() if not k.startswith("_"))
        assert math.isclose(total, 1.0, rel_tol=1e-6), f"Weights sum to {total}"

    def test_isolation_scores_in_range(self, default_config):
        for cat, val in default_config["scoring"]["isolation_score"].items():
            if cat.startswith("_"):
                continue
            assert 0.0 <= val <= 1.0, f"isolation_score[{cat!r}] = {val} out of [0,1]"

    def test_all_accessibility_values_covered(self, default_config):
        iso = default_config["scoring"]["isolation_score"]
        for cat in ACCESSIBILITY_VALUES:
            assert cat in iso, f"Missing isolation_score entry for '{cat}'"

    def test_normalization_ceilings_positive(self, default_config):
        norms = default_config["scoring"]["normalization"]
        for k, v in norms.items():
            if not k.startswith("_"):
                assert v > 0, f"Normalisation ceiling '{k}' must be > 0"

    def test_missing_config_file_raises(self, tmp_path):
        with pytest.raises((ConfigError, FileNotFoundError)):
            load_config(tmp_path / "nonexistent.json")

    def test_weight_sum_mismatch_raises(self, tmp_path, default_config):
        cfg = json.loads(json.dumps(default_config))
        cfg["scoring"]["weights"]["flood_percent"] += 0.5
        p = tmp_path / "bad_weights.json"
        p.write_text(json.dumps(cfg), encoding="utf-8")
        with pytest.raises(ConfigError, match="sum to 1.0"):
            load_config(p)

    def test_config_loading_independent_of_cwd(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        cfg = load_config()
        assert cfg.get("config_version") == "1.0"
        assert "weights" in cfg["scoring"]

    def test_config_missing_scoring_section_raises(self):
        with pytest.raises(ConfigError, match="missing 'scoring'"):
            validate_config({"priority_thresholds": {}})

    def test_config_missing_weights_section_raises(self):
        with pytest.raises(ConfigError, match="missing 'scoring.weights'"):
            validate_config({"scoring": {}})

    def test_config_missing_weight_key_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        del cfg["scoring"]["weights"]["flood_percent"]
        with pytest.raises(ConfigError, match="missing required keys"):
            validate_config(cfg)

    def test_config_optional_exposure_fraction_defaults(self, default_config):
        cfg = copy.deepcopy(default_config)
        del cfg["scoring"]["weights"]["exposure_fraction"]
        validated = validate_config(cfg)
        assert validated["scoring"]["weights"].get("exposure_fraction", 0.0) == 0.0

    def test_config_extra_weight_key_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["weights"]["extra_metric"] = 0.0
        with pytest.raises(ConfigError, match="unexpected extra"):
            validate_config(cfg)

    def test_config_negative_weight_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["weights"]["flood_percent"] = -0.1
        cfg["scoring"]["weights"]["exposure"] = 0.85
        with pytest.raises(ConfigError, match="non-negative"):
            validate_config(cfg)

    def test_config_non_numeric_weight_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["weights"]["flood_percent"] = True  # boolean check
        with pytest.raises(ConfigError, match="finite number"):
            validate_config(cfg)

    def test_config_missing_normalization_ceiling_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        del cfg["scoring"]["normalization"]["flood_percent_max"]
        with pytest.raises(ConfigError, match="missing required ceiling"):
            validate_config(cfg)

    def test_config_non_positive_normalization_ceiling_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["normalization"]["flood_percent_max"] = 0.0
        with pytest.raises(ConfigError, match="positive finite number"):
            validate_config(cfg)

    def test_config_missing_isolation_score_category_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        del cfg["scoring"]["isolation_score"]["BLOCKED"]
        with pytest.raises(ConfigError, match="missing required entry for 'BLOCKED'"):
            validate_config(cfg)

    def test_config_isolation_score_out_of_range_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["isolation_score"]["BLOCKED"] = 1.5
        with pytest.raises(ConfigError, match=r"\[0\.0, 1\.0\]"):
            validate_config(cfg)

    def test_config_isolation_ordering_accessible_partial_blocked_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["isolation_score"]["ACCESSIBLE"] = 0.8
        cfg["scoring"]["isolation_score"]["PARTIAL"] = 0.5
        with pytest.raises(ConfigError, match="Isolation ordering constraint violated"):
            validate_config(cfg)

    def test_config_isolation_ordering_unknown_partial_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["isolation_score"]["UNKNOWN"] = 0.2  # less than PARTIAL 0.5
        with pytest.raises(ConfigError, match="Isolation ordering constraint violated"):
            validate_config(cfg)

    def test_config_priority_thresholds_missing_key_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        del cfg["priority_thresholds"]["CRITICAL"]
        with pytest.raises(ConfigError, match="missing 'CRITICAL'"):
            validate_config(cfg)

    def test_config_priority_thresholds_ordering_raises(self, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["priority_thresholds"]["CRITICAL"] = 40
        cfg["priority_thresholds"]["HIGH"] = 50
        with pytest.raises(ConfigError, match="Priority thresholds ordering violated"):
            validate_config(cfg)

    def test_comment_inside_weights_does_not_crash(self, default_config, tmp_path):
        cfg = copy.deepcopy(default_config)
        cfg["scoring"]["weights"]["_comment"] = "Comment explaining weights"
        validated = validate_config(cfg)
        assert "_comment" not in validated["scoring"]["weights"]
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, validated, warnings)
        output = records_to_dict(records, warnings, doc, validated)
        assert "_comment" not in output["scoring_config"]["weights"]


# ===========================================================================
# 2. Input Loading, Validation & Type Checks
# ===========================================================================

class TestInputLoadingAndValidation:
    def test_valid_zones_doc_loads(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        assert len(doc["zones"]) == 1
        assert warnings == []

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(InputValidationError):
            load_zones(tmp_path / "not_there.json")

    def test_invalid_json_raises(self, tmp_path):
        p = tmp_path / "broken.json"
        p.write_text("{not valid json", encoding="utf-8")
        with pytest.raises(InputValidationError):
            load_zones(p)

    def test_missing_zones_key_raises(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text(json.dumps({"schema_version": "1.0"}), encoding="utf-8")
        with pytest.raises(InputValidationError):
            load_zones(p)

    def test_non_list_zones_raises(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text(json.dumps({"zones": "not a list"}), encoding="utf-8")
        with pytest.raises(InputValidationError):
            load_zones(p)

    def test_empty_zones_list_is_valid(self, tmp_path):
        p = tmp_path / "empty.json"
        p.write_text(json.dumps({"zones": []}), encoding="utf-8")
        doc, warnings = load_zones(p)
        assert doc["zones"] == []

    def test_duplicate_zone_id_raises(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(zone_id="zone-001"), _make_zone(zone_id="zone-001"))
        with pytest.raises(InputValidationError, match="Duplicate zone_id"):
            load_zones(p)

    def test_null_flooded_area_m2_becomes_none_with_partial_scoring(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone(flooded_area_m2=None))
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["flooded_area_m2"] is None
        records = score_zones(doc, default_config, warnings)
        assert records[0].score_basis == "partial"
        assert records[0].omitted_components == ["flood_area_density"]

    def test_unknown_accessibility_becomes_warning(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(accessibility="IMPASSABLE"))
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["accessibility"] == "UNKNOWN"
        assert any(w.field == "accessibility" for w in warnings)

    def test_unknown_accessibility_produces_exactly_one_warning(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone(accessibility="UNKNOWN"))
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        acc_warns = [w for w in records[0].warnings if "accessibility" in w.lower()]
        assert len(acc_warns) == 1

    def test_flooded_percent_out_of_range_clamped_with_warning(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(flooded_percent=150.0))
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["flooded_percent"] == 100.0
        assert any(w.field == "flooded_percent" for w in warnings)

    def test_missing_required_field_raises(self, tmp_path):
        zone = _make_zone()
        del zone["exposed_buildings"]
        p = _write_zones(tmp_path, zone)
        with pytest.raises(InputValidationError, match="exposed_buildings"):
            load_zones(p)

    def test_non_object_in_zones_array_raises(self, tmp_path):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": ["a string"]}), encoding="utf-8")
        with pytest.raises(InputValidationError):
            load_zones(p)

    def test_integral_float_exposure_accepted(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(exposed_buildings=5.0))
        doc, warnings = load_zones(p)
        assert isinstance(doc["zones"][0]["exposed_buildings"], int)
        assert doc["zones"][0]["exposed_buildings"] == 5

    def test_non_integral_float_exposure_raises(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(exposed_buildings=5.3))
        with pytest.raises(InputValidationError, match="non-integral float"):
            load_zones(p)

    def test_booleans_in_numeric_fields_raise(self, tmp_path):
        # Python bool is subclass of int; must be strictly rejected
        for field, val in [
            ("flooded_percent", True),
            ("exposed_buildings", False),
            ("road_length_m", True),
            ("flooded_road_length_m", False),
            ("total_buildings", True),
        ]:
            zone = _make_zone(**{field: val})
            p = _write_zones(tmp_path, zone)
            with pytest.raises(InputValidationError, match=field):
                load_zones(p)

    def test_nan_inf_numeric_fields_raise(self, tmp_path):
        for bad_val in (float("nan"), float("inf"), float("-inf")):
            p = _write_zones(tmp_path, _make_zone(flooded_percent=bad_val))
            with pytest.raises(InputValidationError, match="flooded_percent"):
                load_zones(p)

    def test_invalid_centroid_and_bbox_handled_with_warnings(self, tmp_path):
        zone = _make_zone(
            centroid=[7.0],  # expected length 2
            bbox=[7.0, 50.0, True, 50.1],  # boolean inside coordinates
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["centroid"] == []
        assert doc["zones"][0]["bbox"] == []
        warn_fields = {w.field for w in warnings}
        assert "centroid" in warn_fields
        assert "bbox" in warn_fields

    def test_negative_exposure_strict_vs_warn_zero(self, tmp_path):
        zone = _make_zone(exposed_buildings=-5)
        p = _write_zones(tmp_path, zone)
        # Default: strict failure
        with pytest.raises(InputValidationError, match="negative exposure"):
            load_zones(p)
        # Configured: on_negative_exposure="warn_zero"
        cfg = {"data_quality": {"on_negative_exposure": "warn_zero"}}
        doc, warnings = load_zones(p, config=cfg)
        assert doc["zones"][0]["exposed_buildings"] == 0
        assert any(w.field == "exposed_buildings" for w in warnings)

    def test_cross_field_road_and_building_overflows(self, tmp_path, default_config):
        zone = _make_zone(
            road_length_m=100.0,
            flooded_road_length_m=150.0,
            total_buildings=10,
            exposed_buildings=15,
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        warn_issues = [w.issue for w in warnings]
        assert any("exceeds total road_length_m" in issue for issue in warn_issues)
        assert any("exceeds total_buildings" in issue for issue in warn_issues)

        # Ensure priority is not silently compromised and component clamped to 1.0
        records = score_zones(doc, default_config, warnings)
        assert records[0].exposure_fraction_component == 1.0

    def test_negative_road_and_building_lengths_warn_and_clamped(self, tmp_path):
        zone = _make_zone(
            road_length_m=-50.0,
            flooded_road_length_m=-10.0,
            total_buildings=-5,
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["road_length_m"] == 0.0
        assert doc["zones"][0]["flooded_road_length_m"] == 0.0
        assert doc["zones"][0]["total_buildings"] == 0
        fields = {w.field for w in warnings}
        assert {"road_length_m", "flooded_road_length_m", "total_buildings"}.issubset(fields)


# ===========================================================================
# 3. Reasons & Explanations
# ===========================================================================

class TestReasonsAndExplanations:
    def test_zero_road_length_reasons_never_claim_100_percent(self, tmp_path, default_config):
        # BLOCKED with 0 road length
        zone_blocked = _make_zone(
            zone_id="zone-b",
            road_length_m=0.0,
            flooded_road_length_m=0.0,
            accessibility="BLOCKED",
        )
        # PARTIAL with 0 road length
        zone_partial = _make_zone(
            zone_id="zone-p",
            road_length_m=0.0,
            flooded_road_length_m=0.0,
            accessibility="PARTIAL",
        )
        p = _write_zones(tmp_path, zone_blocked, zone_partial)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)

        for r in records:
            all_reasons = " ".join(r.reasons)
            assert "No road length recorded; cannot compute % flooded" in all_reasons
            assert "100% flooded" not in all_reasons


# ===========================================================================
# 4. Scoring, Ranking & Determinism
# ===========================================================================

class TestScoringAndRanking:
    def test_score_in_bounds(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert 0.0 <= records[0].score <= 100.0

    def test_score_is_deterministic(self, tmp_path, default_config):
        z1 = _make_zone(zone_id="z1", exposed_buildings=10, flooded_percent=5.0)
        z2 = _make_zone(zone_id="z2", exposed_buildings=40, flooded_percent=25.0)
        p1 = _write_zones(tmp_path / "run1", z1, z2)
        p2 = _write_zones(tmp_path / "run2", z2, z1)
        doc1, w1 = load_zones(p1)
        doc2, w2 = load_zones(p2)
        r1 = score_zones(doc1, default_config, w1)
        r2 = score_zones(doc2, default_config, w2)
        assert [r.zone_id for r in r1] == [r.zone_id for r in r2]
        assert [r.score for r in r1] == [r.score for r in r2]
        assert [r.reasons for r in r1] == [r.reasons for r in r2]

    def test_high_flood_percent_zero_exposure(self, tmp_path, default_config):
        z = _make_zone(flooded_percent=25.0, exposed_buildings=0)
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert any("exposed_buildings=0" in w for w in records[0].warnings)

    def test_higher_exposure_raises_score(self, tmp_path, default_config):
        z_low = _make_zone(zone_id="z-low", exposed_buildings=2)
        z_high = _make_zone(zone_id="z-high", exposed_buildings=50)
        p = _write_zones(tmp_path, z_low, z_high)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        by_id = {r.zone_id: r for r in records}
        assert by_id["z-high"].score > by_id["z-low"].score

    def test_blocked_accessibility_raises_score_vs_accessible(self, tmp_path, default_config):
        z_acc = _make_zone(zone_id="z-acc", accessibility="ACCESSIBLE")
        z_blk = _make_zone(zone_id="z-blk", accessibility="BLOCKED")
        p = _write_zones(tmp_path, z_acc, z_blk)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        by_id = {r.zone_id: r for r in records}
        assert by_id["z-blk"].score > by_id["z-acc"].score

    def test_zero_exposure_zero_flood_gives_low_or_medium_score(self, tmp_path, default_config):
        z = _make_zone(flooded_percent=0.0, exposed_buildings=0, flooded_area_m2=0.0, accessibility="ACCESSIBLE")
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        record = score_zones(doc, default_config, warnings)[0]
        assert record.score == 0.0
        assert record.priority == "LOW"

    def test_max_exposure_max_flood_gives_high_score(self, tmp_path, default_config):
        z = _make_zone(
            flooded_percent=100.0,
            exposed_buildings=200,
            flooded_area_m2=50000.0,
            accessibility="BLOCKED",
            total_buildings=200,
        )
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        record = score_zones(doc, default_config, warnings)[0]
        assert record.score == 100.0
        assert record.priority == "CRITICAL"

    def test_score_capped_at_100(self, tmp_path, default_config):
        z = _make_zone(
            flooded_percent=100.0,
            exposed_buildings=500,
            flooded_area_m2=100000.0,
            accessibility="BLOCKED",
        )
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        record = score_zones(doc, default_config, warnings)[0]
        assert record.score == 100.0

    def test_ranking_is_descending(self, tmp_path, default_config):
        zones = [
            _make_zone(zone_id="z1", exposed_buildings=5),
            _make_zone(zone_id="z2", exposed_buildings=60),
            _make_zone(zone_id="z3", exposed_buildings=20),
        ]
        p = _write_zones(tmp_path, *zones)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        scores = [r.score for r in records]
        assert scores == sorted(scores, reverse=True)

    def test_rank_values_are_sequential(self, tmp_path, default_config):
        zones = [_make_zone(zone_id=f"z{i}", exposed_buildings=i * 5) for i in range(5)]
        p = _write_zones(tmp_path, *zones)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert [r.rank for r in records] == [1, 2, 3, 4, 5]

    def test_natural_sort_tie_ordering(self, tmp_path, default_config):
        # Two identical zones where zone-2 should precede zone-10
        z10 = _make_zone(zone_id="zone-10", exposed_buildings=10)
        z2 = _make_zone(zone_id="zone-2", exposed_buildings=10)
        p = _write_zones(tmp_path, z10, z2)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records[0].zone_id == "zone-2"
        assert records[1].zone_id == "zone-10"
        assert records[0].rank == 1
        assert records[1].rank == 2

    def test_tie_breaking_raw_score_vs_exposed_vs_flood_percent(self, tmp_path, default_config):
        # Tied rounded score, but higher exposed buildings
        z_a = _make_zone(zone_id="zone-a", exposed_buildings=25, flooded_percent=5.0)
        z_b = _make_zone(zone_id="zone-b", exposed_buildings=10, flooded_percent=20.0)
        p = _write_zones(tmp_path, z_a, z_b)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        # All receive distinct sequential ranks
        assert len({r.rank for r in records}) == 2
        assert [r.rank for r in records] == [1, 2]

    def test_empty_input_returns_empty_list(self, tmp_path, default_config):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": []}), encoding="utf-8")
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records == []


# ===========================================================================
# 5. Missing Flood Area & Partial Scoring
# ===========================================================================

class TestPartialScoring:
    def test_null_area_when_flooded_percent_zero_scores_full(self, tmp_path, default_config):
        """When flooded_percent == 0 and flooded_area_m2 is null, score as 0 without dropping component."""
        z = _make_zone(
            flooded_percent=0.0,
            exposed_buildings=10,
            accessibility="PARTIAL",
            total_buildings=20,
            flooded_area_m2=None,
        )
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        rec = records[0]
        assert rec.score_basis == "full"
        assert rec.omitted_components == []
        assert rec.flood_area_component == 0.0

    def test_null_area_partial_score_renormalization(self, tmp_path, default_config):
        """When flooded_percent > 0 and flooded_area_m2 is null, drop component and renormalize."""
        z = _make_zone(
            flooded_percent=15.0,
            exposed_buildings=30,
            accessibility="PARTIAL",
            total_buildings=50,
            flooded_area_m2=None,
        )
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        rec = records[0]

        assert rec.score_basis == "partial"
        assert rec.omitted_components == ["flood_area_density"]
        assert rec.flood_area_component == 0.0

        # Verify weights were renormalized
        weights = default_config["scoring"]["weights"]
        active_w = {k: v for k, v in weights.items() if not k.startswith("_") and k != "flood_area_density"}
        w_sum = sum(active_w.values())
        norm_w = {k: v / w_sum for k, v in active_w.items()}

        norms = default_config["scoring"]["normalization"]
        iso = default_config["scoring"]["isolation_score"]

        exp_raw = (
            norm_w["flood_percent"] * min(15.0 / norms["flood_percent_max"], 1.0)
            + norm_w["exposure"] * min(30 / norms["exposed_buildings_max"], 1.0)
            + norm_w["isolation"] * iso["PARTIAL"]
            + norm_w.get("exposure_fraction", 0.0) * (30 / 50)
        )
        assert math.isclose(rec.raw_score, exp_raw, rel_tol=1e-5)

    def test_null_area_warning_suppression(self, tmp_path, default_config):
        cfg = copy.deepcopy(default_config)
        cfg["data_quality"]["warn_on_null_flooded_area_m2"] = False
        z = _make_zone(flooded_percent=10.0, flooded_area_m2=None)
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p, config=cfg)
        records = score_zones(doc, cfg, warnings)
        rec = records[0]
        assert rec.score_basis == "partial"
        assert not any("flooded_area_m2" in w for w in rec.warnings)


# ===========================================================================
# 6. Priority Labels & Thresholds
# ===========================================================================

class TestPriorityLabels:
    def test_critical_label(self, default_config):
        t = default_config["priority_thresholds"]
        assert _priority_label(t["CRITICAL"], t) == "CRITICAL"
        assert _priority_label(t["CRITICAL"] + 5, t) == "CRITICAL"

    def test_high_label(self, default_config):
        t = default_config["priority_thresholds"]
        assert _priority_label(t["HIGH"], t) == "HIGH"
        assert _priority_label(t["CRITICAL"] - 0.1, t) == "HIGH"

    def test_medium_label(self, default_config):
        t = default_config["priority_thresholds"]
        assert _priority_label(t["MEDIUM"], t) == "MEDIUM"
        assert _priority_label(t["HIGH"] - 0.1, t) == "MEDIUM"

    def test_low_label(self, default_config):
        t = default_config["priority_thresholds"]
        assert _priority_label(t["LOW"], t) == "LOW"
        assert _priority_label(t["MEDIUM"] - 0.1, t) == "LOW"


# ===========================================================================
# 7. Output Schema, Metadata & JSON Constraints
# ===========================================================================

class TestOutputSchemaAndContract:
    def test_output_has_required_top_level_keys(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)

        required_keys = {
            "schema_version", "module", "module_version", "generated_at",
            "disclaimer", "source_metadata", "scoring_config", "summary",
            "data_quality_warnings", "ranked_zones",
        }
        assert required_keys.issubset(set(output.keys()))
        assert output["schema_version"] == "1.1"
        assert "config_version" in output["scoring_config"]
        assert "config_hash_sha256" in output["source_metadata"]
        assert "input_file_sha256" in output["source_metadata"]

    def test_ranked_zones_have_required_fields(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)

        required_zone_keys = {
            "rank", "zone_id", "score", "priority", "score_basis",
            "omitted_components", "reasons", "warnings", "score_components",
            "inputs", "geometry",
        }
        for z in output["ranked_zones"]:
            assert required_zone_keys.issubset(set(z.keys()))

    def test_output_is_json_serialisable_and_rejects_constants(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)
        serialised = json.dumps(output, allow_nan=False)

        def reject_constant(c):
            raise ValueError(f"Non-standard constant found: {c}")

        reloaded = json.loads(serialised, parse_constant=reject_constant)
        assert reloaded["ranked_zones"][0]["zone_id"] == "zone-001"

    def test_crs_passthrough_never_invents_epsg4326(self, tmp_path, default_config):
        # 1. Custom CRS
        p_custom = tmp_path / "custom.json"
        p_custom.write_text(json.dumps({"crs": "EPSG:32632", "zones": [_make_zone()]}), encoding="utf-8")
        doc, warnings = load_zones(p_custom)
        out = records_to_dict(score_zones(doc, default_config, warnings), warnings, doc, default_config)
        assert out["ranked_zones"][0]["geometry"]["crs"] == "EPSG:32632"

        # 2. Missing CRS -> 'unknown'
        p_nocrs = tmp_path / "nocrs.json"
        p_nocrs.write_text(json.dumps({"zones": [_make_zone()]}), encoding="utf-8")
        doc, warnings = load_zones(p_nocrs)
        out = records_to_dict(score_zones(doc, default_config, warnings), warnings, doc, default_config)
        assert out["ranked_zones"][0]["geometry"]["crs"] == "unknown"

    def test_disclaimer_hierarchy(self, tmp_path, default_config):
        # 1. Config disclaimer_context
        cfg = copy.deepcopy(default_config)
        cfg["disclaimer_context"] = "Custom Event 2026"
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        out = records_to_dict(score_zones(doc, cfg, warnings), warnings, doc, cfg)
        assert "Custom Event 2026" in out["disclaimer"]

        # 2. Input document context
        doc["context"] = "Flood Inundation Exercise"
        out2 = records_to_dict(score_zones(doc, default_config, warnings), warnings, doc, default_config)
        assert "Flood Inundation Exercise" in out2["disclaimer"]

        # 3. Generic fallback
        doc_generic = {"zones": [_make_zone()]}
        out3 = records_to_dict(score_zones(doc_generic, default_config, warnings), warnings, doc_generic, default_config)
        assert "applied to flood analysis labels." in out3["disclaimer"]

    def test_custom_weights_change_score(self, tmp_path, default_config):
        z = _make_zone(flooded_percent=10.0, exposed_buildings=50)
        p = _write_zones(tmp_path, z)
        doc, warnings = load_zones(p)
        rec_default = score_zones(doc, default_config, warnings)[0]

        cfg_custom = copy.deepcopy(default_config)
        cfg_custom["scoring"]["weights"]["flood_percent"] = 0.05
        cfg_custom["scoring"]["weights"]["exposure"] = 0.70
        cfg_custom["scoring"]["weights"]["isolation"] = 0.15
        cfg_custom["scoring"]["weights"]["flood_area_density"] = 0.10
        cfg_custom["scoring"]["weights"]["exposure_fraction"] = 0.0
        rec_custom = score_zones(doc, cfg_custom, warnings)[0]

        assert rec_custom.score != rec_default.score


# ===========================================================================
# 8. Dashboard Export Tests
# ===========================================================================

class TestDashboardExport:
    def test_dashboard_export_ring_closed_and_lng_lat_order(self, default_config):
        z = _make_zone(bbox=[7.123, 50.456, 7.234, 50.567])
        doc = _make_zones_doc(z)
        records = score_zones(doc, default_config, [])
        out = records_to_dict(records, [], doc, default_config)
        dash = export_dashboard(out, doc)
        assert len(dash["zones"]) == 1
        zone = dash["zones"][0]
        coords = zone["geometry"]["coordinates"]
        assert len(coords) == 1
        ring = coords[0]
        assert len(ring) == 5
        assert ring[0] == ring[-1]
        assert ring[0] == [7.123, 50.456]
        assert ring[1] == [7.234, 50.456]
        assert ring[2] == [7.234, 50.567]
        assert ring[3] == [7.123, 50.567]
        assert ring[4] == [7.123, 50.456]

    def test_dashboard_export_mapping_table_complete(self):
        expected_mappings = {
            "ACCESSIBLE": "OPEN",
            "PARTIAL": "LIMITED",
            "BLOCKED": "BLOCKED",
            "UNKNOWN": "UNKNOWN",
        }
        for k, v in expected_mappings.items():
            assert ACCESSIBILITY_DASHBOARD_MAP[k] == v
        assert set(ACCESSIBILITY_VALUES).issubset(set(ACCESSIBILITY_DASHBOARD_MAP.keys()))

    def test_dashboard_export_real_data_scores_preserved(self, default_config):
        if not REAL_ZONES_PATH.exists():
            pytest.skip("Real zones.json not available")
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, default_config, warnings)
        out = records_to_dict(records, warnings, doc, default_config)
        dash = export_dashboard(out, doc)
        by_id = {z["zone_id"]: z for z in dash["zones"]}
        assert by_id["zone-004"]["risk_score"] == 0.5
        assert by_id["zone-026"]["risk_score"] == 0.1

    def test_dashboard_export_study_area_not_hardcoded(self, default_config):
        z = _make_zone()
        doc = _make_zones_doc(z)
        doc["study_area"] = "Ahr Valley Inundation Basin"
        records = score_zones(doc, default_config, [])
        out = records_to_dict(records, [], doc, default_config)
        dash = export_dashboard(out, doc)
        assert dash["study_area"] == "Ahr Valley Inundation Basin"

    def test_cli_format_dashboard(self, tmp_path):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "dash_out"
        dash_out = cli_run(zones_path, out_dir, output_format="dashboard", data_mode="scenario_exercise")
        assert (out_dir / "zones.json").exists()
        assert not (out_dir / "risk_scores.json").exists()
        assert dash_out["data_mode"] == "scenario_exercise"
        assert dash_out["score_scale"] == "0-100"
        assert dash_out["schema_version"] == "1.1"



# ===========================================================================
# 8. Golden Hand-Computed Score Test
# ===========================================================================

class TestGoldenHandComputed:
    def test_golden_three_zones(self, default_config):
        """Hand-compute exact scores for 3 diverse zones.

        Default weights:
            flood_percent: 0.35, ceiling: 30.0
            exposure: 0.40, ceiling: 75.0
            isolation: 0.15, PARTIAL=0.5, BLOCKED=1.0, ACCESSIBLE=0.0
            flood_area_density: 0.10, ceiling: 15000.0
            exposure_fraction: 0.0

        Zone G1:
            flooded_percent = 15.0 -> component = 15.0 / 30.0 = 0.50
            exposed_buildings = 30 -> component = 30 / 75.0 = 0.40
            isolation = PARTIAL -> component = 0.50
            flood_area_m2 = 7500.0 -> component = 7500 / 15000 = 0.50
            raw_score = 0.35*0.5 + 0.40*0.4 + 0.15*0.5 + 0.10*0.5
                      = 0.175 + 0.160 + 0.075 + 0.050 = 0.460
            score = 46.0 -> priority = HIGH

        Zone G2:
            flooded_percent = 30.0 -> component = 1.00
            exposed_buildings = 75 -> component = 1.00
            isolation = BLOCKED -> component = 1.00
            flood_area_m2 = 15000.0 -> component = 1.00
            raw_score = 1.00 -> score = 100.0 -> priority = CRITICAL

        Zone G3 (Missing flood area -> partial scoring):
            flooded_percent = 0.0 -> component = 0.0
            exposed_buildings = 0 -> component = 0.0
            isolation = ACCESSIBLE -> component = 0.0
            flooded_area_m2 = None -> omitted, remaining weights renormalized
            raw_score = 0.0 -> score = 0.0 -> priority = LOW
        """
        zones = [
            _make_zone(
                zone_id="zone-g1",
                flooded_percent=15.0,
                exposed_buildings=30,
                accessibility="PARTIAL",
                flooded_area_m2=7500.0,
            ),
            _make_zone(
                zone_id="zone-g2",
                flooded_percent=30.0,
                exposed_buildings=75,
                accessibility="BLOCKED",
                flooded_area_m2=15000.0,
            ),
            _make_zone(
                zone_id="zone-g3",
                flooded_percent=0.0,
                exposed_buildings=0,
                accessibility="ACCESSIBLE",
                flooded_area_m2=None,
            ),
        ]
        doc = _make_zones_doc(*zones)
        records = score_zones(doc, default_config, [])
        by_id = {r.zone_id: r for r in records}

        # G2: Rank 1, CRITICAL, 100.0
        assert by_id["zone-g2"].rank == 1
        assert by_id["zone-g2"].score == 100.0
        assert by_id["zone-g2"].priority == "CRITICAL"

        # G1: Rank 2, HIGH, 46.0
        assert by_id["zone-g1"].rank == 2
        assert by_id["zone-g1"].score == 46.0
        assert by_id["zone-g1"].priority == "HIGH"

        # G3: Rank 3, LOW, 0.0, full scoring per Item 4 (flooded_percent == 0 scores 0.0)
        assert by_id["zone-g3"].rank == 3
        assert by_id["zone-g3"].score == 0.0
        assert by_id["zone-g3"].priority == "LOW"
        assert by_id["zone-g3"].score_basis == "full"
        assert by_id["zone-g3"].omitted_components == []


# ===========================================================================
# 9. CLI Tests & Exit Codes (0, 1, 2, 3)
# ===========================================================================

class TestCLI:
    def test_cli_run_writes_output_file(self, tmp_path, default_config):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "out"
        output = cli_run(zones_path, out_dir)
        assert (out_dir / "risk_scores.json").exists()
        assert len(output["ranked_zones"]) == 1

    def test_cli_run_with_custom_config_changes_score(self, tmp_path, default_config):
        zones_path = _write_zones(tmp_path, _make_zone(flooded_percent=10.0, exposed_buildings=50))
        out_dir_def = tmp_path / "out_def"
        out_def = cli_run(zones_path, out_dir_def)
        score_def = out_def["ranked_zones"][0]["score"]

        custom_cfg = copy.deepcopy(default_config)
        custom_cfg["scoring"]["weights"] = {
            "flood_percent": 0.80,
            "exposure": 0.10,
            "isolation": 0.05,
            "flood_area_density": 0.05,
            "exposure_fraction": 0.0,
        }
        cfg_path = tmp_path / "custom_weights.json"
        cfg_path.write_text(json.dumps(custom_cfg), encoding="utf-8")

        out_dir_cust = tmp_path / "out_cust"
        out_cust = cli_run(zones_path, out_dir_cust, config_path=cfg_path)
        score_cust = out_cust["ranked_zones"][0]["score"]

        assert score_cust != score_def

    def test_cli_run_missing_zones_raises(self, tmp_path):
        with pytest.raises(InputValidationError):
            cli_run(tmp_path / "nowhere.json", tmp_path / "out")

    def test_cli_exit_code_0_success(self, tmp_path):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "out"
        cmd = [sys.executable, "-m", "risk_engine.cli", "--zones", str(zones_path), "--out", str(out_dir)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 0
        assert "Scored 1 zones" in res.stdout

    def test_cli_exit_code_1_validation_error(self, tmp_path):
        bad_zone = _make_zone(exposed_buildings="five")
        zones_path = _write_zones(tmp_path, bad_zone)
        out_dir = tmp_path / "out"
        cmd = [sys.executable, "-m", "risk_engine.cli", "--zones", str(zones_path), "--out", str(out_dir)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 1
        assert "Input validation failed" in res.stderr

    def test_cli_exit_code_2_config_or_file_error(self, tmp_path):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "out"
        cmd = [
            sys.executable, "-m", "risk_engine.cli",
            "--zones", str(zones_path),
            "--out", str(out_dir),
            "--config", str(tmp_path / "no_cfg.json"),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 2
        assert "Configuration or file error" in res.stderr

    def test_cli_debug_flag_shows_traceback(self, tmp_path):
        zones_path = _write_zones(tmp_path, _make_zone(flooded_percent="nan"))
        out_dir = tmp_path / "out"
        cmd = [sys.executable, "-m", "risk_engine.cli", "--zones", str(zones_path), "--out", str(out_dir), "--debug"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 1
        assert "Traceback (most recent call last):" in res.stderr

    def test_cli_validates_before_creating_output_dir(self, tmp_path):
        bad_zone = _make_zone(exposed_buildings="five")
        zones_path = _write_zones(tmp_path, bad_zone)
        out_dir = tmp_path / "uncreated_dir"
        with pytest.raises(InputValidationError):
            cli_run(zones_path, out_dir)
        assert not out_dir.exists()

    def test_cli_exit_code_3_unexpected_error(self, tmp_path):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "out"
        cmd = [
            sys.executable, "-c",
            "import sys, unittest.mock; "
            "from risk_engine import cli; "
            "sys.argv = ['risk_engine', '--zones', sys.argv[1], '--out', sys.argv[2]]; "
            "unittest.mock.patch('risk_engine.cli.run', side_effect=RuntimeError('Simulated unexpected failure')).start(); "
            "cli.main()",
            str(zones_path), str(out_dir)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 3
        assert "Unexpected failure" in res.stderr


# ===========================================================================
# 10. Hypothesis Property-Based Tests
# ===========================================================================

class TestHypothesisProperties:
    @given(
        fp=st.floats(min_value=0.0, max_value=100.0),
        eb=st.integers(min_value=0, max_value=500),
        acc=st.sampled_from(list(ACCESSIBILITY_VALUES)),
        fam=st.one_of(st.none(), st.floats(min_value=0.0, max_value=100000.0)),
        tb=st.integers(min_value=0, max_value=1000),
    )
    @settings(max_examples=50)
    def test_hypothesis_score_bounds(self, fp, eb, acc, fam, tb):
        cfg = load_config(DEFAULT_CONFIG_PATH)
        z = _make_zone(
            flooded_percent=fp,
            exposed_buildings=eb,
            accessibility=acc,
            flooded_area_m2=fam,
            total_buildings=tb,
        )
        doc = _make_zones_doc(z)
        records = score_zones(doc, cfg, [])
        assert 0.0 <= records[0].score <= 100.0
        assert not math.isnan(records[0].score)

    @given(
        eb1=st.integers(min_value=0, max_value=50),
        eb2=st.integers(min_value=51, max_value=100),
    )
    @settings(max_examples=30)
    def test_hypothesis_exposure_monotonicity(self, eb1, eb2):
        cfg = load_config(DEFAULT_CONFIG_PATH)
        z1 = _make_zone(zone_id="z1", exposed_buildings=eb1)
        z2 = _make_zone(zone_id="z2", exposed_buildings=eb2)
        doc = _make_zones_doc(z1, z2)
        records = score_zones(doc, cfg, [])
        by_id = {r.zone_id: r for r in records}
        assert by_id["z2"].raw_score >= by_id["z1"].raw_score

    @given(
        fp1=st.floats(min_value=0.0, max_value=40.0),
        fp2=st.floats(min_value=41.0, max_value=100.0),
    )
    @settings(max_examples=30)
    def test_hypothesis_flood_percent_monotonicity(self, fp1, fp2):
        cfg = load_config(DEFAULT_CONFIG_PATH)
        z1 = _make_zone(zone_id="z1", flooded_percent=fp1)
        z2 = _make_zone(zone_id="z2", flooded_percent=fp2)
        doc = _make_zones_doc(z1, z2)
        records = score_zones(doc, cfg, [])
        by_id = {r.zone_id: r for r in records}
        assert by_id["z2"].raw_score >= by_id["z1"].raw_score

    @given(
        fam1=st.floats(min_value=0.0, max_value=5000.0),
        fam2=st.floats(min_value=5001.0, max_value=30000.0),
    )
    @settings(max_examples=30)
    def test_hypothesis_flood_area_monotonicity(self, fam1, fam2):
        cfg = load_config(DEFAULT_CONFIG_PATH)
        z1 = _make_zone(zone_id="z1", flooded_area_m2=fam1)
        z2 = _make_zone(zone_id="z2", flooded_area_m2=fam2)
        doc = _make_zones_doc(z1, z2)
        records = score_zones(doc, cfg, [])
        by_id = {r.zone_id: r for r in records}
        assert by_id["z2"].raw_score >= by_id["z1"].raw_score

    @given(perm=st.permutations(["z1", "z2", "z3", "z4"]))
    @settings(max_examples=24)
    def test_hypothesis_permutation_invariance(self, perm):
        cfg = load_config(DEFAULT_CONFIG_PATH)
        zone_defs = {
            "z1": _make_zone(zone_id="z1", exposed_buildings=5, flooded_percent=5.0),
            "z2": _make_zone(zone_id="z2", exposed_buildings=25, flooded_percent=15.0),
            "z3": _make_zone(zone_id="z3", exposed_buildings=50, flooded_percent=30.0),
            "z4": _make_zone(zone_id="z4", exposed_buildings=75, flooded_percent=40.0),
        }
        ordered = [zone_defs[zid] for zid in perm]
        doc = _make_zones_doc(*ordered)
        records = score_zones(doc, cfg, [])
        ranked_ids = [r.zone_id for r in records]
        # Must always rank in the exact same order regardless of input permutation
        assert ranked_ids == ["z4", "z3", "z2", "z1"]


# ===========================================================================
# 11. Sensitivity and Calibration Diagnostic Tool Tests
# ===========================================================================

class TestDiagnosticTools:
    def test_kendall_tau_identical_rankings(self):
        items = ["a", "b", "c", "d", "e"]
        assert compute_kendall_tau(items, items) == 1.0

    def test_kendall_tau_inverted_rankings(self):
        a = ["a", "b", "c", "d"]
        b = ["d", "c", "b", "a"]
        assert compute_kendall_tau(a, b) == -1.0

    def test_sensitivity_baseline_self_comparison(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(zone_id="z1"), _make_zone(zone_id="z2", exposed_buildings=20))
        self_metrics, results = run_sensitivity_analysis(p)
        assert self_metrics["kendall_tau"] == 1.0
        assert self_metrics["priority_changes"] == 0
        assert len(results) > 0

    def test_sensitivity_perturbs_parameters(self, tmp_path):
        z1 = _make_zone(zone_id="z1", flooded_percent=20.0, exposed_buildings=5, accessibility="ACCESSIBLE")
        z2 = _make_zone(zone_id="z2", flooded_percent=5.0, exposed_buildings=25, accessibility="PARTIAL")
        p = _write_zones(tmp_path, z1, z2)
        self_metrics, results = run_sensitivity_analysis(p)
        assert len(results) > 0
        categories = {r["category"] for r in results}
        assert {"Weight", "Isolation", "Threshold"}.issubset(categories)
        deltas = {r["perturbation"] for r in results if r["category"] == "Weight"}
        assert {"-20%", "-10%", "+10%", "+20%"}.issubset(deltas)
        # Verify sensitivity perturbations altered rankings or metrics
        taus = [r["kendall_tau"] for r in results]
        assert any(t < 1.0 for t in taus) or any(r["priority_changes"] > 0 for r in results)

    def test_calibrate_analysis_runs(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(zone_id="z1"), _make_zone(zone_id="z2", exposed_buildings=20))
        res = analyze_calibration(p)
        assert res["total_zones"] == 2
        assert "flooded_percent" in res["input_stats"]
        assert "score_stats" in res


# ===========================================================================
# 12. Real Module 2 Data Integration Tests
# ===========================================================================

class TestRealDataIntegration:
    @pytest.fixture(autouse=True)
    def check_real_data_requirement(self):
        if not REAL_ZONES_PATH.exists():
            if os.environ.get("REQUIRE_REAL_DATA") == "1":
                pytest.fail(f"REQUIRE_REAL_DATA=1 set but {REAL_ZONES_PATH} not found")
            pytest.skip(f"Module 2 zones.json not found at {REAL_ZONES_PATH}")

    def test_real_zones_score_all_zones_count_derived(self, default_config):
        doc, warnings = load_zones(REAL_ZONES_PATH)
        expected_count = len(doc["zones"])
        records = score_zones(doc, default_config, warnings)
        assert len(records) == expected_count

    def test_real_zones_all_scores_in_bounds(self, default_config):
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, default_config, warnings)
        for r in records:
            assert 0.0 <= r.score <= 100.0

    def test_real_zones_ranking_is_descending(self, default_config):
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, default_config, warnings)
        scores = [r.score for r in records]
        assert scores == sorted(scores, reverse=True)

    def test_real_zones_cli_run_derived_counts(self, tmp_path):
        doc, _ = load_zones(REAL_ZONES_PATH)
        expected_count = len(doc["zones"])
        out_dir = tmp_path / "out"
        output = cli_run(REAL_ZONES_PATH, out_dir)
        assert output["summary"]["total_zones"] == expected_count
        assert sum(output["summary"]["priority_counts"].values()) == expected_count

    def test_real_zones_zone_002_score_and_rank(self, default_config):
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, default_config, warnings)
        by_id = {r.zone_id: r for r in records}
        assert "zone-002" in by_id
        z2 = by_id["zone-002"]
        assert z2.score == 53.4
        assert z2.priority == "HIGH"
        assert z2.rank == 2

    def test_real_zones_zone_018_and_zone_033_tie_breaking(self, default_config):
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, default_config, warnings)
        by_id = {r.zone_id: r for r in records}
        z18 = by_id["zone-018"]
        z33 = by_id["zone-033"]
        assert z18.score == z33.score == 7.5
        assert z18.raw_score == z33.raw_score == 0.075
        assert z18.exposed_buildings == z33.exposed_buildings == 0
        assert z18.flooded_percent == z33.flooded_percent == 0.0
        # Natural sort breaks the tie: zone-018 precedes zone-033
        assert z18.rank == 17
        assert z33.rank == 18
