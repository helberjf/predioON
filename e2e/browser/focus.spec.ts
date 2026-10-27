import { expect, test, type Page } from '@playwright/test';
import { resolveFeatures } from '../../packages/shared/src/features';

type Panel = 'admin' | 'building' | 'resident';
const apiURL = 'http://127.0.0.1:32961';
const panels = {
  admin: { path: '/alertas', heading: 'Alertas da plataforma', resource: '/alerts', role: 'PLATFORM_ADMIN' },
  building: { path: '/regras', heading: 'Regras de alerta', resource: '/alert-rules', role: 'BUILDING_ADMIN' },
  resident: { path: '/chamados', heading: 'Chamados', resource: '/occurrences', role: 'RESIDENT' },
} as const;

async function prepare(page: Page, panel: Panel) {
  const config = panels[panel];
  const state = { items: Object.values(resolveFeatures([], [], panel === 'admin' ? 'global' : 'building')), resourceRequests: 0 };
  const user = {
    id: 'usr_focus', name: 'Teste de foco', email: 'focus@example.test', role: config.role,
    memberships: [{ buildingId: 'bld_001', role: panel === 'resident' ? 'RESIDENT' : 'BUILDING_ADMIN' }],
  };
  const capabilities = panel === 'resident'
    ? ['occurrences:create-own', 'occurrences:read-own', 'notices:read']
    : ['telemetry:read', 'devices:read', 'alerts:read', 'occurrences:manage', 'alert-rules:read', 'alert-rules:manage', 'gates:manage', 'finance:read', 'parking:read', 'audit:read'];
  await page.route(`${apiURL}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === config.resource) state.resourceRequests++;
    if (path === '/events/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    }
    const building = { id: 'bld_001', name: 'Condomínio de teste', address: {}, active: true };
    const json = path === '/auth/web/refresh' ? { accessToken: 'focus-regression-test', user }
      : path === '/auth/me' ? user
      : path === '/buildings' ? { items: [building] }
      : path === '/buildings/bld_001' ? building
      : path === '/v1/authorization' ? {
        buildingId: url.searchParams.get('buildingId'),
        ...(url.searchParams.has('resourceType') ? { resourceType: url.searchParams.get('resourceType'), resourceId: url.searchParams.get('resourceId') } : {}),
        capabilities,
      }
      : path === '/v1/authorization/platform' ? { capabilities: ['organizations:read', 'organizations:manage'] }
      : path.startsWith('/features/') ? { items: state.items }
      : { items: [], total: 0 };
    await route.fulfill({ json });
  });
  await page.goto(config.path, { waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('heading', { name: config.heading, exact: true }).last();
  await expect(heading).toBeVisible();
  await expect.poll(() => state.resourceRequests).toBeGreaterThan(0);
  if (panel === 'building') await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Regra em edição');
  if (panel === 'resident') {
    await page.getByRole('button', { name: 'Abrir novo chamado' }).click();
    await page.getByRole('textbox', { name: 'Resumo', exact: true }).fill('Chamado em edição');
  }
  return { state, heading, element: (await heading.elementHandle())! };
}

async function expectDraft(page: Page, panel: Panel) {
  if (panel === 'building') await expect(page.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Regra em edição');
  if (panel === 'resident') await expect(page.getByRole('textbox', { name: 'Resumo', exact: true })).toHaveValue('Chamado em edição');
}

for (const event of ['focus', 'predioon:features-changed']) {
  test(`${event} preserves the mounted page while unchanged features are revalidated`, async ({ page }, testInfo) => {
    const panel = testInfo.project.metadata.panel as Panel;
    const { state, heading, element } = await prepare(page, panel);
    const originalRequests = state.resourceRequests;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    await page.route(`${apiURL}/features/**`, async route => {
      requested();
      await pending;
      await route.fulfill({ json: { items: state.items } });
    });
    const response = page.waitForResponse(response => response.url().startsWith(`${apiURL}/features/`));
    try {
      await page.evaluate(name => window.dispatchEvent(new Event(name)), event);
      await started;
      expect(await element.evaluate(node => node.isConnected)).toBe(true);
      await expect(heading).toBeVisible();
      await expectDraft(page, panel);
    } finally {
      release();
    }
    await (await response).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await element.evaluate(node => node.isConnected)).toBe(true);
    await expectDraft(page, panel);
    // The other portals deliberately refresh their current lists on focus.
    if (panel === 'admin') expect(state.resourceRequests).toBe(originalRequests);
  });
}

test('confirmed feature revisions still replace cached content', async ({ page }, testInfo) => {
  const panel = testInfo.project.metadata.panel as Panel;
  const { state, element } = await prepare(page, panel);
  state.items = state.items.map(item => ({ ...item, version: item.version + 1 }));
  await page.evaluate(() => window.dispatchEvent(new Event('predioon:features-changed')));
  await expect.poll(() => element.evaluate(node => node.isConnected)).toBe(false);
  if (panel === 'building') await expect(page.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('');
  if (panel === 'resident') await expect(page.getByRole('button', { name: 'Abrir novo chamado' })).toBeVisible();
});

test('a failed focus check still closes feature content and permits retry', async ({ page }, testInfo) => {
  const panel = testInfo.project.metadata.panel as Panel;
  const { state, element, heading } = await prepare(page, panel);
  await page.route(`${apiURL}/features/**`, route => route.fulfill({ status: 503, json: { error: 'Verificação indisponível' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert').filter({ hasText: 'Funcionalidades indisponíveis' })).toContainText('Verificação indisponível');
  expect(await element.evaluate(node => node.isConnected)).toBe(false);
  await page.route(`${apiURL}/features/**`, route => route.fulfill({ json: { items: state.items } }));
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(heading).toBeVisible();
});

test('confirmed disabled features close the resident workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.metadata.panel !== 'resident');
  const { state } = await prepare(page, 'resident');
  state.items = state.items.map(item => item.key === 'TICKETS' ? { ...item, enabled: false, version: item.version + 1 } : item);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status')).toContainText('Esta funcionalidade está desativada');
  await expect(page.getByRole('textbox', { name: 'Resumo', exact: true })).toHaveCount(0);
});
