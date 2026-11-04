import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const panels = ['admin', 'building', 'resident'] as const;
const selectedPanel = process.env.E2E_FOCUS_PANEL;
if (selectedPanel !== undefined && !panels.some((panel) => panel === selectedPanel)) {
  throw new Error('E2E_FOCUS_PANEL must be admin, building or resident');
}
const selectedPanels = panels
  .map((panel, index) => ({ panel, index }))
  .filter(({ panel }) => selectedPanel === undefined || panel === selectedPanel);

export default defineConfig({
  testDir: './browser',
  testMatch: 'focus.spec.ts',
  outputDir: selectedPanel === undefined
    ? '../.local/focus-results'
    : `../.local/focus-results-${selectedPanel}`,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  projects: selectedPanels.map(({ panel, index }) => ({
    name: `${panel}-focus`,
    metadata: { panel },
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `http://127.0.0.1:${52961 + index}`,
      locale: 'pt-BR',
      screenshot: 'only-on-failure',
    },
  })),
  webServer: selectedPanels.map(({ panel, index }) => ({
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${52961 + index} --strictPort`,
    cwd: resolve(__dirname, `../apps/${panel}-web`),
    url: `http://127.0.0.1:${52961 + index}`,
    env: { VITE_API_URL: 'http://127.0.0.1:32961' },
    timeout: 60_000,
  })),
});
