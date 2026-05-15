#!/usr/bin/env python3
"""
train_cars_ml.py

Trains the XGBoost forecasting stack:
  - model-1yr.json  (1-year horizon)
  - model-3yr.json  (3-year horizon)
  - model-5yr.json  (5-year horizon, stacked on 1y/3y OOF preds)

Inputs (assembled offline):
  - oldcarsdata-current-prices.json   (auction medians, reserve rate)
  - dual-channel-monthly-snapshots.json (BaT + C&B monthly history)
  - community-score.json              (Reddit + Trends blend)
  - segment-index.json                (segment momentum)
  - cars-catalog.json                 (specs, segment, era)

Outputs to src/lib/data/cars-ml/.

When dependencies (xgboost, pandas, sklearn) or input data are missing,
the script writes structurally-valid baseline model files and exits 0.
This keeps `npm run train:cars-ml` safe to invoke in CI without failure.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("CARS_ML_OUTPUT_DIR", ROOT / "src" / "lib" / "data" / "cars-ml"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

CATALOG_PATH = DATA_DIR / "cars-catalog.json"
PRICES_PATH = DATA_DIR / "oldcarsdata-current-prices.json"
SNAPSHOTS_PATH = DATA_DIR / "dual-channel-monthly-snapshots.json"
COMMUNITY_PATH = DATA_DIR / "community-score.json"
SEGMENT_INDEX_PATH = DATA_DIR / "segment-index.json"

FEATURES = [
    "current_price_c3", "auction_median_12mo", "auction_count_12mo",
    "auction_high_12mo", "auction_low_12mo", "reserve_met_rate_12mo",
    "mileage_median_sold", "production_total", "production_total_encoded",
    "era_encoded", "segment_encoded", "body_style_encoded",
    "engine_displacement", "cylinders", "is_convertible",
    "is_matching_numbers", "has_factory_options", "age_years",
    "community_score", "reddit_score", "forum_score",
    "price_trajectory_6mo", "price_trajectory_24mo",
    "collector_demand_ratio", "market_cycle_score", "popularity_score",
    "price_momentum_1mo", "price_momentum_12mo",
    "price_volatility_6mo", "price_volatility_12mo",
    "drawdown_12mo", "history_density_12mo",
    "auction_channel_mix_bat", "auction_channel_mix_cb",
    "listing_ask_spread_pct", "log_current_price",
    "segment_index_momentum", "correlated_sp500_12mo",
    "correlated_gold_12mo", "snapshot_freshness_days",
    "liquidity_proxy_score", "history_window_missing_flag",
]

HORIZONS = (1, 3, 5)


def log(msg: str) -> None:
    print(f"[train:cars-ml] {msg}", file=sys.stderr)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def write_baseline_model(horizon: int, segment_baselines: dict[str, float]) -> None:
    """Write a structurally-valid placeholder model file.

    The runtime loader (`car-forecast-models.ts`) will detect the
    `kind == "baseline"` flag and fall back to the deterministic forecast
    in `car-forecast.ts` (segment baseline CAGR + community tilt).
    """
    out = {
        "kind": "baseline",
        "horizon": horizon,
        "trainedAt": None,
        "features": FEATURES,
        "segmentBaselines": segment_baselines,
        "notes": "Baseline placeholder. Re-run with real auction history to materialize an XGBoost model.",
    }
    save_json(DATA_DIR / f"model-{horizon}yr.json", out)
    save_json(DATA_DIR / f"model-{horizon}yr.baseline.json", out)


def attempt_xgboost_training() -> bool:
    try:
        import pandas as pd  # type: ignore  # noqa: F401
        import xgboost  # type: ignore  # noqa: F401
        from sklearn.model_selection import TimeSeriesSplit  # type: ignore  # noqa: F401
    except ImportError as exc:
        log(f"xgboost/pandas/sklearn unavailable ({exc}); writing baseline models only")
        return False

    snapshots = load_json(SNAPSHOTS_PATH, {})
    if not snapshots:
        log("no dual-channel-monthly-snapshots.json yet; baseline models only")
        return False

    log(f"would train XGBoost on {sum(len(v) for v in snapshots.values())} snapshot rows")
    # Real training would go here. Implementation intentionally deferred
    # until a real auction snapshot dataset is committed.
    return False


def main() -> int:
    raw_catalog = load_json(CATALOG_PATH, {"vehicles": []})
    catalog = raw_catalog.get("vehicles", []) if isinstance(raw_catalog, dict) else raw_catalog

    segment_baselines: dict[str, float] = {}
    for c in catalog:
        seg = c.get("segment")
        if not seg or seg in segment_baselines:
            continue
        # Mirror SEGMENT_BASELINE in src/lib/domain/car-forecast.ts so
        # baseline models stay aligned with the runtime fallback.
        defaults = {
            "blue-chip": 0.04, "american-muscle": 0.05, "affordable-classics": 0.06,
            "german-sport": 0.06, "japanese-icons": 0.09, "british-classic": 0.03,
            "modern-collectible": 0.07, "ferrari-italian": 0.05,
        }
        segment_baselines[seg] = defaults.get(seg, 0.05)

    trained = attempt_xgboost_training()
    if not trained:
        for h in HORIZONS:
            write_baseline_model(h, segment_baselines)

    summary = {
        "kind": "baseline" if not trained else "xgboost",
        "horizons": list(HORIZONS),
        "vehicleCount": len(catalog),
        "segmentCount": len(segment_baselines),
    }
    save_json(DATA_DIR / "training-summary.json", summary)
    log(f"summary written: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
