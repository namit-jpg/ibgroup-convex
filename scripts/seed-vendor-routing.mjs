#!/usr/bin/env node
/**
 * Idempotent seed: reads data/vendor-routing.json and upserts into Convex.
 * Usage:
 *   node scripts/seed-vendor-routing.mjs
 *   node scripts/seed-vendor-routing.mjs --prod
 *   node scripts/seed-vendor-routing.mjs path/to/other.json
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const prod = args.includes("--prod");
const fileArg = args.find((arg) => !arg.startsWith("--"));
const dataPath = resolve(root, fileArg || "data/vendor-routing.json");

const data = JSON.parse(readFileSync(dataPath, "utf8"));
if (!Array.isArray(data.employees) || !Array.isArray(data.vendors) || !Array.isArray(data.mappings)) {
  console.error("Expected JSON with employees[], vendors[], mappings[]");
  process.exit(1);
}

const convexArgs = ["convex", "run", "seed:upsertAll", JSON.stringify(data)];
if (prod) convexArgs.push("--prod");

console.log(`Seeding from ${dataPath}${prod ? " (prod)" : ""}…`);
const result = spawnSync("npx", convexArgs, { cwd: root, stdio: "inherit", encoding: "utf8" });
process.exit(result.status ?? 1);
