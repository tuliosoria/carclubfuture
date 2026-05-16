/**
 * Unit tests for scripts/_lib/carapi.mjs (task A6).
 *
 * Run: node --test tests/scripts/carapi.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const carapiPath = join(__dirname, "../../scripts/_lib/carapi.mjs");

const { enrichWithCarApi } = await import(carapiPath);

/** No-op rate limiter so tests don't wait. */
const noOpRl = { take: () => Promise.resolve() };

// ─── A6: enrichWithCarApi ─────────────────────────────────────────────────────

test("A6: enrichWithCarApi sets carapiId and fills missing engineHp on a match", async () => {
  const fakeFetch = async (_url, _init) => ({
    json: async () => ({
      data: [
        {
          id: 42,
          engine_hp: 450,
          engine_torque: 410,
          city_mileage: 15,
          highway_mileage: 22,
          body: "Fastback",
        },
      ],
    }),
  });

  const rows = [
    {
      year: 2020,
      make: "ford",
      model: "Mustang",
      trim: "GT500",
      engineHp: null,
      engineTorque: null,
      mpgCity: null,
      mpgHwy: null,
      bodySubStyle: null,
    },
  ];

  await enrichWithCarApi(rows, { fetch: fakeFetch, rateLimiter: noOpRl, token: "test-token" });

  assert.equal(rows[0].carapiId, 42);
  assert.equal(rows[0].engineHp, 450);
  assert.equal(rows[0].engineTorque, 410);
  assert.equal(rows[0].mpgCity, 15);
  assert.equal(rows[0].mpgHwy, 22);
  assert.equal(rows[0].bodySubStyle, "Fastback");
});

test("A6: enrichWithCarApi leaves row unchanged when no CarAPI match is found", async () => {
  const fakeFetch = async (_url, _init) => ({
    json: async () => ({ data: [] }),
  });

  const original = {
    year: 1975,
    make: "amc",
    model: "Pacer",
    trim: "Base",
    engineHp: null,
  };
  const rows = [{ ...original }];

  await enrichWithCarApi(rows, { fetch: fakeFetch, rateLimiter: noOpRl, token: "test-token" });

  assert.equal(rows[0].carapiId, undefined, "carapiId must not be set on a miss");
  assert.equal(rows[0].engineHp, null, "existing null fields must not be touched");
  // No extra keys added beyond what was already there
  assert.deepEqual(Object.keys(rows[0]).sort(), Object.keys(original).sort());
});
