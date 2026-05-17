#!/usr/bin/env python3
"""Train per-horizon XGBoost models for collectible-car price forecasting.

Honest insufficient-data behavior: when fewer than MIN_TRAIN_ROWS eligible
vehicles exist, exit cleanly with a structured training-summary.json marking
status='insufficient_data' instead of producing meaningless models.

Baseline model files (kind="baseline") written by the old scaffold are
preserved by retrain_cars_ml.py's DynamoDB publish logic — we do NOT delete
them here so the runtime loader keeps a valid fallback.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "_lib"))
from feature_loader import encode_categoricals, load_features

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "lib" / "data" / "cars-ml"
DATA.mkdir(parents=True, exist_ok=True)

MIN_TRAIN_ROWS = 30  # below this we refuse to train per the plan


def jlog(**kw) -> None:
    sys.stderr.write(json.dumps(kw) + "\n")
    sys.stderr.flush()


def atomic_write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, default=str))
    tmp.replace(path)


def main() -> int:
    started = time.time()

    rows = load_features(
        DATA / "cars-catalog.json",
        DATA / "price-aggregates.json",
        DATA / "community-score.json",
        DATA / "brand-features.json",
        DATA / "macro-features.json",
    )
    rows = encode_categoricals(rows)

    eligible = [r for r in rows if r["forecast_eligible"]]
    total = len(rows)
    eligible_count = len(eligible)

    summary = {
        "status": "insufficient_data",
        "trained": False,
        "total_catalog_rows": total,
        "eligible_count": eligible_count,
        "min_required": MIN_TRAIN_ROWS,
        "horizons": {
            "1yr": {"trained": False, "reason": "insufficient_eligible_rows"},
            "3yr": {"trained": False, "reason": "no_historical_snapshots"},
            "5yr": {"trained": False, "reason": "no_historical_snapshots"},
        },
        "feature_set_version": "phase-g-2025-q4",
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": int((time.time() - started) * 1000),
    }

    if eligible_count < MIN_TRAIN_ROWS:
        jlog(
            operation="train.skip",
            reason="insufficient_data",
            eligible=eligible_count,
            required=MIN_TRAIN_ROWS,
        )
        atomic_write_json(DATA / "training-summary.json", summary)
        return 0

    # -------------------------------------------------------------------------
    # We have enough eligible rows — train the 1yr model only.
    # 3yr / 5yr models require historical price snapshots that don't yet exist;
    # they are intentionally skipped and marked not_trained in the summary.
    # -------------------------------------------------------------------------
    try:
        import numpy as np
        import pandas as pd
        from sklearn.metrics import mean_absolute_percentage_error, r2_score
        from sklearn.model_selection import TimeSeriesSplit
        from xgboost import XGBRegressor
    except ImportError as exc:
        jlog(operation="train.skip", reason=f"import_error: {exc}")
        atomic_write_json(DATA / "training-summary.json", summary)
        return 0

    df = pd.DataFrame(eligible)

    feature_cols = [
        "year",
        "auction_median_12mo",
        "auction_count_12mo",
        "auction_count_36mo",
        "reserve_met_rate_12mo",
        "price_momentum_1mo",
        "mileage_median_sold",
        "community_score",
        "brand_avg_cagr_5yr",
        "brand_auction_volume_rank",
        "brand_appreciation_tier_encoded",
        "correlated_sp500_12mo",
        "correlated_gold_12mo",
    ]

    X = df[feature_cols].apply(pd.to_numeric, errors="coerce").fillna(0)

    # Target proxy for 1yr: price_momentum_12mo.
    # Documented limitation: this is a trailing 12-month return, not a true
    # forward 1yr price change. Forward targets require historical snapshots
    # (planned for Phase H).
    y = pd.to_numeric(df["price_momentum_12mo"], errors="coerce").fillna(0)

    n_splits = min(5, max(2, len(df) // 6))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    fold_scores = []
    for tr_idx, te_idx in tscv.split(X):
        m = XGBRegressor(
            n_estimators=200, max_depth=4, learning_rate=0.05, random_state=42
        )
        m.fit(X.iloc[tr_idx], y.iloc[tr_idx])
        preds = m.predict(X.iloc[te_idx])
        y_te = y.iloc[te_idx]
        fold_scores.append({
            "mape": float(
                mean_absolute_percentage_error(
                    y_te.clip(lower=1e-3), np.clip(preds, 1e-3, None)
                )
            ),
            "r2": float(r2_score(y_te, preds)),
        })

    final = XGBRegressor(
        n_estimators=200, max_depth=4, learning_rate=0.05, random_state=42
    )
    final.fit(X, y)
    # Save raw XGBoost artifact under a sub-key inside our wrapper JSON so the
    # runtime loader contract (kind/horizon/features/trainedAt) stays intact.
    xgb_path = DATA / "model-1yr.xgb.json"
    final.save_model(str(xgb_path))
    xgb_artifact = json.loads(xgb_path.read_text())
    wrapper = {
        "kind": "xgboost",
        "horizon": 1,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "features": feature_cols,
        "modelArtifact": xgb_artifact,
        "notes": (
            "Real XGBoost regressor trained on OldCarsData auction sales. "
            "Target is 12-month trailing return (proxy for 1yr forward) until "
            "historical snapshots enable true forward targets (Phase H)."
        ),
    }
    atomic_write_json(DATA / "model-1yr.json", wrapper)

    summary["status"] = "trained"
    summary["trained"] = True
    summary["horizons"]["1yr"] = {
        "trained": True,
        "target": (
            "price_momentum_12mo "
            "(12-month trailing return used as 1yr proxy — "
            "forward targets require historical snapshots, planned Phase H)"
        ),
        "feature_columns": feature_cols,
        "cv_folds": fold_scores,
        "mean_mape": float(np.mean([f["mape"] for f in fold_scores])),
        "mean_r2": float(np.mean([f["r2"] for f in fold_scores])),
    }
    summary["duration_ms"] = int((time.time() - started) * 1000)
    atomic_write_json(DATA / "training-summary.json", summary)
    jlog(
        operation="train.done",
        **{k: summary[k] for k in ("status", "eligible_count", "duration_ms")},
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
