import { defineConfig } from "@playwright/test";

// Browser checks with disposable API responses; no database or external service.
export default defineConfig({
  testDir: "./browser",
  testMatch: "notice-notifications.spec.ts",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: "../.local/notice-notifications-results",
  use: { browserName: "chromium", locale: "pt-BR", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: "pnpm --filter @predioon/resident-web exec vite preview --host 127.0.0.1 --port 5675 --strictPort", url: "http://127.0.0.1:5675", reuseExistingServer: false },
    { command: "pnpm --filter @predioon/building-web exec vite preview --host 127.0.0.1 --port 5674 --strictPort", url: "http://127.0.0.1:5674", reuseExistingServer: false },
  ],
});
