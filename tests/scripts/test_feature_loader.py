"""Tests for scripts/_lib/feature_loader.py

Covers:
1. All files present → row has all expected keys
2. Missing community file → community_score: None, no crash
3. Eligibility flag: auction_count_36mo >= 5 → True; < 5 → False
4. Categorical encoding: "high" → 2; None → 0
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make the _lib module importable from any working directory
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "_lib"))
from feature_loader import encode_categoricals, load_features

EXPECTED_KEYS = {
    "slug", "year", "make", "model",
    "current_price_c3", "auction_median_12mo", "auction_count_12mo",
    "auction_median_36mo", "auction_count_36mo", "reserve_met_rate_12mo",
    "price_momentum_1mo", "price_momentum_12mo", "mileage_median_sold",
    "price_data_status", "community_score", "community_data_status",
    "brand_avg_cagr_5yr", "brand_appreciation_tier", "brand_auction_volume_rank",
    "correlated_sp500_12mo", "correlated_gold_12mo", "forecast_eligible",
}


def _write(path: Path, obj) -> None:
    path.write_text(json.dumps(obj))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def data_dir(tmp_path: Path) -> Path:
    return tmp_path


def _make_catalog(data_dir: Path, vehicles=None) -> Path:
    if vehicles is None:
        vehicles = [
            {"slug": "car-a", "year": 1970, "make": "Ford", "model": "Mustang"},
            {"slug": "car-b", "year": 1969, "make": "Chevrolet", "model": "Camaro"},
        ]
    p = data_dir / "cars-catalog.json"
    _write(p, {"vehicles": vehicles})
    return p


def _make_prices(data_dir: Path, overrides: dict | None = None) -> Path:
    defaults = {
        "car-a": {
            "current_price_c3": 50000,
            "auction_median_12mo": 48000,
            "auction_count_12mo": 10,
            "auction_median_36mo": 47000,
            "auction_count_36mo": 7,
            "reserve_met_rate_12mo": 0.8,
            "price_momentum_1mo": 0.02,
            "price_momentum_12mo": 0.10,
            "mileage_median_sold": 55000,
            "data_status": "ok",
        },
        "car-b": {
            "auction_count_36mo": 2,
            "data_status": "insufficient",
        },
    }
    if overrides:
        defaults.update(overrides)
    p = data_dir / "price-aggregates.json"
    _write(p, defaults)
    return p


def _make_community(data_dir: Path) -> Path:
    p = data_dir / "community-score.json"
    _write(p, {
        "car-a": {"community_score": 42, "data_status": "ok"},
        "car-b": {"community_score": 18, "data_status": "ok"},
    })
    return p


def _make_brand(data_dir: Path) -> Path:
    p = data_dir / "brand-features.json"
    _write(p, {
        "version": "1.0.0",
        "data": {
            "Ford": {
                "brand_avg_cagr_5yr": 0.04,
                "brand_appreciation_tier": "high",
                "brand_auction_volume_rank": 1,
            },
            "Chevrolet": {
                "brand_avg_cagr_5yr": 0.03,
                "brand_appreciation_tier": "medium",
                "brand_auction_volume_rank": 2,
            },
        },
    })
    return p


def _make_macro(data_dir: Path) -> Path:
    p = data_dir / "macro-features.json"
    _write(p, {"correlated_sp500_12mo": 0.12, "correlated_gold_12mo": 0.05})
    return p


# ---------------------------------------------------------------------------
# Test 1: all files present → all expected keys
# ---------------------------------------------------------------------------

def test_all_files_present_has_expected_keys(data_dir):
    cat = _make_catalog(data_dir)
    prices = _make_prices(data_dir)
    community = _make_community(data_dir)
    brand = _make_brand(data_dir)
    macro = _make_macro(data_dir)

    rows = load_features(cat, prices, community, brand, macro)

    assert len(rows) == 2
    for row in rows:
        missing = EXPECTED_KEYS - set(row.keys())
        assert not missing, f"Row {row['slug']} missing keys: {missing}"


# ---------------------------------------------------------------------------
# Test 2: missing community file → community_score is None, no crash
# ---------------------------------------------------------------------------

def test_missing_community_file_no_crash(data_dir):
    cat = _make_catalog(data_dir)
    prices = _make_prices(data_dir)
    brand = _make_brand(data_dir)
    macro = _make_macro(data_dir)
    missing_community = data_dir / "community-score-MISSING.json"

    rows = load_features(cat, prices, missing_community, brand, macro)

    assert len(rows) == 2
    for row in rows:
        assert row["community_score"] is None
        assert row["community_data_status"] == "insufficient"


# ---------------------------------------------------------------------------
# Test 3: eligibility flag
# ---------------------------------------------------------------------------

def test_eligibility_flag(data_dir):
    vehicles = [
        {"slug": "eligible-car", "year": 1970, "make": "Ford", "model": "Mustang"},
        {"slug": "ineligible-car", "year": 1969, "make": "Chevrolet", "model": "Camaro"},
    ]
    cat = _make_catalog(data_dir, vehicles=vehicles)
    prices_data = {
        "eligible-car": {"auction_count_36mo": 7, "data_status": "ok"},
        "ineligible-car": {"auction_count_36mo": 2, "data_status": "insufficient"},
    }
    prices = data_dir / "price-aggregates.json"
    _write(prices, prices_data)
    brand = _make_brand(data_dir)
    macro = _make_macro(data_dir)
    missing_community = data_dir / "no-community.json"

    rows = load_features(cat, prices, missing_community, brand, macro)
    by_slug = {r["slug"]: r for r in rows}

    assert by_slug["eligible-car"]["forecast_eligible"] is True
    assert by_slug["ineligible-car"]["forecast_eligible"] is False


def test_eligibility_exactly_five(data_dir):
    """auction_count_36mo == 5 is the boundary: should be eligible."""
    vehicles = [{"slug": "boundary-car", "year": 2000, "make": "Ford", "model": "Focus"}]
    cat = _make_catalog(data_dir, vehicles=vehicles)
    prices = data_dir / "price-aggregates.json"
    _write(prices, {"boundary-car": {"auction_count_36mo": 5}})
    brand = _make_brand(data_dir)
    macro = _make_macro(data_dir)
    missing = data_dir / "no.json"

    rows = load_features(cat, prices, missing, brand, macro)
    assert rows[0]["forecast_eligible"] is True


# ---------------------------------------------------------------------------
# Test 4: categorical encoding
# ---------------------------------------------------------------------------

def test_categorical_encoding_high(data_dir):
    vehicles = [{"slug": "s1", "year": 1970, "make": "Ford", "model": "X"}]
    cat = _make_catalog(data_dir, vehicles=vehicles)
    prices = data_dir / "price-aggregates.json"
    _write(prices, {"s1": {"auction_count_36mo": 0}})
    brand = data_dir / "brand-features.json"
    _write(brand, {"data": {"Ford": {"brand_appreciation_tier": "high"}}})
    macro = _make_macro(data_dir)
    missing = data_dir / "no.json"

    rows = load_features(cat, prices, missing, brand, macro)
    rows = encode_categoricals(rows)
    assert rows[0]["brand_appreciation_tier_encoded"] == 2


def test_categorical_encoding_none(data_dir):
    vehicles = [{"slug": "s2", "year": 1970, "make": "Unknown", "model": "X"}]
    cat = _make_catalog(data_dir, vehicles=vehicles)
    prices = data_dir / "price-aggregates.json"
    _write(prices, {})
    brand = data_dir / "brand-features.json"
    _write(brand, {"data": {}})  # no entry for "Unknown" make
    macro = _make_macro(data_dir)
    missing = data_dir / "no.json"

    rows = load_features(cat, prices, missing, brand, macro)
    rows = encode_categoricals(rows)
    assert rows[0]["brand_appreciation_tier_encoded"] == 0
