import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PAMPERED_PORT ?? 5175);

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Containers rarely allow the sandbox's user namespaces. The site itself
    // never needs elevated privileges, so disabling the browser sandbox here
    // changes nothing about what is tested.
    launchOptions: {
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});