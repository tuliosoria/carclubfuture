"""
Shared HTTP / log / atomic-write helpers for Python sync scripts.

- ``fetch_with_retry(url, headers=...)`` — 3 attempts, exponential backoff
  (200/400/800 ms) with ±25% jitter. Retries on network errors and on
  HTTP 429/5xx. Returns the final ``urllib.response`` body (str) on
  success, ``None`` on terminal failure.
- ``RateLimiter(rps)`` — token bucket. ``rl.take()`` blocks until the
  next slot is free.
- ``write_json_atomic(path, data)`` — writes to ``<path>.tmp``, fsyncs,
  then ``os.replace`` (atomic on POSIX, same filesystem).
- ``json_log(**fields)`` — structured log line to stdout.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DEFAULT_DELAYS_MS = (200, 400, 800)


def _jitter(base_ms: int) -> float:
    spread = base_ms * 0.25
    return base_ms + random.uniform(-spread, spread)


def fetch_with_retry(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: int = 15,
    delays_ms: tuple[int, ...] = DEFAULT_DELAYS_MS,
) -> str | None:
    """Returns response body as str on success, None on terminal failure."""
    attempts = len(delays_ms) + 1
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if 200 <= resp.status < 300:
                    return resp.read().decode("utf-8", errors="replace")
                if resp.status < 500 and resp.status != 429:
                    return None  # 4xx not worth retrying
        except urllib.error.HTTPError as exc:
            if exc.code < 500 and exc.code != 429:
                return None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        if i < len(delays_ms):
            time.sleep(_jitter(delays_ms[i]) / 1000.0)
    return None


class RateLimiter:
    def __init__(self, rps: float) -> None:
        self.interval = 1.0 / max(0.1, rps)
        self.next = 0.0

    def take(self) -> None:
        now = time.monotonic()
        wait = max(0.0, self.next - now)
        self.next = max(now, self.next) + self.interval
        if wait > 0:
            time.sleep(wait)


def write_json_atomic(path: Path, data: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def json_log(**fields: Any) -> None:
    payload = {"ts": datetime.now(timezone.utc).isoformat(), **fields}
    if isinstance(payload.get("error"), BaseException):
        payload["error"] = repr(payload["error"])
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


@contextmanager
def timed(operation: str) -> Iterator[dict[str, Any]]:
    """Context manager that logs duration + counters when exiting."""
    start = time.monotonic()
    counters: dict[str, Any] = {"recordsProcessed": 0, "ok": 0, "failed": 0}
    try:
        yield counters
        json_log(
            operation=operation,
            durationMs=int((time.monotonic() - start) * 1000),
            **counters,
        )
    except BaseException as exc:  # noqa: BLE001
        json_log(
            operation=operation,
            durationMs=int((time.monotonic() - start) * 1000),
            error=exc,
            **counters,
        )
        raise
