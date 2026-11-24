#!/usr/bin/env node
/**
 * Drain the paw inbox into yaml drafts.
 *
 *   npm run inbox
 *
 * Reads every stored report from the KV inbox through the wrangler CLI — this
 * script runs on a human's machine with wrangler's own credentials, never in
 * the Worker — and prints one yaml draft per report, shaped like
 * content/places/_example.yaml, ready to paste, fill in, check and commit.
 *
 * It deletes nothing. A report leaves the inbox when its facts are published
 * (build:index + sync) or when its 90-day TTL expires; deleting early is a
 * human decision made after the draft is in git, not an optimisation here.
 *
 * An empty inbox is said out loud, not printed as silence — an empty list that
 * means "it worked but there is nothing" is a different thing from an error,
 * and the two must never be conflated.
 */
import { execFileSync } from "node:child_process";

const wr = (args) =>
  execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unnamed-place";

const yamlString = (s) => JSON.stringify(s);

function draft(report) {
  const key = String(report.id ?? "unknown").replace(/[^a-z0-9:._-]/gi, "");
  const suffix = key.split(":").slice(-2).join("").replace(/[^a-z0-9]/gi, "").slice(-8);
  const name = report.placeName ?? "Un-named visitor report";
  const id = `visitor-${slug(name)}-${suffix || "nokey"}`;
  const lines = [
    `  - id: ${id}`,
    `    name: ${yamlString(name)}`,
    "    source: manual",
    "    selections: []          # fill in after checking",
  ];
  if (Number.isFinite(report.lat) && Number.isFinite(report.lon)) {
    lines.push(`    lat: ${report.lat}`, `    lon: ${report.lon}`);
  } else {
    lines.push("    # No map position in the report — add lat/lon from the note.");
  }
  lines.push(
    `    notes: >-`,
    `      Visitor report (${report.receivedAt ?? "no timestamp"}): ${report.note}`,
  );
  return lines.join("\n");
}

let keys;
try {
  keys = JSON.parse(wr(["kv", "key", "list", "--binding=INBOX"]));
} catch (error) {
  console.error(
    "Could not read the inbox. Does wrangler have credentials? (wrangler login, or\n" +
      "CLOUDFLARE_API_TOKEN in the environment.) The underlying error:\n" +
      String(error.message ?? error),
  );
  process.exit(1);
}

if (!Array.isArray(keys) || keys.length === 0) {
  console.log("The inbox is empty — nothing to drain. That is a real answer, not a silence.");
  process.exit(0);
}

const reports = [];
for (const entry of keys) {
  if (typeof entry?.name !== "string" || entry.name.startsWith("rl:")) continue; // rate-limit counters
  try {
    const raw = wr(["kv", "key", "get", entry.name, "--binding=INBOX"]);
    reports.push(JSON.parse(raw));
  } catch (error) {
    console.error(`Could not read ${entry.name}: ${String(error.message ?? error)}`);
  }
}

if (reports.length === 0) {
  console.log("The inbox held only rate-limit counters — no reports to drain.");
  process.exit(0);
}

console.log(`${reports.length} report(s). Drafts below — paste into content/places/, then check.\n`);
for (const report of reports) {
  console.log(draft(report));
  console.log("");
}
console.log(
  "Next: fill in selections, verify the facts (a report is not a check), flip source to\n" +
    "curated with verified: true, then npm run check && npm run build:index && npm run sync.",
);
