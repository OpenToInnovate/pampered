#!/usr/bin/env node
/**
 * Push `data/index.json` into D1.
 *
 *   npm run refresh        pull OSM
 *   npm run build:index    merge into data/index.json
 *   npm run sync           this: upsert into the remote D1
 *   npm run sync -- --local   this: upsert into the local D1 instead
 *
 * Upserts are idempotent: running it twice changes nothing the second time.
 * Rows whose OSM source has vanished — the venue was deleted, or un-tagged —
 * are removed rather than left to rot, but curated and manual rows are never
 * deleted by this script. Taking a venue off the map is an edit in
 * `content/places/`, not a side effect of a refresh.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, isoNow } from "./lib/content.mjs";

const LOCAL = process.argv.includes("--local");
const log = (...args) => console.log(...args);

/** D1 rejects a statement over ~100 kB, so rows go in batches of fifty. */
const BATCH = 50;

const COLUMNS = [
  "id",
  "source",
  "verified",
  "name",
  "selections",
  "primary_sel",
  "lat",
  "lon",
  "street",
  "city",
  "region",
  "postcode",
  "phone",
  "website",
  "instagram",
  "image",
  "opening_hours",
  "dog_policy",
  "outdoor_seating",
  "wheelchair",
  "cuisine",
  "booking_url",
  "booking_label",
  "notes",
  "provenance",
  "osm_updated",
  "created_at",
  "updated_at",
];

function wrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "execute", "pampered", ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.slice(-2000)))));
  });
}

/** A JSON blob that is one complete batch: wrangler's --json takes commands, so
    one batch is one --command with many statements joined by semicolons. */
function batchSql(rows) {
  return rows
    .map((p) => {
      const values = COLUMNS.map((c) => sqlValue(columnOf(p, c))).join(", ");
      return (
        `INSERT INTO places (${COLUMNS.join(", ")}) VALUES (${values}) ` +
        `ON CONFLICT (id) DO UPDATE SET ` +
        COLUMNS.filter((c) => c !== "id" && c !== "created_at")
          .map((c) => `${c} = excluded.${c}`)
          .join(", ") +
        `, created_at = CASE WHEN places.created_at = '' THEN excluded.created_at ELSE places.created_at END;`
      );
    })
    .join("\n");
}

function columnOf(place, column) {
  switch (column) {
    case "selections":
      return JSON.stringify(place.selections ?? []);
    case "primary_sel":
      return place.primary ?? null;
    case "verified":
      return place.verified ? 1 : 0;
    case "created_at":
      return place.created_at || place.updated_at;
    case "updated_at":
      return place.updated_at;
    default:
      return place[column] ?? null;
  }
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const index = JSON.parse(await readFile(join(ROOT, "data", "index.json"), "utf8"));
  const places = index.places ?? [];
  const mode = LOCAL ? "--local" : "--remote";
  log(`\nSyncing ${places.length.toLocaleString("en-GB")} places to D1 (${LOCAL ? "local" : "remote"})\n`);

  let written = 0;
  for (let i = 0; i < places.length; i += BATCH) {
    const batch = places.slice(i, i + BATCH);
    await wrangler([mode, "--command", batchSql(batch)]);
    written += batch.length;
    if (written % 500 === 0 || written === places.length) {
      log(`  ${written.toLocaleString("en-GB")} / ${places.length.toLocaleString("en-GB")}`);
    }
  }

  // Remove OSM rows that the new index no longer contains. A venue gets deleted
  // from OSM or loses its dog tag; either way it should leave the map rather
  // than stand there forever claiming to welcome dogs.
  const wantedOsm = new Set(places.filter((p) => p.source === "osm").map((p) => p.id));
  const existingRaw = await wrangler([mode, "--json", "--command", "SELECT id FROM places WHERE source = 'osm'"]);
  const existing = JSON.parse(existingRaw)[0]?.results?.map((r) => r.id) ?? [];
  const stale = existing.filter((id) => !wantedOsm.has(id));

  let deleted = 0;
  for (let i = 0; i < stale.length; i += BATCH) {
    const chunk = stale.slice(i, i + BATCH);
    const sql = chunk.map((id) => `DELETE FROM places WHERE id = '${id.replace(/'/g, "''")}';`).join("\n");
    await wrangler([mode, "--command", sql]);
    deleted += chunk.length;
  }

  await wrangler([
    mode,
    "--command",
    `INSERT INTO sync_log (ran_at, command, rows_written, rows_deleted, source, detail) VALUES ` +
      `('${isoNow()}', 'sync', ${written}, ${deleted}, 'index.json @ ${index.builtAt}', ` +
      `'${sqlValue(JSON.stringify(index.stats ?? {})).slice(1, -1)}');`,
  ]);
  await wrangler([mode, "--command", "PRAGMA optimize;"]);

  log(`\nDone. ${written.toLocaleString("en-GB")} written, ${deleted.toLocaleString("en-GB")} stale removed.\n`);
}

main().catch((error) => {
  console.error(`\nsync failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});