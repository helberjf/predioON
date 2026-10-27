import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "work-orders-design.spec.ts", workers: 1, timeout: 45_000,
  outputDir: "../.local/work-orders-design-results", reporter: "list",
  use: { baseURL: "http://127.0.0.1:5197", viewport: { width: 1440, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", screenshot: "only-on-failure" },
  webServer: { command: "pnpm --filter @predioon/building-web build && pnpm --filter @predioon/building-web exec vite preview --host 127.0.0.1 --port 5197 --strictPort",
    url: "http://127.0.0.1:5197", env: { VITE_API_URL: "http://127.0.0.1:3197" }, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
