import { defineConfig } from "@playwright/test";
import { ADMIN_URL, API_URL, BUILDING_URL, E2E_PORT_OFFSET, RESIDENT_URL } from "./e2e/environment";
import { isDisposableDatabaseTarget } from "./e2e/database-target";

const runSuffix = E2E_PORT_OFFSET ? `-${E2E_PORT_OFFSET}` : "";

const databaseRoles = ["APP", "IDENTITY", "BROKER_AUTH"] as const;
const databaseEnvironment = Object.fromEntries(databaseRoles.map(role => {
  const key = `DATABASE_URL_${role}`;
  const roleName = `predioon_${role.toLowerCase()}`;
  const value = process.env[key] ?? `postgres://${roleName}:${roleName}@localhost:5436/predioon`;
  if (!isDisposableDatabaseTarget(new URL(value))) {
    throw new Error("E2E exige banco descartável em loopback ou o serviço postgres explícito do job GitHub. Não use banco remoto ou de produção.");
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
  outputDir: `.local/playwright-results${runSuffix}`,
  reporter: [["list"], ["html", { outputFolder: `.local/playwright-report${runSuffix}`, open: "never" }]],
  use: {
    baseURL: BUILDING_URL,
    viewport: { width: 1440, height: 1000 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @predioon/api exec tsx src/server.ts",
      url: `${API_URL}/health/ready`,
      env: {
        ...databaseEnvironment,
        NODE_ENV: "test",
        API_PORT: new URL(API_URL).port,
        CORS_ORIGINS: [ADMIN_URL, BUILDING_URL, RESIDENT_URL].join(","),
      },
      timeout: 90_000,
      reuseExistingServer: false,
    },
    ...([
      ["admin-web", ADMIN_URL],
      ["building-web", BUILDING_URL],
      ["resident-web", RESIDENT_URL],
    ] as const).map(([workspace, url]) => ({
      command: `pnpm --filter @predioon/${workspace} build && pnpm --filter @predioon/${workspace} exec vite preview --host 127.0.0.1 --port ${new URL(url).port} --strictPort`,
      url,
      env: { VITE_API_URL: API_URL },
      timeout: 90_000,
      reuseExistingServer: false,
    })),
  ],
});
