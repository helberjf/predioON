import { defineConfig } from "@playwright/test";
import { ADMIN_URL, API_URL, BUILDING_URL, E2E_PORT_OFFSET, RESIDENT_URL } from "./e2e/support/environment";
import { isDisposableDatabaseTarget } from "./e2e/support/database-target";

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
  // One folder per product area (e2e/specs/<área>). Raw Codegen output in e2e/recorded never runs
  // until it is reviewed and moved here; the recorder itself has its own config.
  testDir: "./e2e/specs",
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
    // Evidence only for failures: trace (DOM, network, console), final screenshot and video.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    testIdAttribute: "data-testid",
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
        // The API also reads the root .env: never let a real Resend key send invitation or
        // recovery e-mails from the suite. Blank means "not configured" in apps/api/src/config.ts.
        RESEND_API_KEY: "",
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
      // Empty on purpose: the suite reads the invitation as a code, whatever a local .env says.
      env: { VITE_API_URL: API_URL, VITE_RESIDENT_URL: "" },
      timeout: 90_000,
      reuseExistingServer: false,
    })),
  ],
});
