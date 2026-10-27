import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/isolated',
  testMatch: 'saved-rules.spec.ts',
  outputDir: '.local/rules-results',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:15197',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @predioon/building-web build && pnpm --filter @predioon/building-web exec vite preview --host 127.0.0.1 --port 15197 --strictPort',
    url: 'http://127.0.0.1:15197',
    env: { VITE_API_URL: 'http://127.0.0.1:3196' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
