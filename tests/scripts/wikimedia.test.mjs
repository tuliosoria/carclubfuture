/**
 * Unit tests for scripts/_lib/wikimedia.mjs
 *
 * Tests the pure helpers: pickBestImage, extractAttribution, and
 * (with a fake fetch) searchVehicleImages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pickBestImage,
  extractAttribution,
  searchVehicleImages,
} from "../../scripts/_lib/wikimedia.mjs";

// ---------------------------------------------------------------------------
// pickBestImage
// ---------------------------------------------------------------------------

test("pickBestImage — returns the single qualifying candidate from a mixed set", () => {
  const candidates = [
    // Too small: rejected
    { url: "https://example.com/small.jpg", width: 400, height: 300, mime: "image/jpeg",
      license: "CC BY-SA 4.0", licenseUrl: "", author: "Alice", title: "File:Small.jpg" },
    // Bad license: rejected
    { url: "https://example.com/rights.jpg", width: 1200, height: 900, mime: "image/jpeg",
      license: "All rights reserved", licenseUrl: "", author: "Bob", title: "File:Rights.jpg" },
    // Good: wide, open license
    { url: "https://example.com/good.jpg", width: 1600, height: 1200, mime: "image/jpeg",
      license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      author: "Carol", title: "File:Good.jpg" },
  ];

  const result = pickBestImage(candidates);
  assert.ok(result, "should return a candidate");
  assert.equal(result.url, "https://example.com/good.jpg");
  assert.equal(result.author, "Carol");
});

test("pickBestImage — empty array returns null", () => {
  assert.equal(pickBestImage([]), null);
});

test("pickBestImage — null/undefined input returns null", () => {
  assert.equal(pickBestImage(null), null);
  assert.equal(pickBestImage(undefined), null);
});

test("pickBestImage — rejects images whose title contains 'interior', 'engine', or 'logo'", () => {
  const candidates = [
    { url: "https://example.com/interior.jpg", width: 2000, height: 1500,
      license: "CC BY 2.0", licenseUrl: "", author: "X", title: "File:Car interior view.jpg" },
    { url: "https://example.com/engine.jpg", width: 2000, height: 1500,
      license: "CC0", licenseUrl: "", author: "Y", title: "File:Engine bay 2.jpg" },
    { url: "https://example.com/logo.jpg", width: 2000, height: 1500,
      license: "CC BY-SA 4.0", licenseUrl: "", author: "Z", title: "File:Brand logo vector.jpg" },
  ];
  assert.equal(pickBestImage(candidates), null);
});

test("pickBestImage — among multiple qualifying candidates picks the widest", () => {
  const candidates = [
    { url: "https://example.com/med.jpg", width: 1000, height: 750,
      license: "Public domain", licenseUrl: "", author: "A", title: "File:Med.jpg" },
    { url: "https://example.com/wide.jpg", width: 2400, height: 1800,
      license: "CC BY 4.0", licenseUrl: "", author: "B", title: "File:Wide.jpg" },
    { url: "https://example.com/narrow.jpg", width: 900, height: 600,
      license: "CC BY-SA 3.0", licenseUrl: "", author: "C", title: "File:Narrow.jpg" },
  ];
  const result = pickBestImage(candidates);
  assert.equal(result.url, "https://example.com/wide.jpg");
});

// ---------------------------------------------------------------------------
// extractAttribution
// ---------------------------------------------------------------------------

test("extractAttribution — handles missing/empty extmetadata gracefully (no throw)", () => {
  // null
  const r1 = extractAttribution(null);
  assert.equal(r1.author, "Unknown");
  assert.equal(r1.license, "Unknown");
  assert.equal(typeof r1.licenseUrl, "string"); // never undefined

  // empty object
  const r2 = extractAttribution({});
  assert.equal(r2.author, "Unknown");
  assert.equal(r2.license, "Unknown");
  assert.equal(r2.licenseUrl, "");

  // undefined
  const r3 = extractAttribution(undefined);
  assert.equal(r3.author, "Unknown");
  assert.equal(r3.license, "Unknown");
});

test("extractAttribution — returns correct values for a typical Wikimedia extmetadata blob", () => {
  const extmetadata = {
    LicenseShortName: { value: "CC BY-SA 4.0" },
    Artist: { value: "<a href=\"/wiki/User:Foo\" title=\"User:Foo\">Foo Bar</a>" },
    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
  };

  const result = extractAttribution(extmetadata);
  assert.equal(result.license, "CC BY-SA 4.0");
  assert.equal(result.author, "Foo Bar"); // HTML stripped
  assert.equal(result.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
});

test("extractAttribution — never returns null/undefined for any field", () => {
  const partialMeta = {
    LicenseShortName: { value: "CC0" },
    // no Artist, no LicenseUrl
  };

  const result = extractAttribution(partialMeta);
  assert.ok(result.author !== null && result.author !== undefined);
  assert.ok(result.license !== null && result.license !== undefined);
  assert.ok(result.licenseUrl !== null && result.licenseUrl !== undefined);
});

// ---------------------------------------------------------------------------
// searchVehicleImages — with injected fake fetch
// ---------------------------------------------------------------------------

test("searchVehicleImages — normalises a documented Wikimedia API response shape", async () => {
  // Build a minimal Wikimedia query response (matches real Commons JSON shape)
  const fakeResponse = {
    query: {
      pages: {
        "-1": {
          pageid: -1,
          index: 1,
          title: "File:1994 Toyota Supra.jpg",
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/1994_Toyota_Supra.jpg",
              width: 1920,
              height: 1080,
              mime: "image/jpeg",
              extmetadata: {
                LicenseShortName: { value: "CC BY-SA 4.0" },
                Artist: { value: "TestAuthor" },
                LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
              },
            },
          ],
        },
      },
    },
  };

  const fakeFetch = async () => ({
    ok: true,
    json: async () => fakeResponse,
  });

  const results = await searchVehicleImages({
    year: 1994,
    make: "Toyota",
    model: "Supra",
    fetch: fakeFetch,
  });

  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.url, "https://upload.wikimedia.org/wikipedia/commons/a/ab/1994_Toyota_Supra.jpg");
  assert.equal(r.width, 1920);
  assert.equal(r.height, 1080);
  assert.equal(r.mime, "image/jpeg");
  assert.equal(r.license, "CC BY-SA 4.0");
  assert.equal(r.author, "TestAuthor");
  assert.equal(r.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(r.title, "File:1994 Toyota Supra.jpg");
});
