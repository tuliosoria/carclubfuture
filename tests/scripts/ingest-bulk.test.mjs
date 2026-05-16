/**
 * Unit tests for the NHTSA-primary bulk catalog ingest.
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

const {
  resumeState,
  fetchMakes,
  fetchModelsForMakeYear,
  buildRow,
  slugify,
  eraForYear,
  ingest,
  scoreConfidence,
} = await import(scriptPath);

const noOpRl = { take: () => Promise.resolve() };
const okResp = (body) => ({ ok: true, status: 200, json: async () => body });

// ─── resumeState ─────────────────────────────────────────────────────────────

test("resumeState returns empty default for nonexistent path", async () => {
  const state = await resumeState(
    "/nonexistent/path/that/does/not/exist.json"
  );
  assert.deepEqual(state, { completedMakeIds: [], lastYear: null });
});

// ─── fetchMakes ──────────────────────────────────────────────────────────────

test("fetchMakes maps NHTSA Results to {id, display}", async () => {
  const fakeFetch = async (_url) =>
    okResp({
      Results: [
        { MakeId: 460, MakeName: "FORD", VehicleTypeName: "Passenger Car" },
        {
          MakeId: 467,
          MakeName: "CHEVROLET",
          VehicleTypeName: "Passenger Car",
        },
      ],
    });

  const makes = await fetchMakes({ fetch: fakeFetch, rateLimiter: noOpRl });
  assert.equal(makes.length, 2);
  assert.deepEqual(makes[0], { id: 460, display: "FORD" });
  assert.deepEqual(makes[1], { id: 467, display: "CHEVROLET" });
});

// ─── fetchModelsForMakeYear ──────────────────────────────────────────────────

test("fetchModelsForMakeYear normalizes NHTSA Results", async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /makeId\/460\/modelyear\/2020/);
    return okResp({
      Results: [
        {
          Make_ID: 460,
          Make_Name: "FORD",
          Model_ID: 1781,
          Model_Name: "Mustang",
        },
      ],
    });
  };
  const models = await fetchModelsForMakeYear(460, 2020, {
    fetch: fakeFetch,
    rateLimiter: noOpRl,
  });
  assert.equal(models.length, 1);
  assert.deepEqual(models[0], {
    modelId: 1781,
    modelName: "Mustang",
    makeId: 460,
    makeName: "FORD",
  });
});

// ─── buildRow / slugify / eraForYear ─────────────────────────────────────────

test("buildRow produces a BulkCatalogRow with NHTSA id + null unknowns", () => {
  const row = buildRow({
    year: 1969,
    make: { id: 460, display: "FORD" },
    model: { modelId: 1781, modelName: "Mustang Boss 429" },
  });
  assert.equal(row.slug, "1969-ford-mustang-boss-429");
  assert.equal(row.year, 1969);
  assert.equal(row.make, "FORD");
  assert.equal(row.model, "Mustang Boss 429");
  assert.equal(row.nhtsaId, "1781");
  assert.equal(row.carqueryId, null);
  assert.equal(row.engineDisplacementCc, null);
  assert.equal(row.cylinders, null);
  assert.equal(row.transmission, null);
  assert.equal(row.bodyStyle, null);
  assert.equal(row.countryOfOrigin, null);
  assert.equal(row.era, "muscle-era");
  assert.equal(row.source, "nhtsa");
  assert.equal(row.catalogConfidence, "low");
});

test("slugify is ascii-only kebab", () => {
  assert.equal(slugify("1990 Citroën DS/19"), "1990-citroen-ds-19");
  assert.match(slugify("XYZ"), /^[a-z0-9-]+$/);
});

test("eraForYear covers each Era bucket", () => {
  assert.equal(eraForYear(1939), "pre-war");
  assert.equal(eraForYear(1955), "post-war-classic");
  assert.equal(eraForYear(1968), "muscle-era");
  assert.equal(eraForYear(1980), "malaise");
  assert.equal(eraForYear(1992), "modern-classic");
  assert.equal(eraForYear(2010), "modern-collectible");
});

// ─── scoreConfidence ─────────────────────────────────────────────────────────

test("scoreConfidence: NHTSA-only is low", () => {
  assert.equal(scoreConfidence({ nhtsaId: "1781" }), "low");
});

test("scoreConfidence: NHTSA + CarAPI is medium", () => {
  assert.equal(scoreConfidence({ nhtsaId: "1781", carapiId: 99 }), "medium");
});

test("scoreConfidence: NHTSA + CarAPI + CarQuery is high", () => {
  assert.equal(
    scoreConfidence({ nhtsaId: "1", carapiId: 2, carqueryId: "x" }),
    "high"
  );
});

// ─── ingest end-to-end (mocked) ──────────────────────────────────────────────

test("ingest writes deduped sorted JSON for 1yr × 1make × 1model", async () => {
  const outputPath = join(
    __dirname,
    "../../scripts/output/test-ingest-output.json"
  );
  const checkpointPath = join(
    __dirname,
    "../../scripts/output/test-ingest-checkpoint.json"
  );
  await unlink(outputPath).catch(() => {});
  await unlink(checkpointPath).catch(() => {});

  const fakeFetch = async (url) => {
    if (url.includes("GetMakesForVehicleType")) {
      return okResp({
        Results: [
          { MakeId: 460, MakeName: "FORD", VehicleTypeName: "Passenger Car" },
        ],
      });
    }
    // GetModelsForMakeIdYear
    return okResp({
      Results: [
        {
          Make_ID: 460,
          Make_Name: "FORD",
          Model_ID: 1781,
          Model_Name: "Mustang",
        },
      ],
    });
  };

  const result = await ingest({
    startYear: 2020,
    endYear: 2020,
    checkpointPath,
    outputPath,
    fetch: fakeFetch,
    rateLimiter: noOpRl,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "2020-ford-mustang");
  assert.equal(result[0].nhtsaId, "1781");
  assert.equal(result[0].source, "nhtsa");

  const fromDisk = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(fromDisk.length, 1);
  assert.equal(fromDisk[0].slug, "2020-ford-mustang");

  const cp = JSON.parse(await readFile(checkpointPath, "utf8"));
  assert.equal(cp.lastYear, 2020);

  await unlink(outputPath).catch(() => {});
  await unlink(checkpointPath).catch(() => {});
});

// ─── Crash-resume durability (per-year incremental flush) ────────────────────

test("ingest flushes after each year — partial data survives crash mid-run", async () => {
  const outputPath = join(
    __dirname,
    "../../scripts/output/test-ingest-crash-output.json"
  );
  const checkpointPath = join(
    __dirname,
    "../../scripts/output/test-ingest-crash-checkpoint.json"
  );
  await unlink(outputPath).catch(() => {});
  await unlink(checkpointPath).catch(() => {});

  // GetMakesForVehicleType returns 6 makes; on the year-2020 descent,
  // every model fetch throws, triggering the >5-consecutive-failure abort.
  // Years 2022 + 2021 should have already been flushed.
  const sixMakes = [1, 2, 3, 4, 5, 6].map((id) => ({
    MakeId: id,
    MakeName: `M${id}`,
    VehicleTypeName: "Passenger Car",
  }));
  const fakeFetchCrash = async (url) => {
    if (url.includes("GetMakesForVehicleType")) {
      return okResp({ Results: sixMakes });
    }
    const yr = url.match(/modelyear\/(\d+)/)?.[1] ?? "0";
    if (yr === "2020") {
      throw new Error("simulated crash on year 2020");
    }
    const makeId = url.match(/makeId\/(\d+)/)?.[1] ?? "0";
    return okResp({
      Results: [
        {
          Make_ID: Number(makeId),
          Make_Name: `M${makeId}`,
          Model_ID: Number(`${yr}${makeId}`),
          Model_Name: `Model${yr}-${makeId}`,
        },
      ],
    });
  };

  await assert.rejects(
    () =>
      ingest({
        startYear: 2020,
        endYear: 2022,
        checkpointPath,
        outputPath,
        fetch: fakeFetchCrash,
        rateLimiter: noOpRl,
      }),
    /aborting: >5 consecutive NHTSA failures/
  );

  const partial = JSON.parse(await readFile(outputPath, "utf8"));
  assert.ok(Array.isArray(partial));
  assert.equal(
    partial.length,
    12,
    "two completed years × 6 makes × 1 model each should be flushed"
  );
  const partialYears = [...new Set(partial.map((r) => r.year))].sort();
  assert.deepEqual(partialYears, [2021, 2022]);

  // Resume — only year 2020 is left to process. All 6 makes succeed this time.
  const fakeFetchResume = async (url) => {
    if (url.includes("GetMakesForVehicleType")) {
      return okResp({ Results: sixMakes });
    }
    const yr = url.match(/modelyear\/(\d+)/)?.[1] ?? "0";
    const makeId = url.match(/makeId\/(\d+)/)?.[1] ?? "0";
    return okResp({
      Results: [
        {
          Make_ID: Number(makeId),
          Make_Name: `M${makeId}`,
          Model_ID: Number(`${yr}${makeId}`),
          Model_Name: `Model${yr}-${makeId}`,
        },
      ],
    });
  };

  const resumed = await ingest({
    startYear: 2020,
    endYear: 2022,
    checkpointPath,
    outputPath,
    fetch: fakeFetchResume,
    rateLimiter: noOpRl,
  });
  assert.equal(resumed.length, 18, "3 years × 6 makes × 1 model = 18");
  const allYears = [...new Set(resumed.map((r) => r.year))].sort();
  assert.deepEqual(allYears, [2020, 2021, 2022]);

  await unlink(outputPath).catch(() => {});
  await unlink(checkpointPath).catch(() => {});
});
