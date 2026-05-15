#!/usr/bin/env python3
"""
sync_cars_catalog.py

Build / refresh the canonical car catalog from CarQuery + manual overrides.

For every existing entry in cars-catalog.json that is missing engine/spec
fields, query CarQuery's getTrims (year, make), pick the trim whose
model_name matches, and fold the spec fields back onto the catalog row.

Outputs (atomic, all under src/lib/data/cars-ml/):
  - cars-catalog.json          — full catalog
  - cars-search-catalog.json   — minimal slug/name/segment for search
  - cars-catalog-review.json   — entries needing human review

Idempotent. Falls back gracefully when CarQuery is unreachable: the
existing catalog is preserved and only review entries are emitted.

Throttled to 1 req/s. 3-retry exponential backoff. Atomic writes.
Structured JSON logs to stdout.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from _lib.http import RateLimiter, fetch_with_retry, json_log, timed, write_json_atomic  # noqa: E402

DATA_DIR = ROOT / "src" / "lib" / "data" / "cars-ml"
CATALOG_PATH = DATA_DIR / "cars-catalog.json"
SEARCH_PATH = DATA_DIR / "cars-search-catalog.json"
REVIEW_PATH = DATA_DIR / "cars-catalog-review.json"
OVERRIDES_PATH = DATA_DIR / "cars-catalog-overrides.json"
DENYLIST_PATH = DATA_DIR / "cars-catalog-title-denylist.json"

CARQUERY_BASE = os.environ.get("CARQUERY_BASE_URL", "https://www.carqueryapi.com/api/0.3/")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open() as fh:
        return json.load(fh)


def fetch_carquery_trims(make: str, year: int, limiter: RateLimiter) -> list[dict[str, Any]]:
    limiter.take()
    url = f"{CARQUERY_BASE}?cmd=getTrims&make={make}&year={year}"
    body = fetch_with_retry(
        url,
        headers={"User-Agent": "CarClubFuture/1.0 (+https://carclubfuture.com)"},
    )
    if body is None:
        return []
    # CarQuery wraps JSON in `?(...);` JSONP. Strip if present.
    text = body.strip()
    if text.startswith("?("):
        text = text[2:-2]
    elif text.startswith("(") and text.endswith(");"):
        text = text[1:-2]
    try:
        return json.loads(text).get("Trims", [])
    except json.JSONDecodeError:
        return []


def enrich_from_trim(car: dict[str, Any], trim: dict[str, Any]) -> dict[str, Any]:
    """Fold CarQuery trim fields onto a catalog row, only filling blanks."""
    out = dict(car)

    def _set_if_blank(key: str, value: Any) -> None:
        if value in (None, "", "null") or out.get(key) is not None:
            return
        out[key] = value

    cc = trim.get("model_engine_cc")
    cyl = trim.get("model_engine_cyl")
    body = (trim.get("model_body") or "").strip().lower() or None
    _set_if_blank("engineDisplacementCc", int(cc) if cc and str(cc).isdigit() else None)
    _set_if_blank("cylinders", int(cyl) if cyl and str(cyl).isdigit() else None)
    if body and out.get("bodyStyle") is None:
        # Normalize CarQuery body strings → our BodyStyle enum
        normalized = {
            "convertible": "convertible",
            "cabriolet": "convertible",
            "roadster": "convertible",
            "coupe": "coupe",
            "sedan": "sedan",
            "wagon": "wagon",
            "estate": "wagon",
            "suv": "suv",
            "truck": "truck",
            "pickup": "truck",
        }.get(body)
        if normalized:
            out["bodyStyle"] = normalized
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rps", type=float, default=1.0, help="CarQuery requests/sec (default 1)")
    args = parser.parse_args()

    raw = load_json(CATALOG_PATH, {"vehicles": []})
    catalog = raw.get("vehicles", []) if isinstance(raw, dict) else raw
    overrides: dict[str, Any] = load_json(OVERRIDES_PATH, {})
    denylist: list[str] = load_json(DENYLIST_PATH, [])

    by_slug = {c["slug"]: c for c in catalog}
    review: list[dict[str, Any]] = []
    limiter = RateLimiter(args.rps)

    with timed("sync:cars:catalog") as counters:
        counters["recordsProcessed"] = len(by_slug)

        # 1) Apply denylist + overrides
        for slug in list(by_slug.keys()):
            car = by_slug[slug]
            if any(d in (car.get("title", "") or "").lower() for d in denylist):
                json_log(operation="catalog.denied", slug=slug)
                del by_slug[slug]
                continue
            if slug in overrides:
                by_slug[slug] = {**car, **overrides[slug]}

        # 2) CarQuery enrichment for any row missing spec fields
        for slug, car in list(by_slug.items()):
            needs_specs = car.get("engineDisplacementCc") is None or car.get("cylinders") is None
            if not (needs_specs and car.get("year") and car.get("make")):
                continue
            trims = fetch_carquery_trims(car["make"], int(car["year"]), limiter)
            if not trims:
                review.append({"slug": slug, "reason": "carquery_no_results"})
                counters["failed"] += 1
                continue
            target_model = (car.get("model") or "").lower()
            target_trim = (car.get("trim") or "").lower()
            best = next(
                (
                    t for t in trims
                    if (t.get("model_name") or "").lower() == target_model
                    and (not target_trim or target_trim in (t.get("model_trim") or "").lower())
                ),
                None,
            ) or next(
                (t for t in trims if (t.get("model_name") or "").lower() == target_model),
                None,
            )
            if not best:
                review.append({"slug": slug, "reason": "carquery_no_model_match", "year": car["year"], "make": car["make"], "model": car.get("model")})
                counters["failed"] += 1
                continue
            by_slug[slug] = enrich_from_trim(car, best)
            counters["ok"] += 1

        catalog_out = sorted(
            by_slug.values(),
            key=lambda c: (c.get("year", 0), c.get("make", ""), c.get("model", "")),
        )
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
            json_log(operation="catalog.dry_run", entries=len(catalog_out), review=len(review))
            return 0

        write_json_atomic(
            CATALOG_PATH,
            {
                "version": raw.get("version", "1.0.0") if isinstance(raw, dict) else "1.0.0",
                "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "vehicles": catalog_out,
            },
        )
        write_json_atomic(SEARCH_PATH, search_out)
        write_json_atomic(REVIEW_PATH, review)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
