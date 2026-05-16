"""feature_loader.py

Pure feature-assembly module: reads catalog + price-aggregates + community +
brand + macro files and returns a list of per-slug feature dicts.

All file reads tolerate missing files — missing path → empty defaults, no crash.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


def load_features(
    catalog_path: Path,
    prices_path: Path,
    community_path: Path,
    brand_path: Path,
    macro_path: Path,
) -> List[Dict[str, Any]]:
    """Assemble per-slug feature rows from all Phase A–F data files.

    Missing files return empty defaults — the function must never raise due to
    absent data (safe-fallback contract).
    """
    # --- catalog (required) -------------------------------------------------
    raw_catalog = json.loads(catalog_path.read_text())
    # Handles both {"vehicles": [...]} and plain list formats
    catalog: list = (
        raw_catalog.get("vehicles", raw_catalog)
        if isinstance(raw_catalog, dict)
        else raw_catalog
    )

    # --- optional data files ------------------------------------------------
    prices: dict = json.loads(prices_path.read_text()) if prices_path.exists() else {}

    raw_community = json.loads(community_path.read_text()) if community_path.exists() else {}
    community: dict = raw_community if isinstance(raw_community, dict) else {}

    raw_brand = json.loads(brand_path.read_text()) if brand_path.exists() else {}
    # brand-features.json wraps makes under a "data" key
    brand: dict = raw_brand.get("data", raw_brand) if isinstance(raw_brand, dict) else {}

    raw_macro = json.loads(macro_path.read_text()) if macro_path.exists() else {}
    macro: dict = raw_macro if isinstance(raw_macro, dict) else {}
    macro.setdefault("correlated_sp500_12mo", None)
    macro.setdefault("correlated_gold_12mo", None)

    rows: List[Dict[str, Any]] = []
    for car in catalog:
        slug = car.get("slug") or car.get("id", "")
        p = prices.get(slug, {})
        c = community.get(slug, {})
        b = brand.get(car.get("make", ""), {})

        rows.append({
            "slug": slug,
            "year": car.get("year"),
            "make": car.get("make"),
            "model": car.get("model"),
            # Price features (Phase C)
            "current_price_c3": p.get("current_price_c3"),
            "auction_median_12mo": p.get("auction_median_12mo"),
            "auction_count_12mo": p.get("auction_count_12mo", 0),
            "auction_median_36mo": p.get("auction_median_36mo"),
            "auction_count_36mo": p.get("auction_count_36mo", 0),
            "reserve_met_rate_12mo": p.get("reserve_met_rate_12mo"),
            "price_momentum_1mo": p.get("price_momentum_1mo"),
            "price_momentum_12mo": p.get("price_momentum_12mo"),
            "mileage_median_sold": p.get("mileage_median_sold"),
            "price_data_status": p.get("data_status", "insufficient"),
            # Community features (Phase D)
            "community_score": c.get("community_score"),
            "community_data_status": c.get("data_status", "insufficient"),
            # Brand features (Phase F)
            "brand_avg_cagr_5yr": b.get("brand_avg_cagr_5yr"),
            "brand_appreciation_tier": b.get("brand_appreciation_tier"),
            "brand_auction_volume_rank": b.get("brand_auction_volume_rank"),
            # Macro features — single global object (Phase F)
            "correlated_sp500_12mo": macro.get("correlated_sp500_12mo"),
            "correlated_gold_12mo": macro.get("correlated_gold_12mo"),
            # Eligibility: honesty rule — fewer than 5 auctions in 36mo → not eligible
            "forecast_eligible": (p.get("auction_count_36mo", 0) >= 5),
        })

    return rows


def encode_categoricals(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Encode categorical features for XGBoost input.

    brand_appreciation_tier → integer ordinal (declining=-1, low=0, medium=1, high=2)
    Missing / unknown → 0 (conservative neutral).
    """
    tier_map: Dict[Any, int] = {
        "declining": -1,
        "low": 0,
        "medium": 1,
        "high": 2,
        None: 0,
    }
    for r in rows:
        r["brand_appreciation_tier_encoded"] = tier_map.get(
            r.get("brand_appreciation_tier"), 0
        )
    return rows
