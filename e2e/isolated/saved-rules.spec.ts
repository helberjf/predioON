import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolveFeatures } from '../../packages/shared/src/features.js';

const initialRules = [
  { id: 'active', buildingId: 'bld_001', name: 'Temperatura alta na sala técnica', metric: 'temperature_c', operator: 'GT', threshold: 45, severity: 'MEDIUM', cooldownSeconds: 1800, deviceId: null, enabled: true },
  { id: 'saved', templateKey: 'low-water', buildingId: 'bld_001', name: 'Nível baixo da caixa', metric: 'water_level_percent', operator: 'LT', threshold: 20, severity: 'HIGH', cooldownSeconds: 900, deviceId: null, enabled: false },
];

async function prepare(page: Page) {
  const rules = structuredClone(initialRules);
  await page.route('http://127.0.0.1:3196/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const user = { id: 'admin', name: 'Síndico', email: 'sindico@example.com', role: 'BUILDING_ADMIN', memberships: [{ buildingId: 'bld_001', role: 'BUILDING_ADMIN' }] };
    if (path === '/auth/web/refresh') return route.fulfill({ json: { accessToken: 'rules-test', user } });
    if (path === '/events/stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
    if (request.method() === 'PATCH' && path.startsWith('/alert-rules/')) {
      const rule = rules.find(row => row.id === path.split('/').at(-1))!;
      Object.assign(rule, request.postDataJSON());
      return route.fulfill({ json: rule });
    }
    const json = path === '/auth/me'
      ? user
      : path === '/buildings' ? { items: [{ id: 'bld_001', name: 'Condomínio Vista Verde', active: true }] }
      : path === '/v1/authorization' ? { capabilities: ['buildings:read', 'alert-rules:read', 'alert-rules:manage', 'devices:read', 'gates:manage', 'finance:read', 'parking:read', 'audit:read'] }
      : path === '/overview/building' ? { buildingId: 'bld_001', coverage: {}, counts: {}, latestAlerts: [], gateways: [] }
      : path.startsWith('/features/') ? { items: Object.values(resolveFeatures([], [])) }
      : path === '/buildings/bld_001' ? { name: 'Condomínio Vista Verde', address: {} }
      : { items: path === '/alert-rules' ? rules : [] };
    await route.fulfill({ json });
  });
}

test.beforeEach(async ({ page }) => prepare(page));

test('separates active and saved rules and persists activation/deactivation', async ({ page }) => {
  await page.goto('/regras');
  const activeTab = page.getByRole('tab', { name: 'Regras ativas' });
  const savedTab = page.getByRole('tab', { name: 'Regras salvas' });
  await expect(activeTab).toContainText('1');
  await expect(savedTab).toContainText('1');
  await expect(page.getByRole('tabpanel')).toContainText('Temperatura alta');
  await expect(page.getByRole('tabpanel')).not.toContainText('Nível baixo');
  await savedTab.click();
  await expect(page.getByRole('tabpanel')).toContainText('Nível baixo');
  await expect(page.getByRole('tabpanel')).toContainText('Padrão');
  await expect(page.getByRole('tabpanel')).not.toContainText('Temperatura alta');
  const patch = page.waitForRequest(request => request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ enabled: true });
  await expect(activeTab).toContainText('2');
  await expect(page.getByRole('tabpanel')).toContainText('Nenhuma regra salva');
  await activeTab.click();
  await page.getByRole('listitem').filter({ hasText: 'Nível baixo' }).getByRole('button', { name: 'Desativar' }).click();
  await expect(savedTab).toContainText('1');
  await savedTab.click();
  await expect(page.getByRole('tabpanel')).toContainText('Desativada');
});

test('failed activation preserves the saved rule and explains the error', async ({ page }) => {
  await page.route('**/alert-rules/saved', route => route.fulfill({ status: 503, json: { error: 'Não foi possível ativar a regra.' } }));
  await page.goto('/regras');
  await page.getByRole('tab', { name: 'Regras salvas' }).click();
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível ativar');
  await expect(page.getByRole('tabpanel')).toContainText('Nível baixo');
  await expect(page.getByRole('button', { name: 'Ativar', exact: true })).toBeEnabled();
});

test('saved rules retain the existing read-only authorization boundary', async ({ page }) => {
  await page.route('**/v1/authorization?**', route => route.fulfill({ json: { capabilities: ['buildings:read', 'alert-rules:read'] } }));
  await page.goto('/regras');
  await page.getByRole('tab', { name: 'Regras salvas' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Nível baixo');
  await page.getByRole('button', { name: 'Ver ações desta regra' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Esta regra está disponível para consulta.');
  await expect(page.getByRole('button', { name: 'Ativar', exact: true })).toHaveCount(0);
});

test('pending activation prevents repeated changes until the request completes', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/alert-rules/saved', async route => {
    await pending;
    await route.fallback();
  });
  await page.goto('/regras');
  await page.getByRole('tab', { name: 'Regras salvas' }).click();
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Regras ativas' }).click();
  await page.getByRole('tab', { name: 'Regras salvas' }).click();
  await expect(page.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  release();
  await expect(page.getByRole('tab', { name: 'Regras ativas' })).toContainText('2');
  await expect(page.getByRole('tabpanel')).toContainText('Nenhuma regra salva');
});

test('loading errors are distinct from an empty list and can be retried', async ({ page }) => {
  let failed = true;
  await page.route('**/alert-rules?**', route => route.fulfill(failed
    ? { status: 503, json: { error: 'Regras indisponíveis.' } }
    : { json: { items: [] } }));
  await page.goto('/regras');
  await expect(page.getByRole('alert')).toContainText('Regras indisponíveis');
  await expect(page.getByText('Nenhuma regra ativa.')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Nenhuma regra ativa');
});

test('tabs support keyboard navigation and the saved page is accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/regras');
  await page.getByRole('tab', { name: 'Regras ativas' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Regras salvas' })).toHaveAttribute('aria-selected', 'true');
  expect((await new AxeBuilder({ page }).include('#conteudo').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('regras-salvas-desktop.png'), fullPage: true });
});

test('saved rules fit a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/regras');
  await page.getByRole('tab', { name: 'Regras salvas' }).click();
  await expect(page.getByRole('button', { name: 'Ativar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('regras-salvas-mobile.png'), fullPage: true });
});
