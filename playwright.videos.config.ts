import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Demonstration recordings only: same API, portals and disposable database as the e2e suite. */
export default defineConfig({
  ...base,
  testDir: "./scripts/videos",
  testMatch: "**/*.video.ts",
  timeout: 900_000,
  outputDir: ".local/video-results",
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
