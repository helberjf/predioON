import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const lastSeenAt = new Date(Date.now() - 180_000).toISOString();
const inventory = [
  ['pump_01', 'Bomba de recalque', 'PUMP_MONITOR', 'OFFLINE', true],
  ['water_01', "Caixa d’água", 'WATER_LEVEL_SENSOR', 'ONLINE', true],
  ['gas_01', 'Detector de gás da central de gás', 'GAS_SENSOR', 'ONLINE', true],
  ['sales_demo_gate_car', 'Garagem · controlador fictício', 'GATE_CONTROLLER', 'DISABLED', false],
  ['water_meter_01', 'Hidrômetro geral', 'WATER_METER', 'ONLINE', true],
  ['energy_01', 'Medidor de energia das áreas comuns', 'ENERGY_METER', 'ONLINE', true],
  ['phase_01', 'Monitor de fases', 'PHASE_MONITOR', 'ONLINE', true],
  ['sales_demo_gate_walk', 'Pedestres · controlador fictício', 'GATE_CONTROLLER', 'ONLINE', false],
  ['smoke_01', 'Relé da central de incêndio', 'SMOKE_PANEL_RELAY', 'ONLINE', true],
  ['leak_01', 'Sensor de vazamento', 'Sensor de vazamento de água', 'ONLINE', true],
  ['temp_01', 'Temperatura da sala técnica', 'TEMPERATURE_SENSOR', 'PROVISIONING', true],
  ['sewage_01', 'Vazamento de esgoto no subsolo', 'SEWAGE_LEAK_SENSOR', 'ONLINE', true],
].map(([id, name, type, status, enabled]) => ({
  id, name, type, status, enabled, buildingId: 'bld_001',
  gatewayId: 'gw_001', lastSeenAt: enabled ? lastSeenAt : null,
}));

async function prepare(page: Page) {
  await page.route('http://127.0.0.1:3194/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: 'usr_001', name: 'Marina Silva', email: 'design@example.test', role: 'BUILDING_ADMIN', memberships: [{ buildingId: 'bld_001', role: 'BUILDING_ADMIN' }] };
    if (path === '/auth/web/refresh') return route.fulfill({ json: { accessToken: 'local-design-test', user } });
    if (path === '/buildings') return route.fulfill({ json: { items: [{ id: 'bld_001', name: 'Condomínio Vista Verde', active: true }] } });
    if (path === '/v1/authorization') return route.fulfill({ json: { capabilities: ['devices:read', 'telemetry:read', 'alerts:read', 'occurrences:manage', 'gates:manage', 'alert-rules:read', 'finance:read', 'parking:read', 'audit:read', 'notices:read', 'common-areas:read', 'work-orders:assign', 'units:manage', 'automations:read', 'support:read'] } });
    if (path === '/features/buildings/bld_001') return route.fulfill({ json: { items: ['WATER_TANK', 'WATER_CONSUMPTION', 'ENERGY_CONSUMPTION', 'PUMP', 'ELECTRICAL', 'GAS', 'GARAGE_ACCESS', 'CAR_PARKING', 'NOTICES', 'RESERVATIONS', 'TICKETS', 'FINANCE'].map(key => ({ key, enabled: true, version: 1, globalVersion: 1 })) } });
    const json = path === '/auth/me'
      ? { id: 'usr_001', name: 'Marina Silva', role: 'BUILDING_ADMIN', memberships: [{ buildingId: 'bld_001', role: 'BUILDING_ADMIN' }] }
      : path === '/buildings/bld_001'
        ? { name: 'Condomínio Vista Verde', address: { street: 'Rua das Palmeiras', number: 120, city: 'São Paulo', state: 'SP' } }
        : { items: path === '/devices' ? inventory : [] };
    if (path === '/events/stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
    await route.fulfill({ json });
  });
}

test.beforeEach(async ({ page }) => prepare(page));

test('search and type/status filters compose, and reset restores the inventory', async ({ page }) => {
  await page.goto('/dispositivos');
  await page.getByRole('searchbox', { name: 'Buscar equipamentos' }).fill('hidrometro');
  await expect(page.getByRole('row').filter({ hasText: 'Hidrômetro geral' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Caixa d’água' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Estado' }).selectOption('OFFLINE');
  await expect(page.getByText('Nenhum equipamento encontrado')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).first().click();
  await page.getByRole('combobox', { name: 'Tipo de equipamento' }).selectOption('GATE_CONTROLLER');
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('row').filter({ hasText: 'Pedestres' })).toContainText('Desativado');
  await page.getByRole('combobox', { name: 'Estado' }).selectOption('ONLINE');
  await expect(page.getByText('Nenhum equipamento encontrado')).toBeVisible();
});

