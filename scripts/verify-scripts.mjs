#!/usr/bin/env node
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full);
    else if (full.endsWith(".mjs") && !full.endsWith("verify-scripts.mjs")) {
      const r = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
      if (r.status !== 0) failures.push({ file: full, err: r.stderr });
    } else if (full.endsWith(".py")) {
      const r = spawnSync("python3", ["-m", "py_compile", full], { encoding: "utf8" });
      if (r.status !== 0 && r.error?.code !== "ENOENT") failures.push({ file: full, err: r.stderr });
    }
  }
}

if (existsSync(here)) walk(here);

if (failures.length) {
  for (const f of failures) console.error(`❌ ${f.file}\n${f.err}`);
  process.exit(1);
}
console.log("✅ all scripts syntax-clean");
