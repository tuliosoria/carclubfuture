#!/usr/bin/env python3
"""
sync_cars_catalog.py

Build the canonical car catalog from CarQuery + NHTSA + manual overrides.
Emits:
  - src/lib/data/cars-ml/cars-catalog.json
  - src/lib/data/cars-ml/cars-catalog-review.json
  - src/lib/data/cars-ml/cars-search-catalog.json

Designed to be idempotent: existing entries are upserted; overrides win.
Falls back gracefully when network is unavailable (no-op + exit 0).

Usage:
  python3 scripts/sync_cars_catalog.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "lib" / "data" / "cars-ml"
CATALOG_PATH = DATA_DIR / "cars-catalog.json"
SEARCH_PATH = DATA_DIR / "cars-search-catalog.json"
REVIEW_PATH = DATA_DIR / "cars-catalog-review.json"
OVERRIDES_PATH = DATA_DIR / "cars-catalog-overrides.json"
DENYLIST_PATH = DATA_DIR / "cars-catalog-title-denylist.json"

CARQUERY_BASE = os.environ.get(
    "CARQUERY_BASE_URL", "https://www.carqueryapi.com/api/0.3/"
)


def log(msg: str) -> None:
    print(f"[sync:cars:catalog] {msg}", file=sys.stderr)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open() as fh:
        return json.load(fh)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def slugify(text: str) -> str:
    keep = []
    prev_dash = False
    for ch in text.lower():
        if ch.isalnum():
            keep.append(ch)
            prev_dash = False
        elif not prev_dash:
            keep.append("-")
            prev_dash = True
    return "".join(keep).strip("-")


def fetch_carquery(make: str, year: int) -> list[dict[str, Any]]:
    try:
        import urllib.request
    except ImportError:
        return []
    url = f"{CARQUERY_BASE}?cmd=getTrims&make={make}&year={year}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CarClubFuture/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8", errors="replace")
        # CarQuery wraps JSON in `?(...);` JSONP. Strip if present.
        if text.startswith("?("):
            text = text[2:-2]
        return json.loads(text).get("Trims", [])
    except Exception as exc:  # noqa: BLE001
        log(f"carquery fetch failed for {make} {year}: {exc}")
        return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    raw: Any = load_json(CATALOG_PATH, [])
    if isinstance(raw, dict):
        catalog = raw.get("vehicles", [])
    else:
        catalog = raw
    overrides: dict[str, Any] = load_json(OVERRIDES_PATH, {})
    denylist: list[str] = load_json(DENYLIST_PATH, [])

    log(f"loaded {len(catalog)} existing entries; {len(overrides)} overrides; {len(denylist)} denied titles")

    by_slug = {c["slug"]: c for c in catalog}
    review: list[dict[str, Any]] = []
    fetched = 0

    for slug, car in list(by_slug.items()):
        if any(d in (car.get("title", "") or "").lower() for d in denylist):
            log(f"removing denied-title vehicle: {slug}")
            del by_slug[slug]
            continue
        if slug in overrides:
            by_slug[slug] = {**car, **overrides[slug]}
        if not car.get("trim") and (year := car.get("year")) and (make := car.get("make")):
            trims = fetch_carquery(make, year)
            fetched += 1
            for t in trims:
                if t.get("model_name", "").lower() == car.get("model", "").lower():
                    review.append({"slug": slug, "candidate_trim": t.get("model_trim")})
                    break
            time.sleep(0.4)  # be nice

    catalog_out = sorted(by_slug.values(), key=lambda c: (c.get("year", 0), c.get("make", ""), c.get("model", "")))
    search_out = [
        {
            "slug": c["slug"],
            "displayName": c["displayName"],
            "searchAliases": c.get("searchAliases", []),
            "segment": c.get("segment"),
        }
        for c in catalog_out
    ]

    if args.dry_run:
        log(f"dry-run: would write {len(catalog_out)} catalog entries, {len(review)} review items, {fetched} carquery hits")
        return 0

    save_json(CATALOG_PATH, catalog_out)
    save_json(SEARCH_PATH, search_out)
    save_json(REVIEW_PATH, review)
    log(f"wrote {len(catalog_out)} catalog entries, {len(review)} review items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
