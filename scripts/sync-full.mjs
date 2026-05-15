#!/usr/bin/env node
/**
 * sync-full.mjs — end-to-end orchestrator for the CarClubFuture data pipeline.
 *
 * Runs all sync/build scripts in dependency order. Optional steps that are
 * missing required env vars are skipped (logged, not failed). If a required
 * step exits non-zero the run aborts immediately.
 *
 * Usage:
 *   node scripts/sync-full.mjs
 *   npm run sync:full
 */
import { spawn } from "node:child_process";
import { jsonLog } from "./_lib/http.mjs";

const STEPS = [
  {
    name: "sync:cars:catalog",
    cmd: "python3",
    args: ["scripts/sync_cars_catalog.py"],
    optional: false,
  },
  {
    name: "sync:oldcarsdata",
    cmd: "node",
    args: ["scripts/sync-oldcarsdata-prices.mjs"],
    optional: true,
    env_required: ["OLDCARSDATA_API_KEY"],
  },
  {
    name: "sync:bat:history",
    cmd: "node",
    args: ["scripts/sync-bat-history.mjs"],
    optional: true,
    env_required: ["BAT_SCRAPE_ENABLED"],
  },
  {
    name: "build:price:aggregates",
    cmd: "node",
    args: [
      "scripts/build-price-aggregates.mjs",
      "--output=src/lib/data/cars-ml/price-aggregates.json",
    ],
    optional: false,
  },
  {
    name: "build:community",
    cmd: "node",
    args: ["scripts/build-community-score.mjs"],
    optional: true,
  },
  {
    name: "sync:images",
    cmd: "node",
    args: ["scripts/mirror-car-images.mjs"],
    optional: true,
  },
  {
    name: "build:brand",
    cmd: "node",
    args: [
      "scripts/build-brand-features.mjs",
      "--output=src/lib/data/cars-ml/brand-features.json",
    ],
    optional: false,
  },
  {
    name: "sync:macro",
    cmd: "node",
    args: ["scripts/sync-macro-features.mjs"],
    optional: true,
  },
  {
    name: "train:cars-ml",
    cmd: "python3",
    args: ["scripts/train_cars_ml.py"],
    optional: true,
  },
  {
    name: "build:limitations",
    cmd: "node",
    args: ["scripts/build-limitations-report.mjs"],
    optional: false,
  },
];

async function runStep(step) {
  // Skip if any required env var is absent
  if (step.env_required && step.env_required.some((v) => !process.env[v])) {
    const missing = step.env_required.filter((v) => !process.env[v]);
    jsonLog({
      operation: "sync.full.skip",
      step: step.name,
      reason: "env_missing",
      missing,
    });
    return { name: step.name, status: "skipped" };
  }

  const start = Date.now();
  jsonLog({ operation: "sync.full.start", step: step.name });

  return new Promise((resolve) => {
    const proc = spawn(step.cmd, step.args, { stdio: "inherit" });
    proc.on("close", (code) => {
      const durationMs = Date.now() - start;
      const status =
        code === 0
          ? "ok"
          : step.optional
          ? "failed_optional"
          : "failed_required";
      jsonLog({
        operation: "sync.full.done",
        step: step.name,
        status,
        code,
        durationMs,
      });
      resolve({ name: step.name, status, code, durationMs });
    });
  });
}

async function main() {
  const results = [];
  for (const step of STEPS) {
    const r = await runStep(step);
    results.push(r);
    if (r.status === "failed_required") {
      jsonLog({ operation: "sync.full.abort", at: step.name });
      console.error(JSON.stringify({ aborted_at: step.name, results }, null, 2));
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ status: "complete", results }, null, 2));
}

main();
