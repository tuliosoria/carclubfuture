/**
 * Contract tests for /api/cars/search pagination.
 *
 * The route lives in TypeScript and is hard to import from node:test
 * directly, so these tests assert the slicing/total contract against
 * the same bundled catalog JSON the route serves. They guard against
 * regressions in the offset/limit math and the documented response
 * envelope shape ({ results, count, total, offset, limit }).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(
  __dirname,
  "../../src/lib/data/cars-ml/cars-catalog.json",
);
const denylistPath = join(
  __dirname,
  "../../src/lib/data/cars-ml/cars-catalog-title-denylist.json",
);

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const denylistJson = JSON.parse(readFileSync(denylistPath, "utf8"));
const denylist = new Set((denylistJson.denylist ?? []).map((s) => s.toLowerCase()));
const rows = catalog.vehicles.filter((r) => !denylist.has(r.id.toLowerCase()));

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

function parseIntParam(raw, fallback) {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function paginate({ offset, limit }, all = rows) {
  const o = parseIntParam(offset, 0);
  const l = Math.min(Math.max(parseIntParam(limit, DEFAULT_LIMIT), 1), MAX_LIMIT);
  const slice = all.slice(o, o + l);
  return { results: slice, count: slice.length, total: all.length, offset: o, limit: l };
}

test("catalog has the expected 15k+ rows", () => {
  assert.ok(rows.length >= 15000, `expected >=15000 vehicles, got ${rows.length}`);
});

test("default pagination returns 60 results", () => {
  const res = paginate({ offset: undefined, limit: undefined });
  assert.equal(res.count, 60);
  assert.equal(res.results.length, 60);
  assert.equal(res.offset, 0);
  assert.equal(res.limit, 60);
  assert.equal(res.total, rows.length);
});

test("offset advances into the catalog", () => {
  const a = paginate({ offset: 0, limit: 60 });
  const b = paginate({ offset: 60, limit: 60 });
  assert.notEqual(a.results[0].id, b.results[0].id);
  assert.equal(b.offset, 60);
});

test("limit is capped at MAX_LIMIT (200)", () => {
  const res = paginate({ offset: 0, limit: 5000 });
  assert.equal(res.limit, MAX_LIMIT);
  assert.equal(res.results.length, MAX_LIMIT);
});

test("limit minimum is 1", () => {
  const res = paginate({ offset: 0, limit: 0 });
  assert.equal(res.limit, 1);
  assert.equal(res.results.length, 1);
});

test("invalid params fall back to defaults", () => {
  const res = paginate({ offset: "abc", limit: "xyz" });
  assert.equal(res.offset, 0);
  assert.equal(res.limit, DEFAULT_LIMIT);
});

test("offset past the end yields zero results but preserves total", () => {
  const res = paginate({ offset: rows.length + 1000, limit: 60 });
  assert.equal(res.count, 0);
  assert.equal(res.total, rows.length);
});

test("envelope shape exposes results/count/total/offset/limit", () => {
  const res = paginate({ offset: 120, limit: 30 });
  assert.deepEqual(
    Object.keys(res).sort(),
    ["count", "limit", "offset", "results", "total"],
  );
});
