#!/usr/bin/env python3
"""
retrain_cars_ml.py

Incremental retrain that captures fresh auction outcomes and updates the
XGBoost stack. When `CARS_ML_PUBLISH_ENABLED=true`, the new model chunks
are pushed to DynamoDB under prefix `model#cars-ml#chunk#N`.

For now this defers to train_cars_ml.py for the actual training step and
adds optional DynamoDB publication. Safe to run without secrets.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("CARS_ML_OUTPUT_DIR", ROOT / "src" / "lib" / "data" / "cars-ml"))
TRAIN_SCRIPT = ROOT / "scripts" / "train_cars_ml.py"


def log(msg: str) -> None:
    print(f"[retrain:cars-ml] {msg}", file=sys.stderr)


def publish_to_dynamodb() -> None:
    if os.environ.get("CARS_ML_PUBLISH_ENABLED", "").lower() != "true":
        log("CARS_ML_PUBLISH_ENABLED!=true; skipping DynamoDB publish")
        return
    table = os.environ.get("DYNAMODB_TABLE")
    region = os.environ.get("AWS_REGION")
    if not (table and region):
        log("AWS_REGION/DYNAMODB_TABLE missing; cannot publish")
        return
    try:
        import boto3  # type: ignore
    except ImportError:
        log("boto3 not installed; skipping publish")
        return

    client = boto3.client("dynamodb", region_name=region)
    for path in sorted(DATA_DIR.glob("model-*yr.json")):
        chunk_id = f"model#cars-ml#{path.stem}"
        body = path.read_text()
        client.put_item(
            TableName=table,
            Item={
                "pk": {"S": chunk_id},
                "sk": {"S": "v1"},
                "body": {"S": body},
            },
        )
        log(f"published {chunk_id} ({len(body)} bytes)")


def main() -> int:
    log("invoking train_cars_ml.py")
    rc = subprocess.call([sys.executable, str(TRAIN_SCRIPT)])
    if rc != 0:
        log(f"training step failed (rc={rc}); aborting publish")
        return rc
    publish_to_dynamodb()
    summary_path = DATA_DIR / "training-summary.json"
    if summary_path.exists():
        log(f"summary: {json.loads(summary_path.read_text())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