test('summary counts use the full inventory and honor disabled devices', async ({ page }) => {
  await page.goto('/dispositivos');
  for (const [label, count] of [['Total de equipamentos', '12'], ['Online', '8'], ['Requerem atenção', '2'], ['Desativados', '2']]) {
    await expect(page.getByRole('region', { name: label, exact: true })).toContainText(count);
  }
  await page.getByRole('searchbox', { name: 'Buscar equipamentos' }).fill('water_01');
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Total de equipamentos' })).toContainText('12');
});

test('loading and retry distinguish unavailable data from an empty inventory', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/devices?**', async route => {
    requests++;
    if (requests === 1) {
      await pending;
      return route.fulfill({ status: 503, json: { error: 'Equipamentos temporariamente indisponíveis.' } });
    }
    await route.fulfill({ json: { items: inventory } });
  });
  await page.goto('/dispositivos');
  await expect(page.getByRole('status').filter({ hasText: 'Carregando equipamentos' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Total de equipamentos' })).toContainText('—');
  release();
  await expect(page.getByRole('alert')).toContainText('Equipamentos temporariamente indisponíveis.');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('row')).toHaveCount(13);
});

test('refresh retrieves the updated inventory', async ({ page }) => {
  await page.goto('/dispositivos');
  await expect(page.getByRole('row')).toHaveCount(13);
  await page.route('**/devices?**', route => route.fulfill({ json: { items: inventory.slice(0, 2) } }));
  await page.getByRole('button', { name: 'Atualizar equipamentos' }).click();
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Total de equipamentos' })).toContainText('2');
});

test('empty inventory has its own message', async ({ page }) => {
  await page.route('**/devices?**', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/dispositivos');
  await expect(page.getByText('Nenhum equipamento cadastrado')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Total de equipamentos' })).toContainText('0');
});

test('unknown states and missing readings or gateways remain explicit', async ({ page }) => {
  await page.route('**/devices?**', route => route.fulfill({ json: { items: [{ ...inventory[0], status: 'constructor', gatewayId: null, lastSeenAt: null }] } }));
  await page.goto('/dispositivos');
  const row = page.getByRole('row').filter({ hasText: 'Bomba de recalque' });
  await expect(row).toContainText('Sem informação');
  await expect(row).toContainText('Sem leituras');
  await expect(row).toContainText('Não vinculado');
  await expect(page.getByRole('region', { name: 'Requerem atenção' })).toContainText('1');
});

test('equipment errors stay visible and can be filtered separately', async ({ page }) => {
  await page.route('**/devices?**', route => route.fulfill({ json: { items: [
    { ...inventory[0], status: 'ERROR' }, inventory[1],
    { ...inventory[2], status: 'ERROR', enabled: false },
  ] } }));
  await page.goto('/dispositivos');
  await expect(page.getByRole('row').filter({ hasText: 'Bomba de recalque' })).toContainText('Erro');
  await page.getByRole('combobox', { name: 'Estado' }).selectOption('ERROR');
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Requerem atenção' })).toContainText('1');
  await expect(page.getByRole('region', { name: 'Desativados' })).toContainText('1');
});

test('desktop page meets accessibility checks and captures the design', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/dispositivos');
  await expect(page.getByRole('row')).toHaveCount(13);
  expect((await new AxeBuilder({ page }).include('#conteudo').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('equipamentos-desktop.png'), fullPage: true });
});

test('mobile inventory fits the viewport, keeps all details and can be filtered', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dispositivos');
  await expect(page.getByRole('heading', { name: 'Dispositivos', exact: true })).toBeVisible();
  await expect(page.getByText('Hidrômetro geral', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('equipamentos-mobile.png'), fullPage: true });
  await page.getByRole('searchbox', { name: 'Buscar equipamentos' }).fill('hidrometro');
  await expect(page.getByText('Hidrômetro geral', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Bomba de recalque', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('#conteudo').analyze()).violations).toEqual([]);
});
