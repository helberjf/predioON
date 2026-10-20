import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Codegen with the real login already done (pnpm e2e:record). Same API, portals and disposable
 * database as the suite; one headed Chromium, no time limit while you record. */
export default defineConfig({
  ...base,
  testDir: "./e2e/recorder",
  testMatch: "**/*.record.ts",
  timeout: 0,
  outputDir: ".local/record-results",
  reporter: [["list"]],
  use: { ...base.use, headless: false, trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
