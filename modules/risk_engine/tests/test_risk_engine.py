"""Pytest tests for HighWater Module 3 — Risk & Prioritization Engine.

All tests are fully offline. Tests that exercise the real Module 2
zones.json are skipped if the file is not present.
"""

from __future__ import annotations

import json
import math
import pathlib
import pytest

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

MODULE_ROOT = pathlib.Path(__file__).parent.parent
SRC_ROOT = MODULE_ROOT / "src"
REAL_ZONES_PATH = MODULE_ROOT.parent / "flood_analysis" / "output" / "zones.json"
DEFAULT_CONFIG_PATH = MODULE_ROOT / "config" / "weights.json"

import sys
sys.path.insert(0, str(SRC_ROOT))

from risk_engine.scorer import (
    InputValidationError,
    DataQualityWarning,
    ZoneRiskRecord,
    load_config,
    load_zones,
    score_zones,
    records_to_dict,
    _priority_label,
    ACCESSIBILITY_VALUES,
)
from risk_engine.cli import run as cli_run


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def default_config():
    return load_config(DEFAULT_CONFIG_PATH)


def _make_zone(**kwargs) -> dict:
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


def _make_zones_doc(*zones) -> dict:
    return {
        "schema_version": "1.0",
        "source": "test",
        "crs": "EPSG:4326",
        "zones": list(zones),
    }


def _write_zones(tmp_path, *zones) -> pathlib.Path:
    p = tmp_path / "zones.json"
    p.write_text(json.dumps(_make_zones_doc(*zones)), encoding="utf-8")
    return p


# ===========================================================================
# 1. Config loading
# ===========================================================================

class TestConfigLoading:
    def test_default_config_loads(self, default_config):
        assert "scoring" in default_config
        assert "priority_thresholds" in default_config

    def test_weights_sum_to_one(self, default_config):
        weights = default_config["scoring"]["weights"]
        total = sum(weights.values())
        assert math.isclose(total, 1.0, rel_tol=1e-6), f"Weights sum to {total}"

    def test_isolation_scores_in_range(self, default_config):
        for cat, val in default_config["scoring"]["isolation_score"].items():
            if cat.startswith("_"):
                continue  # skip JSON comment keys
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
        with pytest.raises(FileNotFoundError):
            load_config(tmp_path / "nonexistent.json")

    def test_weight_sum_mismatch_raises(self, tmp_path, default_config):
        cfg = json.loads(json.dumps(default_config))  # deep copy via JSON
        cfg["scoring"]["weights"]["flood_percent"] += 0.5  # break sum
        p = tmp_path / "bad_weights.json"
        p.write_text(json.dumps(cfg), encoding="utf-8")
        loaded = load_config(p)
        with pytest.raises(ValueError, match="sum to 1.0"):
            from risk_engine.scorer import _extract_weights
            _extract_weights(loaded)


# ===========================================================================
# 2. Input loading and validation
# ===========================================================================

