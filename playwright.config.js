import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.E2E_APP_PORT) || 4181;
const deliveryPort = Number(process.env.E2E_DELIVERY_PORT) || 4180;
const appURL = `http://127.0.0.1:${appPort}`;
const deliveryURL = `http://127.0.0.1:${deliveryPort}`;

/**
 * Two targets, because they cannot be the same one.
 *
 * `app` runs the application flows against the dev server, which is the only
 * build that enters local-only mode: AppEntry forces commercial mode whenever
 * import.meta.env.PROD is set, so a production bundle without Supabase stops at
 * the configuration screen by design. Exercising the flows therefore needs
 * either the dev build or a real Supabase project.
 *
 * `delivery` runs against the real production server and the real bundle, and
 * asserts only what that layer owns: health, security headers, compression and
 * caching. No application interaction, so no Supabase is required.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [
    {
      name: "delivery",
      testMatch: /delivery\.spec\.js/,
      use: { ...devices["Desktop Chrome"], baseURL: deliveryURL },
    },
    {
      name: "app",
      testIgnore: /(delivery|mobile|webkit-smoke)\.spec\.js/,
      use: { ...devices["Desktop Chrome"], baseURL: appURL },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.js/,
      use: { ...devices["Pixel 7"], baseURL: appURL },
    },
    {
      name: "webkit-iphone-smoke",
      testMatch: /webkit-smoke\.spec\.js/,
      use: { ...devices["iPhone 15"], baseURL: appURL },
    },
    {
      name: "webkit-ipad-smoke",
      testMatch: /webkit-smoke\.spec\.js/,
      use: { ...devices["iPad Pro 11"], baseURL: appURL },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${appPort} --host 127.0.0.1`,
      url: `${appURL}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "node server.mjs",
      env: { PORT: String(deliveryPort) },
      url: `${deliveryURL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
