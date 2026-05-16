/**
 * Unit tests for mirror-car-images.mjs — selectImageForVehicle pure logic
 *
 * Covers the three fallback tiers:
 *   1. Wikimedia candidate present → source:"wikimedia", imageStatus:"ok"
 *   2. Wikimedia empty + OldCarsData imageUrl → source:"oldcarsdata", imageStatus:"ok"
 *   3. Both empty → source:"missing", imageStatus:"missing"
 *
 * No file I/O, no network calls, no DynamoDB — pure selection logic only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { selectImageForVehicle } from "../../scripts/mirror-car-images.mjs";

// A representative Wikimedia candidate (already in searchVehicleImages output shape)
const GOOD_WIKIMEDIA_CANDIDATE = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/1969_Camaro_Z28.jpg",
  width: 1920,
  height: 1080,
  mime: "image/jpeg",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  author: "WikiUser",
  title: "File:1969_Camaro_Z28.jpg",
};

const SLUG = "1969-chevrolet-camaro-z-28";
const CACHED_AT = "2025-01-15T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Test 1: Wikimedia candidate present
// ---------------------------------------------------------------------------

test("selectImageForVehicle — Wikimedia candidate → source:wikimedia, imageStatus:ok", () => {
  const result = selectImageForVehicle({
    wikimediaCandidates: [GOOD_WIKIMEDIA_CANDIDATE],
    oldcarsdataRecord: null,
    slug: SLUG,
    cachedAt: CACHED_AT,
  });

  assert.equal(result.source, "wikimedia");
  assert.equal(result.imageStatus, "ok");
  assert.equal(result.slug, SLUG);
  assert.equal(result.url, GOOD_WIKIMEDIA_CANDIDATE.url);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.cachedAt, CACHED_AT);

  // Attribution must always be fully populated
  assert.ok(result.attribution.author, "attribution.author must be set");
  assert.ok(result.attribution.license, "attribution.license must be set");
  assert.equal(typeof result.attribution.licenseUrl, "string");
});

// ---------------------------------------------------------------------------
// Test 2: Wikimedia empty + OldCarsData has imageUrl
// ---------------------------------------------------------------------------

test("selectImageForVehicle — Wikimedia empty + OldCarsData imageUrl → source:oldcarsdata, imageStatus:ok", () => {
  const oldcarsdataRecord = {
    asOf: "2025-01-01",
    conditionAnchor: 3,
    valueUsd: 75000,
    imageUrl: "https://bringatrailer.com/photos/camaro-z28-1969.jpg",
  };

  const result = selectImageForVehicle({
    wikimediaCandidates: [],
    oldcarsdataRecord,
    slug: SLUG,
    cachedAt: CACHED_AT,
  });

  assert.equal(result.source, "oldcarsdata");
  assert.equal(result.imageStatus, "ok");
  assert.equal(result.url, "https://bringatrailer.com/photos/camaro-z28-1969.jpg");

  // OldCarsData attribution must be populated and reference the source
  assert.ok(result.attribution.author.length > 0);
  assert.ok(result.attribution.license.length > 0);
  assert.equal(typeof result.attribution.licenseUrl, "string");
});

// ---------------------------------------------------------------------------
// Test 3: Both empty → missing
// ---------------------------------------------------------------------------

test("selectImageForVehicle — both Wikimedia and OldCarsData empty → source:missing, imageStatus:missing", () => {
  const result = selectImageForVehicle({
    wikimediaCandidates: [],
    oldcarsdataRecord: { asOf: "2025-01-01", valueUsd: 50000 }, // no imageUrl
    slug: SLUG,
    cachedAt: CACHED_AT,
  });

  assert.equal(result.source, "missing");
  assert.equal(result.imageStatus, "missing");
  assert.equal(result.url, "");

  // Even for missing images, attribution fields must not be null/undefined
  assert.notEqual(result.attribution.author, null);
  assert.notEqual(result.attribution.author, undefined);
  assert.notEqual(result.attribution.license, null);
  assert.notEqual(result.attribution.license, undefined);
  assert.notEqual(result.attribution.licenseUrl, null);
  assert.notEqual(result.attribution.licenseUrl, undefined);
});

// ---------------------------------------------------------------------------
// Test 4: Wikimedia candidates present but none qualify (too small / bad license)
// — should fall through to OldCarsData
// ---------------------------------------------------------------------------

test("selectImageForVehicle — non-qualifying Wikimedia candidates fall through to OldCarsData", () => {
  const badCandidates = [
    // Too small
    { url: "https://example.com/tiny.jpg", width: 200, height: 150,
      license: "CC BY-SA 4.0", licenseUrl: "", author: "X", title: "File:Tiny.jpg" },
    // Bad license
    { url: "https://example.com/bad.jpg", width: 2000, height: 1500,
      license: "All rights reserved", licenseUrl: "", author: "Y", title: "File:Bad.jpg" },
  ];

  const result = selectImageForVehicle({
    wikimediaCandidates: badCandidates,
    oldcarsdataRecord: { imageUrl: "https://bat.auction/car.jpg" },
    slug: SLUG,
    cachedAt: CACHED_AT,
  });

  assert.equal(result.source, "oldcarsdata");
  assert.equal(result.imageStatus, "ok");
});

// ---------------------------------------------------------------------------
// Test 5: Attribution fields are always strings, never null/undefined
// ---------------------------------------------------------------------------

test("selectImageForVehicle — attribution fields are always populated strings", () => {
  const scenarios = [
    // wikimedia with minimal attribution
    {
      wikimediaCandidates: [{
        url: "https://example.com/car.jpg", width: 1000, height: 750,
        license: "CC0", licenseUrl: "", author: "", title: "File:Car.jpg",
      }],
      oldcarsdataRecord: null,
    },
    // oldcarsdata
    { wikimediaCandidates: [], oldcarsdataRecord: { imageUrl: "https://bat.auction/x.jpg" } },
    // missing
    { wikimediaCandidates: [], oldcarsdataRecord: null },
  ];

  for (const { wikimediaCandidates, oldcarsdataRecord } of scenarios) {
    const result = selectImageForVehicle({ wikimediaCandidates, oldcarsdataRecord, slug: SLUG });
    assert.equal(typeof result.attribution.author, "string", `author must be string (source: ${result.source})`);
    assert.equal(typeof result.attribution.license, "string", `license must be string (source: ${result.source})`);
    assert.equal(typeof result.attribution.licenseUrl, "string", `licenseUrl must be string (source: ${result.source})`);
    assert.ok(result.attribution.author.length > 0, `author must not be empty (source: ${result.source})`);
    assert.ok(result.attribution.license.length > 0, `license must not be empty (source: ${result.source})`);
  }
});
