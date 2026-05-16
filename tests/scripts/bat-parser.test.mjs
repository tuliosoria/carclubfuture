/**
 * Unit tests for scripts/_lib/bat-parser.mjs
 *
 * Covers the three auction card states represented in the HTML fixture:
 *   (a) sold with reserve met
 *   (b) sold with no reserve (same "Sold for" text)
 *   (c) bid but reserve not met ("Bid to $XX,XXX")
 * Plus edge cases: empty HTML, URL builder correctness.
 *
 * No network calls, no filesystem I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { batSearchUrl, parseBatResultsHtml } from "../../scripts/_lib/bat-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, "fixtures/bat-results-snippet.html"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Test 1: batSearchUrl builds correct query string
// ---------------------------------------------------------------------------
test("batSearchUrl builds correct search URL", () => {
  const url = batSearchUrl({ year: 1969, make: "Chevrolet", model: "Camaro" });
  assert.ok(url.startsWith("https://bringatrailer.com/auctions/results/"), "base URL");
  assert.ok(url.includes("make=chevrolet"), "make param");
  assert.ok(url.includes("model=camaro"), "model param");
  assert.ok(url.includes("year_from=1969"), "year_from");
  assert.ok(url.includes("year_to=1969"), "year_to");
});

// ---------------------------------------------------------------------------
// Test 2: (a) sold-with-reserve-met card parsed correctly
// ---------------------------------------------------------------------------
test("parseBatResultsHtml: sold-with-reserve-met card", () => {
  const results = parseBatResultsHtml(fixture);
  assert.ok(Array.isArray(results), "returns array");
  assert.equal(results.length, 3, "3 cards in fixture");

  const sold = results[0];
  assert.equal(sold.soldPriceUsd, 72500, "price parsed");
  assert.equal(sold.soldDate, "2024-05-10", "date parsed to ISO");
  assert.equal(sold.reserveMet, true, "reserve met = true for 'Sold for'");
  assert.equal(sold.mileage, "45,212 Miles", "mileage present");
  assert.ok(sold.listingUrl?.includes("listing/"), "listingUrl");
  assert.ok(sold.title?.includes("Camaro"), "title");
});

// ---------------------------------------------------------------------------
// Test 3: (b) sold-no-reserve card — "Sold for" text, no mileage
// ---------------------------------------------------------------------------
test("parseBatResultsHtml: sold-no-reserve card (no mileage)", () => {
  const results = parseBatResultsHtml(fixture);
  const noReserve = results[1];
  assert.equal(noReserve.soldPriceUsd, 58000, "price parsed");
  assert.equal(noReserve.soldDate, "2024-03-03", "date parsed");
  assert.equal(noReserve.reserveMet, true, "'Sold for' → reserveMet true");
  assert.equal(noReserve.mileage, null, "no mileage element → null");
});

// ---------------------------------------------------------------------------
// Test 4: (c) bid-but-reserve-not-met card
// ---------------------------------------------------------------------------
test("parseBatResultsHtml: bid-but-reserve-not-met card", () => {
  const results = parseBatResultsHtml(fixture);
  const notMet = results[2];
  assert.equal(notMet.soldPriceUsd, 35000, "bid price parsed");
  assert.equal(notMet.soldDate, "2024-01-15", "date parsed");
  assert.equal(notMet.reserveMet, false, "'Bid to' → reserveMet false");
  assert.equal(notMet.mileage, "87,000 Miles", "mileage present");
});

// ---------------------------------------------------------------------------
// Test 5: empty HTML → empty array (no crash)
// ---------------------------------------------------------------------------
test("parseBatResultsHtml: empty HTML returns empty array", () => {
  const results = parseBatResultsHtml("<html><body></body></html>");
  assert.deepEqual(results, [], "empty array for empty page");
});
