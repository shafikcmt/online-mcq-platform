import { defineConfig } from "@playwright/test";

/** End-to-end + visual QA against a running panel and backend (not part of `npm test`).
 *   E2E_BASE_URL=http://localhost:3001 E2E_ADMIN_MOBILE=… E2E_ADMIN_PASSWORD=… npm run e2e
 * Screenshots go to SCREENSHOT_DIR (default: test-results/screens).
 * Runs use real sign-ins, which count toward the admin login throttle: use an isolated test
 * stack (own database + Redis) and reset its Redis between suites (docs/DEPLOYMENT.md §8). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