class TestInputLoading:
    def test_valid_zones_doc_loads(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        assert len(doc["zones"]) == 1
        assert doc["zones"][0]["zone_id"] == "zone-001"

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(InputValidationError, match="not found"):
            load_zones(tmp_path / "nowhere.json")

    def test_invalid_json_raises(self, tmp_path):
        p = tmp_path / "zones.json"
        p.write_text("not valid json {{{", encoding="utf-8")
        with pytest.raises(InputValidationError, match="not valid JSON"):
            load_zones(p)

    def test_missing_zones_key_raises(self, tmp_path):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"schema_version": "1.0"}), encoding="utf-8")
        with pytest.raises(InputValidationError, match="missing required 'zones' key"):
            load_zones(p)

    def test_non_list_zones_raises(self, tmp_path):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": "bad"}), encoding="utf-8")
        with pytest.raises(InputValidationError, match="must be a JSON array"):
            load_zones(p)

    def test_empty_zones_list_is_valid(self, tmp_path):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": []}), encoding="utf-8")
        doc, warnings = load_zones(p)
        assert doc["zones"] == []
        assert warnings == []

    def test_duplicate_zone_id_raises(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(zone_id="zone-001"), _make_zone(zone_id="zone-001"))
        with pytest.raises(InputValidationError, match="Duplicate zone_id"):
            load_zones(p)

    def test_null_flooded_area_m2_becomes_zero_with_warning(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(flooded_area_m2=None))
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["flooded_area_m2"] == 0.0
        assert any(w.field == "flooded_area_m2" for w in warnings)

    def test_unknown_accessibility_becomes_warning(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(accessibility="SUBMERGED"))
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["accessibility"] == "UNKNOWN"
        assert any("SUBMERGED" in w.issue for w in warnings)

    def test_flooded_percent_out_of_range_clamped_with_warning(self, tmp_path):
        p = _write_zones(tmp_path, _make_zone(flooded_percent=150.0))
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["flooded_percent"] == 100.0
        assert any(w.field == "flooded_percent" for w in warnings)

    def test_missing_required_field_raises(self, tmp_path):
        zone = _make_zone()
        del zone["flooded_percent"]
        p = _write_zones(tmp_path, zone)
        with pytest.raises(InputValidationError, match="flooded_percent"):
            load_zones(p)

    def test_non_object_in_zones_array_raises(self, tmp_path):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": [42]}), encoding="utf-8")
        with pytest.raises(InputValidationError, match="not a JSON object"):
            load_zones(p)


# ===========================================================================
# 3. Scoring correctness
# ===========================================================================

