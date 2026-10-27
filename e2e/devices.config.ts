import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './isolated',
  testMatch: 'devices.spec.ts',
  outputDir: '../.local/devices-results',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5294',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @predioon/building-web build && pnpm --filter @predioon/building-web exec vite preview --host 127.0.0.1 --port 5294 --strictPort',
    url: 'http://127.0.0.1:5294',
    env: { VITE_API_URL: 'http://127.0.0.1:3194' },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
