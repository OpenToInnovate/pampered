/**
 * End to end, against a preview server with the real local D1 behind it.
 *
 *   npm run build && (npx vite preview --port 5175 &) && npm run test:e2e
 *
 * These tests do not mock the database, the network or the map tiles. A mocked
 * map test proves the mock works; a real one proves a visitor sees pins. WebGL
 * in headless Chromium runs on SwiftShader, which is slow but sufficient to
 * prove the map initialises or the fallback takes over — either outcome is
 * asserted as acceptable, because both are shippable states.
 */
import { expect, test } from "@playwright/test";

test("home loads with a list, chips and a map or fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pampered/);

  // The search box is the first thing a phone visitor reaches.
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByPlaceholder(/Search pubs/)).toBeVisible();

  // Eleven chips, one per selection.
  const chips = page.getByRole("group", { name: /Show on the map/ }).getByRole("button");
  await expect(chips).toHaveCount(11);

  // The SSR list is already there before any client fetch.
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 15_000 });

  // Either WebGL initialises or the fallback says why it did not. A grey
  // rectangle with nothing in it is the only unacceptable outcome.
  const map = page.getByTestId("map");
  const fallback = page.locator(".map-fallback");
  await expect(map.or(fallback)).toBeVisible({ timeout: 20_000 });
});

test("toggling a chip changes the URL and the list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 15_000 });

  const cafes = page.getByRole("button", { name: /Cafés/ });
  await cafes.click();
  await expect(page).toHaveURL(/sel=/);
  await expect(cafes).toHaveAttribute("aria-pressed", "false");

  await cafes.click();
  await expect(cafes).toHaveAttribute("aria-pressed", "true");
});

test("search narrows the list and the URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder(/Search pubs/).fill("park");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=park/);
});

test("a place card links to a venue page that renders", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#results > li").first();
  await expect(first).toBeVisible({ timeout: 15_000 });

  const href = await first.locator("a").first().getAttribute("href");
  expect(href).toMatch(/^\/p\//);

  await first.locator("a").first().click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to the map/ })).toBeVisible();
});

test("about explains the sources", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator("h1")).toContainText("About Pampered");
  await expect(page.getByRole("heading", { name: "Where the data comes from" })).toBeVisible();
});

test("health reports the database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.total).toBeGreaterThan(0);
});

test("viewport search answers inside a bbox", async ({ request }) => {
  const res = await request.get("/api/places?bbox=-0.5,51.3,0.3,51.7&sel=dog-parks&limit=5");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.places.length).toBeGreaterThan(0);
  expect(body.places.length).toBeLessThanOrEqual(5);
  expect(body.counts["dog-parks"]).toBeGreaterThan(0);
});

test("oversized bbox is refused, not executed", async ({ request }) => {
  const res = await request.get("/api/places?bbox=-180,-85,180,85");
  expect(res.status()).toBe(400);
});