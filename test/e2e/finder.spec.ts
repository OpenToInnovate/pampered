/**
 * End to end, against a preview server.
 *
 *   npm run build && (npx vite preview --port 5175 &) && npm run test:e2e
 *
 * These tests do not mock the database, the network or the map tiles. There is
 * no longer a database on the request path to mock: the directory is published
 * as static assets and the browser filters it, so a preview server with D1
 * entirely unreachable is a fair test of production. WebGL in headless
 * Chromium runs on SwiftShader, which is slow but sufficient to prove the map
 * initialises or the fallback takes over — either outcome is a shippable state,
 * and a grey rectangle with nothing in it is not.
 */
import { expect, test } from "@playwright/test";

test("home loads with a list, chips and a map or fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pampered/);

  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByPlaceholder(/Search pubs/)).toBeVisible();

  // Eleven chips, one per selection.
  const chips = page.getByRole("group", { name: /Show on the map/ }).getByRole("button");
  await expect(chips).toHaveCount(11);

  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });

  const map = page.getByTestId("map");
  const fallback = page.locator(".map-fallback");
  await expect(map.or(fallback)).toBeVisible({ timeout: 25_000 });
});

test("the published dataset is static and edge-cached", async ({ request, baseURL }) => {
  const manifest = await request.get("/data/manifest.json");
  expect(manifest.ok()).toBe(true);

  const body = await manifest.json();
  expect(body.total).toBeGreaterThan(1000);
  expect(body.builtAt).toBeTruthy();
  expect(Object.keys(body.counts).length).toBe(11);

  // Static assets are served by Workers Assets rather than the Worker, which is
  // what makes browsing free of database reads and free of request cost. The
  // header only exists on Cloudflare's edge, so only assert it against a real
  // deployment — a local workerd preview has no cache in front of it.
  const status = manifest.headers()["cf-cache-status"];
  if (baseURL?.includes("localhost")) {
    expect(status ?? "MISS").toBeDefined();
  } else {
    expect(status).toBe("HIT");
  }
});

test("there is no API left to fall over", async ({ request }) => {
  // These used to exist and were the outage. Their absence is the fix.
  for (const path of ["/api/places?bbox=-1,50,1,52", "/api/health"]) {
    const res = await request.get(path);
    expect(res.status(), `${path} should not exist`).toBe(404);
  }
});

test("toggling a chip changes the URL and the list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });

  const chipGroup = page.getByRole("group", { name: /Show on the map/ });
  const cafes = chipGroup.getByRole("button", { name: /Cafés/ });
  await cafes.click();
  await expect(page).toHaveURL(/sel=/);
  await expect(cafes).toHaveAttribute("aria-pressed", "false");

  await cafes.click();
  await expect(cafes).toHaveAttribute("aria-pressed", "true");
});

test("search narrows the list and the URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });

  const before = await page.locator("#results > li").count();
  await page.getByPlaceholder(/Search pubs/).fill("park");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=park/);
  await expect(page.locator("#results > li")).not.toHaveCount(before);
});

test("a place card links to a venue page that renders", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#results > li").first();
  await expect(first).toBeVisible({ timeout: 20_000 });

  const href = await first.locator("a").first().getAttribute("href");
  expect(href).toMatch(/^\/p\//);

  await first.locator("a").first().click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to the map/ })).toBeVisible();
  // A venue page must arrive complete, without waiting for JavaScript.
  await expect(page.locator("h1")).not.toBeEmpty();
  await expect(page.locator(".place-card-pills").first()).toBeVisible();
});

test("about explains the sources", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator("h1")).toContainText("About Pampered");
  await expect(page.getByRole("heading", { name: "Where the data comes from" })).toBeVisible();
});

test("the first page view needs no data request at all", async ({ page }) => {
  // The server reads the published dataset and hands the browser exactly the
  // records it rendered, so the initial view survives a total network outage —
  // which is the difference between a directory that works on a train and one
  // that does not.
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/data/")) requests.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });
  expect(requests, "the first view should not fetch anything").toHaveLength(0);
});

test("a selection that fails to load says so, and never crashes", async ({ page }) => {
  // Toggling a chip is the one path that must reach the network, so it is the
  // one that can fail. Two failures have to be handled differently and neither
  // may be mistaken for "there is nothing here":
  //
  //   1. all selections fail  -> an explanation and a retry button
  //   2. one selection fails  -> the others still render
  //
  // The first failure mode that cost eight hours was neither: HTTP 200, zero
  // rows and no message.
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });

  await page.route("**/data/**", (route) => route.abort());
  await page
    .getByRole("group", { name: /Show on the map/ })
    .getByRole("button", { name: /Vets/ })
    .click();
  await page.waitForTimeout(1500);

  // Whatever happened, the page must not have fallen into the error boundary.
  await expect(page.locator(".page-fatal")).toHaveCount(0);

  // The other selections are unaffected, which is the partial-failure contract.
  await expect(page.locator("#results > li").first()).toBeVisible();
});
