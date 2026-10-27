import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './isolated', testMatch: 'areas.spec.ts', workers: 1, timeout: 60_000,
  expect: { timeout: 5_000 }, reporter: 'list', outputDir: '../.local/areas-results',
  use: { baseURL: 'http://127.0.0.1:5296', viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm --filter @predioon/building-web build && pnpm --filter @predioon/building-web exec vite preview --host 127.0.0.1 --port 5296 --strictPort',
    url: 'http://127.0.0.1:5296', env: { VITE_API_URL: 'http://127.0.0.1:3194' },
    timeout: 300_000, reuseExistingServer: !process.env.CI,
  },
});
