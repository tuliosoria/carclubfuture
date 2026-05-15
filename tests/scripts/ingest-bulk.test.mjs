/**
 * Unit tests for ingest-cars-catalog-bulk.mjs (tasks A1-A4).
 *
 * Run: node --test tests/scripts/ingest-bulk.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink, readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(
  __dirname,
  "../../scripts/ingest-cars-catalog-bulk.mjs"
);

// Dynamic import so we pick up the real module exports.
const {
  resumeState,
  saveCheckpoint,
  fetchMakes,
  fetchTrimsForMake,
  slugify,
  ingest,
} = await import(scriptPath);

/** No-op rate limiter so tests don't wait 1 second per call. */
const noOpRl = { take: () => Promise.resolve() };

// ─── A1: resumeState ─────────────────────────────────────────────────────────

test("A1: resumeState returns empty default for nonexistent path", async () => {
  const state = await resumeState("/nonexistent/path/that/does/not/exist.json");
  assert.deepEqual(state, { completedMakes: [], lastYear: null });
});

// ─── A2: fetchMakes ──────────────────────────────────────────────────────────

test("A2: fetchMakes normalizes CarQuery Makes response", async () => {
  const fakeFetch = async (_url) => ({
    json: async () => ({
      Makes: [
        {
          make_id: "ford",
          make_display: "Ford",
          make_country: "USA",
          make_is_common: "1",
        },
        {
          make_id: "chevrolet",
          make_display: "Chevrolet",
          make_country: "USA",
          make_is_common: "1",
        },
      ],
    }),
  });

  const makes = await fetchMakes(2020, { fetch: fakeFetch, rateLimiter: noOpRl });

  assert.equal(makes.length, 2);
  assert.deepEqual(makes[0], {
    id: "ford",
    display: "Ford",
    country: "USA",
    isCommon: "1",
  });
  assert.deepEqual(makes[1], {
    id: "chevrolet",
    display: "Chevrolet",
    country: "USA",
    isCommon: "1",
  });
});

// ─── A3: fetchTrimsForMake ────────────────────────────────────────────────────

test("A3: fetchTrimsForMake filters non-US trims, normalizes fields, and slugifies", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("cmd=getModels")) {
      return {
        json: async () => ({
          Models: [{ model_name: "Mustang GT/CS", model_make_id: "ford" }],
        }),
      };
    }
    // getTrims: 1 US trim + 1 non-US trim
    return {
      json: async () => ({
        Trims: [
          {
            model_id: "12345",
            model_name: "Mustang GT/CS",
            model_trim: "GT/CS",
            model_year: "2007",
            model_body: "Coupe",
            model_engine_cc: "4601",
            model_engine_cyl: "8",
            model_engine_fuel: "Gasoline",
            model_transmission_type: "Automatic",
            model_drive: "RWD",
            sold_in_us: "1",
          },
          {
            model_id: "12346",
            model_name: "Mustang GT/CS",
            model_trim: "Export",
            model_year: "2007",
            model_body: "Coupe",
            model_engine_cc: "2300",
            model_engine_cyl: "4",
            model_engine_fuel: "Gasoline",
            model_transmission_type: "Manual",
            model_drive: "RWD",
            sold_in_us: "0", // not sold in US — must be filtered
          },
        ],
      }),
    };
  };

  const trims = await fetchTrimsForMake("ford", 2007, {
    fetch: fakeFetch,
    rateLimiter: noOpRl,
    makeDisplay: "Ford",
  });

  assert.equal(trims.length, 1, "non-US trim must be filtered out");

  const trim = trims[0];
  assert.equal(trim.carqueryId, "12345");
  // slug: "2007-ford-mustang-gt-cs-gt-cs" — slugify strips / and collapses
  assert.equal(trim.slug, slugify("2007-ford-Mustang GT/CS-GT/CS"));
  assert.ok(
    /^[a-z0-9-]+$/.test(trim.slug),
    "slug must be clean lower-kebab"
  );
  assert.equal(trim.year, 2007);
  assert.equal(trim.make, "ford");
  assert.equal(trim.makeDisplay, "Ford");
  assert.equal(trim.model, "Mustang GT/CS");
  assert.equal(trim.trim, "GT/CS");
  assert.equal(trim.bodyStyle, "Coupe");
  assert.equal(trim.engineDisplacementCc, 4601);
  assert.equal(trim.cylinders, 8);
  assert.equal(trim.fuel, "Gasoline");
  assert.equal(trim.transmission, "Automatic");
  assert.equal(trim.driveType, "RWD");
  assert.equal(trim.source, "carquery");
});

// ─── A4: ingest ──────────────────────────────────────────────────────────────

test("A4: ingest writes deduped sorted JSON for 1yr × 1make × 1model × 1trim", async () => {
  const outputPath = join(
    __dirname,
    "../../scripts/output/test-ingest-output.json"
  );
  const checkpointPath = join(
    __dirname,
    "../../scripts/output/test-ingest-checkpoint.json"
  );

  // Clean up any leftover files from a previous run.
  await unlink(outputPath).catch(() => {});
  await unlink(checkpointPath).catch(() => {});

  const fakeFetch = async (url) => {
    if (url.includes("cmd=getMakes")) {
      return {
        json: async () => ({
          Makes: [
            {
              make_id: "ford",
              make_display: "Ford",
              make_country: "USA",
              make_is_common: "1",
            },
          ],
        }),
      };
    }
    if (url.includes("cmd=getModels")) {
      return {
        json: async () => ({
          Models: [{ model_name: "Mustang", model_make_id: "ford" }],
        }),
      };
    }
    // getTrims
    return {
      json: async () => ({
        Trims: [
          {
            model_id: "99999",
            model_name: "Mustang",
            model_trim: "GT",
            model_year: "2020",
            model_body: "Coupe",
            model_engine_cc: "5000",
            model_engine_cyl: "8",
            model_engine_fuel: "Gasoline",
            model_transmission_type: "Automatic",
            model_drive: "RWD",
            sold_in_us: "1",
          },
        ],
      }),
    };
  };

  const result = await ingest({
    startYear: 2020,
    endYear: 2020,
    checkpointPath,
    outputPath,
    fetch: fakeFetch,
    rateLimiter: noOpRl,
  });

  // Return value check
  assert.ok(Array.isArray(result), "ingest() should return an array");
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "2020-ford-mustang-gt");
  assert.equal(result[0].year, 2020);
  assert.equal(result[0].make, "ford");
  assert.equal(result[0].makeDisplay, "Ford");
  assert.equal(result[0].source, "carquery");

  // File on disk check
  const raw = await readFile(outputPath, "utf8");
  const fromDisk = JSON.parse(raw);
  assert.ok(Array.isArray(fromDisk), "output file should contain an array");
  assert.equal(fromDisk.length, 1);
  assert.equal(fromDisk[0].slug, "2020-ford-mustang-gt");

  // Checkpoint should record year as complete
  const cpRaw = await readFile(checkpointPath, "utf8");
  const cp = JSON.parse(cpRaw);
  assert.equal(cp.lastYear, 2020);

  // Clean up
  await unlink(outputPath).catch(() => {});
  await unlink(checkpointPath).catch(() => {});
});
