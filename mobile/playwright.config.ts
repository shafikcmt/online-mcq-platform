import { defineConfig } from "@playwright/test";

/** End-to-end + visual QA of the app's WEB build against the real backend on the
 * disposable stack (`admin/e2e/stack/run.sh` with E2E_PROJECT_DIR=mobile). The web build
 * is only a QA vehicle: the product is the Android app (same code, same screens).
 *   E2E_BASE_URL = where the exported web build and /api/ are served (same origin).
 * Screenshots go to SCREENSHOT_DIR (default: e2e/test-results/screens). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./e2e/test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8089",
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
