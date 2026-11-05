import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// Single real resident portal; all API traffic is intercepted by the test.
export default defineConfig({
  testDir: './browser',
  testMatch: 'mfa-recovery.spec.ts',
  outputDir: '../.local/mfa-recovery-results',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  projects: [{
    name: 'resident-mfa-recovery',
    use: {
      ...devices['Desktop Chrome'],
      baseURL: 'http://127.0.0.1:52964',
      locale: 'pt-BR',
      screenshot: 'only-on-failure',
      serviceWorkers: 'block',
    },
  }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 52964 --strictPort',
    cwd: resolve(__dirname, '../apps/resident-web'),
    url: 'http://127.0.0.1:52964',
    env: { VITE_API_URL: 'http://127.0.0.1:32964' },
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
