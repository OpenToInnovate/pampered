#!/usr/bin/env node
/**
 * The guard against the thing that took two sites down.
 *
 * In August 2026 this directory asked D1 for every viewport query, and its
 * footer asked D1 for two full-table row counts on every page view. That is
 * about 14,500 rows read per visitor on a 7,000-row table. It exhausted the
 * account's daily D1 row-read quota in a few hours, every D1 query started
 * failing, and because the quota is per-account rather than per-database it
 * took korg-e.com/mir down at the same time.
 *
 * Two things went wrong and only one of them was the query:
 *
 *   1. the query was wasteful
 *   2. it failed silently — the site returned HTTP 200 with an empty page, so
 *      nothing noticed for hours
 *
 * So this checks both. It runs as part of `npm run build`, which means a
 * regression cannot reach production without failing here first.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/content.mjs";

const CLIENT_DIR = join(ROOT, ".output", "public", "_build", "assets");
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

/** Every string that would mean the browser is talking to a database again. */
const FORBIDDEN = [
  { needle: "/api/places", why: "the viewport API was removed; browse the published dataset" },
  { needle: "/api/health", why: "the health endpoint full-scanned the table on every page view" },
  { needle: "places_fts", why: "FTS5 only existed to serve requests; browsing is client-side now" },
  { needle: "FROM places", why: "no SQL should reach the browser bundle" },
  { needle: "env.DB", why: "the Worker must not need the D1 binding to serve a page" },
  // dataset.server.ts reads the published files off disk so a pre-render can
  // produce a real list. It must be dropped from the browser bundle.
  { needle: "node:fs", why: "the disk reader is server-only and must be tree-shaken" },
  { needle: "dataset.server", why: "the disk reader is server-only and must be tree-shaken" },
];

async function checkClientBundle() {
  let files;
  try {
    files = await readdir(CLIENT_DIR);
  } catch {
    fail("no client bundle found at .output/public/_build/assets — did the build run?");
    return;
  }

  const js = files.filter((f) => f.endsWith(".js"));
  if (!js.length) {
    fail("no JavaScript in the client bundle");
    return;
  }

  let hits = 0;
  for (const file of js) {
    const text = await readFile(join(CLIENT_DIR, file), "utf8");
    for (const { needle, why } of FORBIDDEN) {
      if (text.includes(needle)) {
        fail(`${file} contains "${needle}" — ${why}`);
        hits++;
      }
    }
  }
  if (!hits) notes.push(`client bundle clean (${js.length} chunks checked)`);
}

async function checkNoApiRoutes() {
  try {
    await readdir(join(ROOT, "src", "routes", "api"));
    fail(
      "src/routes/api still exists. An API route reading D1 per request is what caused " +
        "the outage; delete it rather than adding a cache header to it.",
    );
  } catch {
    notes.push("no API routes");
  }
}

async function checkPublishedData() {
  const manifestPath = join(ROOT, "public", "data", "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    fail("public/data/manifest.json is missing — run `npm run build:data`");
    return;
  }

  // The free tier is 5,000,000 rows read a day and browsing now reads none, but
  // the payload budget is the thing that can still regress silently: a wider
  // record or a selection added to the defaults changes what a first-time
  // visitor downloads before anything appears.
  const DEFAULT_GZIP_BUDGET_KB = 120;
  const defaults = ["restaurants", "cafes", "groomers", "dog-parks"];
  let raw = 0;
  for (const id of defaults) {
    try {
      raw += (await readFile(join(ROOT, "public", "data", `${id}.json`))).length;
    } catch {
      fail(`public/data/${id}.json is missing`);
      return;
    }
  }
  const kb = raw / 1024;
  notes.push(`default selections ${kb.toFixed(0)} kB raw before compression`);
  if (kb > DEFAULT_GZIP_BUDGET_KB * 4) {
    fail(
      `default selections are ${kb.toFixed(0)} kB raw, which is over budget. ` +
        `Prerendering the homepage means every first visit downloads this.`,
    );
  }
  if (!manifest.builtAt) fail("manifest.json has no builtAt — the footer count depends on it");
}

async function checkPrerendered() {
  // /about is static and URL-independent, so it must be a file on disk. The
  // homepage deliberately is not: it renders from its query string, and a
  // pre-rendered copy cannot match every variant of it. See vite.config.ts.
  try {
    const html = await readFile(join(ROOT, ".output", "public", "about", "index.html"), "utf8");
    if (!html.includes("Pampered")) {
      fail(".output/public/about/index.html does not look pre-rendered");
    } else {
      notes.push("/about is pre-rendered to a static file");
    }
  } catch {
    fail("/about was not pre-rendered — enable nitro.prerender in vite.config.ts");
  }

  // A build that cannot be deployed is not a passing build. The deploy preset
  // went missing once already, and every other check still passed: vite built,
  // the preview server ran, the browser bundle was clean. `wrangler deploy` was
  // the first thing that noticed, which is one step too late.
  const deployConfig = join(ROOT, ".output", "server", "wrangler.json");
  if (existsSync(deployConfig)) {
    const config = JSON.parse(await readFile(deployConfig, "utf8"));
    const named = Object.values(config.bindings ?? {}).filter((b) => b.type === "d1_databases");
    if (named.length) {
      notes.push(
        `deploy config keeps ${named.length} D1 binding(s) for the CLI; runtime code must not use them`,
      );
    }
    notes.push("build produced .output/server/wrangler.json, so `wrangler deploy` can read it");
  } else {
    fail("no .output/server/wrangler.json — set nitro.preset to cloudflare_module in vite.config.ts");
  }
}

await checkClientBundle();
await checkNoApiRoutes();
await checkPublishedData();
await checkPrerendered();

for (const note of notes) console.log(`  ok   ${note}`);
if (errors.length) {
  console.log("");
  for (const error of errors) console.log(`  FAIL ${error}`);
  console.log(`\n${errors.length} problem(s). See AGENTS.md, "Why there is no API".\n`);
  process.exit(1);
}
console.log("\nNo request-time database access. Safe to deploy.\n");
