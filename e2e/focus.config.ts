import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const panels = ['admin', 'building', 'resident'] as const;

export default defineConfig({
  testDir: './browser',
  testMatch: 'focus.spec.ts',
  outputDir: '../.local/focus-results',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  projects: panels.map((panel, index) => ({
    name: `${panel}-focus`,
    metadata: { panel },
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `http://127.0.0.1:${52961 + index}`,
      locale: 'pt-BR',
      screenshot: 'only-on-failure',
    },
  })),
  webServer: panels.map((panel, index) => ({
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${52961 + index} --strictPort`,
    cwd: resolve(__dirname, `../apps/${panel}-web`),
    url: `http://127.0.0.1:${52961 + index}`,
    env: { VITE_API_URL: 'http://127.0.0.1:32961' },
    timeout: 60_000,
  })),
});
