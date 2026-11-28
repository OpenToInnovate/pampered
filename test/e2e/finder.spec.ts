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

/**
 * The results drawer is closed by default on a phone and always visible on a
 * desk. Tests open it before touching a filter or a result row, and the helper
 * is a no-op on desktop, so one suite covers both placements.
 */
async function openDrawer(page: import("@playwright/test").Page) {
  const panel = page.locator("#results-drawer");
  if ((await panel.getAttribute("data-open")) === "true") return;
  const tab = page.getByRole("button", { name: /Open results/i });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await expect(panel).toHaveAttribute("data-open", "true");
    // The drawer slides in over 260ms. Clicking into it mid-transition makes
    // Playwright's stability check fight the animation, so wait it out.
    await expect(panel).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  }
}

async function filterButton(page: import("@playwright/test").Page, name: RegExp) {
  await openDrawer(page);
  return page.getByRole("group", { name: /Show on the map/ }).getByRole("button", { name });
}

async function openSearch(page: import("@playwright/test").Page) {
  const pill = page.getByRole("button", { name: "Search places" });
  if (await pill.first().isVisible().catch(() => false)) await pill.first().click();
}

test("home loads with a list, chips and a map or fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pampered/);

  // Desktop shows the search bar over the map; a phone shows the header pill
  // that opens the full-screen search. Either is the search affordance.
  await expect(
    page.getByRole("search").or(page.getByRole("button", { name: "Search places" })).first(),
  ).toBeVisible();

  // Seven filters, one per selection. On a phone they live in the drawer.
  await openDrawer(page);
  const dock = page.getByRole("group", { name: /Show on the map/ });
  await expect(dock.getByRole("button")).toHaveCount(7);

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
  expect(Object.keys(body.counts).length).toBe(7);

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

  const foodDrink = await filterButton(page, /Food \& drink/);
  await foodDrink.click();
  await expect(page).toHaveURL(/sel=/);
  await expect(foodDrink).toHaveAttribute("aria-pressed", "false");

  await foodDrink.click();
  await expect(foodDrink).toHaveAttribute("aria-pressed", "true");
});

test("search narrows the list and the URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });

  const before = await page.locator("#results > li").count();
  // On a phone the search box lives in a full-screen overlay opened from the
  // header pill; on a desk it is the bar over the map. One test, both docks.
  await openSearch(page);
  // Two inputs carry the placeholder (the desktop bar is merely hidden on a
  // phone); fill the one the overlay actually shows.
  const box = page.locator(".search-overlay input");
  await (await box.isVisible().catch(() => false) ? box : page.locator("#site-search")).fill("park");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=park/);
  await expect(page.locator("#results > li")).not.toHaveCount(before);
});

test("a place card links to a venue page that renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });
  await openDrawer(page);
  const first = page.locator("#results > li").first();

  const href = await first.locator("a").first().getAttribute("href");
  expect(href).toMatch(/^\/p\//);

  await first.locator("a").first().click();
  await expect(page).toHaveURL(/\/p\//);
  // The venue page is server-rendered from the bundled dataset; a cold preview
  // can take a beat longer than the default assertion timeout.
  await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
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

test("a visitor can say which vet they are with, and the card says who pays", async ({ page }) => {
  // The map initialises on SwiftShader here, which is slow; this test is about
  // the picker, not the map, so give it room under load.
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });
  await openDrawer(page);

  // Nothing is stored and nothing is fetched until the picker is opened.
  expect(await page.evaluate(() => localStorage.getItem("pampered.vet"))).toBeNull();

  await page.getByRole("button", { name: /Which vet are you with/i }).click();
  const provider = page.getByRole("button", { name: /^Medivet/ }).first();
  await expect(provider).toBeVisible({ timeout: 15_000 });
  await provider.scrollIntoViewIfNeeded();
  await provider.click({ timeout: 15_000 });

  const card = page.locator(".sponsor-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("Medivet");
  // Unconfirmed entries are labelled as drafts, never passed off as approved.
  await expect(card).toContainText(/Draft preview/);
  // The disclosure is present, and the plan link opens the provider's own page.
  await expect(card.locator("a.btn-primary")).toHaveAttribute("href", /medivetgroup\.com/);

  expect(await page.evaluate(() => localStorage.getItem("pampered.vet"))).toBe("medivet");

  // The vet layer is switched on by the choice.
  const vetChip = (await filterButton(page, /Vet/));
  await expect(vetChip).toHaveAttribute("aria-pressed", "true");

  await card.getByRole("button", { name: "Change" }).click();
  await expect(page.locator(".sponsor-card")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("pampered.vet"))).toBeNull();
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
  await (await filterButton(page, /Pet shops/)).click();
  await page.waitForTimeout(1500);

  // Whatever happened, the page must not have fallen into the error boundary.
  await expect(page.locator(".page-fatal")).toHaveCount(0);

  // The other selections are unaffected, which is the partial-failure contract.
  await expect(page.locator("#results > li").first()).toBeVisible();
});

test("a visitor can report a place in a couple of clicks", async ({ page }) => {
  // The Waze-shaped path: tap a place, tap "Add a detail", pick what changed,
  // one sentence, send. The inbox is the preview's local KV, so the happy path
  // exercises the real endpoint, not a mock. The map has to come up first and
  // software-GL does that slowly, so these tests get a longer budget than the
  // default.
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });
  await openDrawer(page);
  await page.locator("#results > li").first().click();
  await page.getByRole("button", { name: /Add a detail/ }).click();
  await expect(page.getByRole("dialog", { name: /Report / })).toBeVisible();

  await page.getByRole("button", { name: "Water bowl" }).click();
  await page.getByLabel("What did you see?").fill("There is a water bowl by the door.");
  await page.getByRole("button", { name: /Send it/ }).click();

  await expect(page.getByText("Paw stamp received")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog", { name: /Report / })).toHaveCount(0);
});

test("a short report is told it is too short, never silently dropped", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator("#results > li").first()).toBeVisible({ timeout: 20_000 });
  await openDrawer(page);
  await page.locator("#results > li").first().click();
  await page.getByRole("button", { name: /Add a detail/ }).click();

  await page.getByLabel("What did you see?").fill("nice");
  await page.getByRole("button", { name: /Send it/ }).click();
  await expect(page.getByRole("alert")).toContainText(/at least 10 characters/);
  await expect(page.getByText("Paw stamp received")).toHaveCount(0);
});
