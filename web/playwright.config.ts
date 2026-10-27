import { defineConfig } from "@playwright/test";

/** End-to-end + visual QA of the public website against the real backend on the
 * disposable stack (`admin/e2e/stack/run.sh` with E2E_PROJECT_DIR=web). Playwright builds
 * and starts the site itself, reading the disposable backend (E2E_DJANGO_PORT), so every
 * suite sees the fresh seed. Screenshots go to SCREENSHOT_DIR. */
const PORT = 3002;
const API_ORIGIN = `http://127.0.0.1:${process.env.E2E_DJANGO_PORT ?? "8000"}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./e2e/test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    // A fresh data cache for every run, like the disposable database: cached API answers from
    // an earlier run must never leak into this one.
    command: `rm -rf .next/cache/fetch-cache && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/bn`,
    // DEV_PUBLIC_API_PROXY: the Contact form's /api/v1/public/* goes to the disposable
    // backend through Next.js here (nginx does it in production; see next.config.ts).
    env: { API_ORIGIN, SITE_URL: "https://livemodeltest.com", DEV_PUBLIC_API_PROXY: "1" },
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "ignore",
  },
});
