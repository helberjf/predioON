import { defineConfig, devices } from "@playwright/test";
import { ADMIN_URL, API_URL, BUILDING_URL, RESIDENT_URL } from "./e2e/environment";

const databaseRoles = ["APP", "IDENTITY", "BROKER_AUTH"] as const;
const databaseEnvironment = Object.fromEntries(databaseRoles.map(role => {
  const key = `DATABASE_URL_${role}`;
  const roleName = `predioon_${role.toLowerCase()}`;
  const value = process.env[key] ?? `postgres://${roleName}:${roleName}@localhost:5436/predioon`;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("E2E exige um banco isolado acessível por loopback. Não aponte estes testes de escrita para um banco remoto ou de produção.");
  }
  return [key, value];
}));

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Existing .local exclusion keeps recordings and browser credentials out of Git.
  outputDir: ".local/playwright-results",
  reporter: [["list"], ["html", { outputFolder: ".local/playwright-report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BUILDING_URL,
    viewport: { width: 1440, height: 1000 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "pnpm --filter @predioon/api exec tsx src/server.ts",
      url: `${API_URL}/health/ready`,
      env: {
        ...databaseEnvironment,
        NODE_ENV: "test",
        API_PORT: "3100",
        CORS_ORIGINS: [ADMIN_URL, BUILDING_URL, RESIDENT_URL].join(","),
      },
      timeout: 90_000,
      reuseExistingServer: false,
    },
    ...([
      ["admin-web", "5273", ADMIN_URL],
      ["building-web", "5274", BUILDING_URL],
      ["resident-web", "5275", RESIDENT_URL],
    ] as const).map(([workspace, port, url]) => ({
      command: `pnpm --filter @predioon/${workspace} exec vite --host 127.0.0.1 --port ${port} --strictPort`,
      url,
      env: { VITE_API_URL: API_URL },
      timeout: 90_000,
      reuseExistingServer: false,
    })),
  ],
});
