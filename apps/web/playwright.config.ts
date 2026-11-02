import { defineConfig, devices } from "@playwright/test";

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";

/** End-to-end tests: a real browser against the real API, the real Postgres
 * and (given credentials) the real S3 bucket. Nothing is mocked. The unit
 * tests in apps/api cover logic in isolation; these cover the wiring.
 *
 * Requires Postgres reachable at DATABASE_URL. The suite applies the
 * migration itself if the database is empty, then re-seeds before each spec.
 */
export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",

  // Every spec drives the same database and resets it, so they must not
  // overlap. Correctness over speed: the whole suite is seconds, not minutes.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"]],

  use: {
    baseURL: WEB_URL,
    trace: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },

  projects: [
    {
      // 390px, the frame the design was drawn at.
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      // Customers open these links on iPhones, and the one real bug the
      // spike found was Safari-specific (silent PNG instead of WebP). Worth
      // the extra minute in CI.
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
    },
  ],

  // Started only if nothing is already listening. Locally that means your
  // existing `npm run dev` sessions are reused.
  webServer: [
    {
      command: "npm run dev",
      cwd: "../api",
      url: `${API_URL}/health`,
      // Set per-process, not in the environment: `next start` reads PORT as
      // well, so a shared one makes both servers fight over the same port.
      env: { PORT: new URL(API_URL).port || "3001" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // In CI, serve the production bundle: it's what actually ships, and it
      // avoids dev-mode compile-on-first-hit blowing a test's timeout.
      command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
      url: `${WEB_URL}/login`,
      env: { PORT: new URL(WEB_URL).port || "3000" },
      reuseExistingServer: !process.env.CI,
      timeout: process.env.CI ? 240_000 : 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
