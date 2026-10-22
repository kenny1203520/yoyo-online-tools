import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: true, retries: process.env.CI ? 1 : 0,
  workers: 2,
  expect: { timeout: 15000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }], ["json", { outputFile: "out/e2e-results.json" }]] : [["list"], ["json", { outputFile: "out/e2e-results.json" }]],
  use: { baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
    ...(process.env.E2E_SYSTEM_BROWSERS === "1" ? [
      { name: "google-chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
      { name: "microsoft-edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    ] : []),
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "node scripts/start-e2e.mjs", url: "http://127.0.0.1:3100/api/health", reuseExistingServer: false,
    env: { SITE_URL: "https://tools.example.test", SITE_INDEXABLE: "true" }, timeout: 120000,
  },
});