class TestScoring:
    def test_score_in_bounds(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        for r in records:
            assert 0.0 <= r.score <= 100.0, f"score {r.score} out of [0,100]"

    def test_score_is_deterministic(self, tmp_path, default_config):
        zone = _make_zone()
        p = _write_zones(tmp_path, zone)
        doc1, w1 = load_zones(p)
        doc2, w2 = load_zones(p)
        r1 = score_zones(doc1, default_config, w1)
        r2 = score_zones(doc2, default_config, w2)
        assert r1[0].score == r2[0].score

    def test_higher_exposure_raises_score(self, tmp_path, default_config):
        low = _make_zone(zone_id="low", exposed_buildings=1)
        high = _make_zone(zone_id="high", exposed_buildings=50)
        p = _write_zones(tmp_path, low, high)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        scores = {r.zone_id: r.score for r in records}
        assert scores["high"] > scores["low"]

    def test_blocked_accessibility_raises_score_vs_accessible(self, tmp_path, default_config):
        accessible = _make_zone(zone_id="acc", accessibility="ACCESSIBLE")
        blocked = _make_zone(zone_id="blk", accessibility="BLOCKED")
        p = _write_zones(tmp_path, accessible, blocked)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        scores = {r.zone_id: r.score for r in records}
        assert scores["blk"] > scores["acc"]

    def test_zero_exposure_zero_flood_gives_low_or_medium_score(self, tmp_path, default_config):
        zone = _make_zone(
            exposed_buildings=0,
            flooded_percent=0.0,
            flooded_area_m2=0.0,
            accessibility="ACCESSIBLE",
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records[0].score < 50.0  # should not score CRITICAL or HIGH

    def test_max_exposure_max_flood_gives_high_score(self, tmp_path, default_config):
        zone = _make_zone(
            exposed_buildings=75,
            flooded_percent=30.0,
            flooded_area_m2=15000.0,
            accessibility="BLOCKED",
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records[0].score >= 80.0  # should score CRITICAL

    def test_score_capped_at_100(self, tmp_path, default_config):
        """Inputs exceeding normalisation ceilings must not push score above 100."""
        zone = _make_zone(
            exposed_buildings=9999,
            flooded_percent=9999.0,
            flooded_area_m2=9999999.0,
            accessibility="BLOCKED",
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records[0].score <= 100.0

    def test_ranking_is_descending(self, tmp_path, default_config):
        zones = [
            _make_zone(zone_id=f"zone-{i:03d}", exposed_buildings=i * 5)
            for i in range(1, 6)
        ]
        p = _write_zones(tmp_path, *zones)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        scores = [r.score for r in records]
        assert scores == sorted(scores, reverse=True)

    def test_rank_values_are_sequential(self, tmp_path, default_config):
        zones = [_make_zone(zone_id=f"zone-{i:03d}") for i in range(1, 4)]
        p = _write_zones(tmp_path, *zones)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert [r.rank for r in records] == list(range(1, len(records) + 1))

    def test_tie_breaking_is_deterministic_by_zone_id(self, tmp_path, default_config):
        """Two identical zones should always rank alpha-by zone_id."""
        z1 = _make_zone(zone_id="zone-aaa")
        z2 = _make_zone(zone_id="zone-bbb")
        p = _write_zones(tmp_path, z1, z2)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records[0].zone_id == "zone-aaa"
        assert records[1].zone_id == "zone-bbb"

    def test_empty_input_returns_empty_list(self, tmp_path, default_config):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": []}), encoding="utf-8")
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records == []


# ===========================================================================
# 4. Priority labels
# ===========================================================================

class TestPriorityLabels:
    @pytest.fixture()
    def thresholds(self, default_config):
        return default_config["priority_thresholds"]

    def test_critical_label(self, thresholds):
        assert _priority_label(thresholds["CRITICAL"], thresholds) == "CRITICAL"
        assert _priority_label(100.0, thresholds) == "CRITICAL"

    def test_high_label(self, thresholds):
        score = thresholds["HIGH"]
        assert _priority_label(score, thresholds) == "HIGH"

    def test_medium_label(self, thresholds):
        score = thresholds["MEDIUM"]
        assert _priority_label(score, thresholds) == "MEDIUM"

    def test_low_label(self, thresholds):
        assert _priority_label(0.0, thresholds) == "LOW"

    def test_just_below_critical_is_high(self, thresholds):
        score = thresholds["CRITICAL"] - 0.1
        label = _priority_label(score, thresholds)
        assert label == "HIGH"


# ===========================================================================
# 5. Unknown accessibility and null flood area
# ===========================================================================

class TestEdgeCases:
    def test_unknown_accessibility_generates_warning(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone(accessibility="UNKNOWN"))
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert any("UNKNOWN" in w or "unknown" in w.lower()
                   for w in records[0].warnings)

    def test_null_flood_area_m2_is_scored_safely(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone(flooded_area_m2=None))
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert 0.0 <= records[0].score <= 100.0
        assert records[0].flood_area_component == 0.0

    def test_zero_exposure_zero_flood_no_exception(self, tmp_path, default_config):
        zone = _make_zone(
            exposed_buildings=0,
            flooded_percent=0.0,
            flooded_area_m2=0.0,
            road_length_m=0.0,
            flooded_road_length_m=0.0,
            accessibility="UNKNOWN",
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert records[0].score >= 0.0

    def test_zones_with_zero_buildings_score_without_error(self, tmp_path, default_config):
        zone = _make_zone(total_buildings=0, exposed_buildings=0)
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert len(records) == 1

    def test_high_flood_percent_zero_exposure_generates_warning(self, tmp_path, default_config):
        """flooded_percent >= threshold but no exposed buildings → data-quality warning."""
        zone = _make_zone(
            flooded_percent=15.0,
            exposed_buildings=0,
            total_buildings=5,
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        all_msgs = " ".join(records[0].warnings + records[0].reasons)
        assert "NOTE" in all_msgs or "flooded_percent" in all_msgs.lower()

    def test_blocked_zero_buildings_road_only_zone(self, tmp_path, default_config):
        """Zone with roads but no buildings should still score safely."""
        zone = _make_zone(
            total_buildings=0,
            exposed_buildings=0,
            road_length_m=180.0,
            flooded_road_length_m=180.0,
            accessibility="BLOCKED",
        )
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        assert 0.0 <= records[0].score <= 100.0

    def test_negative_exposed_buildings_generates_warning_and_treated_as_zero(self, tmp_path):
        zone = _make_zone(exposed_buildings=-3)
        p = _write_zones(tmp_path, zone)
        doc, warnings = load_zones(p)
        assert doc["zones"][0]["exposed_buildings"] == 0
        assert any(w.field == "exposed_buildings" for w in warnings)


# ===========================================================================
# 6. Output schema
# ===========================================================================

class TestOutputSchema:
    def test_output_has_required_top_level_keys(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)

        required_keys = {
            "schema_version", "module", "module_version", "disclaimer",
            "source_metadata", "scoring_config", "summary",
            "data_quality_warnings", "ranked_zones",
        }
        assert required_keys.issubset(set(output.keys()))

    def test_ranked_zones_have_required_fields(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)

        required_zone_keys = {
            "rank", "zone_id", "score", "priority",
            "reasons", "warnings", "score_components", "inputs", "geometry",
        }
        for z in output["ranked_zones"]:
            assert required_zone_keys.issubset(set(z.keys()))

    def test_output_is_json_serialisable(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)
        serialised = json.dumps(output)
        reloaded = json.loads(serialised)
        assert reloaded["ranked_zones"][0]["zone_id"] == "zone-001"

    def test_priority_values_are_valid_enum(self, tmp_path, default_config):
        zones = [
            _make_zone(zone_id="zone-001", flooded_percent=0.0, exposed_buildings=0),
            _make_zone(zone_id="zone-002", flooded_percent=15.0, exposed_buildings=20),
            _make_zone(zone_id="zone-003", flooded_percent=30.0, exposed_buildings=75, accessibility="BLOCKED"),
        ]
        p = _write_zones(tmp_path, *zones)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)
        for z in output["ranked_zones"]:
            assert z["priority"] in {"CRITICAL", "HIGH", "MEDIUM", "LOW"}

    def test_summary_counts_match_zones(self, tmp_path, default_config):
        zones = [_make_zone(zone_id=f"zone-{i:03d}") for i in range(1, 6)]
        p = _write_zones(tmp_path, *zones)
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)
        total_from_counts = sum(output["summary"]["priority_counts"].values())
        assert total_from_counts == output["summary"]["total_zones"]

    def test_schema_version_is_string(self, tmp_path, default_config):
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)
        assert isinstance(output["schema_version"], str)

    def test_output_scoring_config_contains_no_comment_keys(self, tmp_path, default_config):
        """_comment keys from weights.json must not appear in the output contract.

        A downstream consumer iterating normalization_ceilings or
        priority_thresholds must not encounter unexpected string-typed entries.
        """
        p = _write_zones(tmp_path, _make_zone())
        doc, warnings = load_zones(p)
        records = score_zones(doc, default_config, warnings)
        output = records_to_dict(records, warnings, doc, default_config)

        norm_keys = set(output["scoring_config"]["normalization_ceilings"].keys())
        thresh_keys = set(output["scoring_config"]["priority_thresholds"].keys())

        comment_in_norms = {k for k in norm_keys if k.startswith("_")}
        comment_in_thresh = {k for k in thresh_keys if k.startswith("_")}

        assert not comment_in_norms, (
            f"_comment keys leaked into normalization_ceilings: {comment_in_norms}"
        )
        assert not comment_in_thresh, (
            f"_comment keys leaked into priority_thresholds: {comment_in_thresh}"
        )

        # All values in normalization_ceilings must be numeric
        for k, v in output["scoring_config"]["normalization_ceilings"].items():
            assert isinstance(v, (int, float)), (
                f"normalization_ceilings[{k!r}] = {v!r} is not numeric"
            )

        # All values in priority_thresholds must be numeric
        for k, v in output["scoring_config"]["priority_thresholds"].items():
            assert isinstance(v, (int, float)), (
                f"priority_thresholds[{k!r}] = {v!r} is not numeric"
            )


# ===========================================================================
# 7. CLI integration
# ===========================================================================

class TestCLI:
    def test_cli_run_writes_output_file(self, tmp_path, default_config):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "out"
        output = cli_run(zones_path, out_dir)
        assert (out_dir / "risk_scores.json").exists()
        assert len(output["ranked_zones"]) == 1

    def test_cli_run_with_custom_config(self, tmp_path, default_config):
        zones_path = _write_zones(tmp_path, _make_zone())
        out_dir = tmp_path / "out"
        output = cli_run(zones_path, out_dir, DEFAULT_CONFIG_PATH)
        assert output["summary"]["total_zones"] == 1

    def test_cli_run_missing_zones_raises(self, tmp_path):
        with pytest.raises(InputValidationError):
            cli_run(tmp_path / "nowhere.json", tmp_path / "out")

    def test_cli_run_empty_zones_produces_empty_output(self, tmp_path, default_config):
        p = tmp_path / "zones.json"
        p.write_text(json.dumps({"zones": []}), encoding="utf-8")
        out_dir = tmp_path / "out"
        output = cli_run(p, out_dir)
        assert output["summary"]["total_zones"] == 0
        assert output["ranked_zones"] == []


# ===========================================================================
# 8. Real Module 2 data integration test
# ===========================================================================

@pytest.mark.skipif(
    not REAL_ZONES_PATH.exists(),
    reason=f"Module 2 zones.json not found at {REAL_ZONES_PATH}",
)
class TestRealData:
    def test_real_zones_load_without_errors(self):
        doc, warnings = load_zones(REAL_ZONES_PATH)
        assert len(doc["zones"]) == 38

    def test_real_zones_score_all_38_zones(self):
        config = load_config(DEFAULT_CONFIG_PATH)
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, config, warnings)
        assert len(records) == 38

    def test_real_zones_all_scores_in_bounds(self):
        config = load_config(DEFAULT_CONFIG_PATH)
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, config, warnings)
        for r in records:
            assert 0.0 <= r.score <= 100.0, f"{r.zone_id} score {r.score} out of bounds"

    def test_real_zones_ranking_is_descending(self):
        config = load_config(DEFAULT_CONFIG_PATH)
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, config, warnings)
        scores = [r.score for r in records]
        assert scores == sorted(scores, reverse=True)

    def test_real_zones_output_is_json_serialisable(self):
        config = load_config(DEFAULT_CONFIG_PATH)
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, config, warnings)
        output = records_to_dict(records, warnings, doc, config)
        json.dumps(output)  # must not raise

    def test_real_zones_unknown_accessibility_handled(self):
        """Zones with accessibility=UNKNOWN must not crash or produce NaN."""
        config = load_config(DEFAULT_CONFIG_PATH)
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, config, warnings)
        unknown_records = [
            r for r in records if r.accessibility == "UNKNOWN"
        ]
        # Real data has 2 UNKNOWN zones (zone-018 and zone-033)
        assert len(unknown_records) == 2
        for r in unknown_records:
            assert not math.isnan(r.score)
            assert 0.0 <= r.score <= 100.0

    def test_real_zones_top_zone_is_high_exposure(self):
        """zone-002 has the highest exposure (52 buildings) — expect it at or near the top."""
        config = load_config(DEFAULT_CONFIG_PATH)
        doc, warnings = load_zones(REAL_ZONES_PATH)
        records = score_zones(doc, config, warnings)
        top3_ids = {r.zone_id for r in records[:3]}
        assert "zone-002" in top3_ids, (
            f"Expected zone-002 (52 exposed buildings) in top-3; got {top3_ids}"
        )

    def test_real_data_via_cli_run(self, tmp_path):
        out_dir = tmp_path / "out"
        output = cli_run(REAL_ZONES_PATH, out_dir)
        assert (out_dir / "risk_scores.json").exists()
        assert output["summary"]["total_zones"] == 38
        counts = output["summary"]["priority_counts"]
        total = sum(counts.values())
        assert total == 38
