/**
 * Screenshots, not tests. Run against a preview server and look at the PNGs.
 *
 *   npm run build && (npx vite preview --port 5175 &) && node scripts/shoot.mjs
 *
 * Writes to shots/, which is gitignored: screenshots are 200kb each and every
 * one is reproducible, so they do not belong in history. See ../korg-e for the
 * same reasoning.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.PAMPERED_URL ?? "http://localhost:5175";
const OUT = new URL("../shots/", import.meta.url).pathname;

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // networkidle never fires while map tiles stream, so load the DOM and wait
  // for the list instead. The map gets its own pause after.
  await mobile.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await mobile.waitForSelector("#results > li", { timeout: 20_000 }).catch(() => {});
  await mobile.waitForTimeout(4000);
  await mobile.screenshot({ path: join(OUT, "home-mobile.png") });
  console.log("home-mobile.png");

  // Sheet expanded, to review the list density.
  await mobile.locator(".sheet-handle").click().catch(() => {});
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: join(OUT, "home-mobile-sheet.png") });
  console.log("home-mobile-sheet.png");

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await desktop.waitForSelector("#results > li", { timeout: 20_000 }).catch(() => {});
  await desktop.waitForTimeout(4000);
  await desktop.screenshot({ path: join(OUT, "home-desktop.png") });
  console.log("home-desktop.png");

  await desktop.goto(`${BASE}/about`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await desktop.screenshot({ path: join(OUT, "about.png") });
  console.log("about.png");

  await browser.close();
  console.log(`\nWrote to ${OUT}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});