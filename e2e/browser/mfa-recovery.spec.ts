import { expect, test, type Page } from '@playwright/test';
import { resolveFeatures } from '../../packages/shared/src/features';

const apiURL = 'http://127.0.0.1:32964';
const recoveryCodes = ['fixture-recovery-one', 'fixture-recovery-two'];
const statusError = 'Não foi possível consultar a proteção (teste).';

async function prepare(page: Page, failStatusAfterConfirmation: boolean) {
  const state = { signedIn: false, confirmed: false, statusReads: 0, enrollPosts: 0, confirmPosts: 0, unexpectedWrites: [] as string[] };
  const user = {
    id: 'usr_mfa_recovery', name: 'Morador de teste', email: 'mfa-recovery@example.test', role: 'RESIDENT',
    memberships: [{ buildingId: 'bld_001', role: 'RESIDENT' }],
  };
  const building = { id: 'bld_001', name: 'Condomínio de teste', address: {}, active: true };
  const features = Object.values(resolveFeatures([], [], 'building'));
  await page.route(`${apiURL}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/auth/web/logout' && method === 'POST') {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/auth/web/login' && method === 'POST') {
      state.signedIn = true;
      return route.fulfill({ json: { accessToken: 'synthetic-browser-token', user } });
    }
    if (path === '/auth/web/refresh' && method === 'POST') {
      return state.signedIn
        ? route.fulfill({ json: { accessToken: 'synthetic-browser-token', user } })
        : route.fulfill({ status: 401, json: { error: 'Entre para continuar.' } });
    }
    if (path === '/auth/mfa' && method === 'GET') {
      state.statusReads++;
      if (state.confirmed && failStatusAfterConfirmation) {
        return route.fulfill({ status: 500, json: { error: statusError } });
      }
      return route.fulfill({ json: {
        available: true, enabled: state.confirmed, pending: false,
        recoveryCodesRemaining: state.confirmed ? recoveryCodes.length : 0,
      } });
    }
    if (path === '/auth/mfa/enroll' && method === 'POST') {
      state.enrollPosts++;
      return route.fulfill({ json: { secret: 'SYNTHETICSECRET', otpauthUri: 'otpauth://totp/fixture' } });
    }
    if (path === '/auth/mfa/confirm' && method === 'POST') {
      state.confirmPosts++; state.confirmed = true;
      return route.fulfill({ json: { recoveryCodes } });
    }
    if (method !== 'GET') {
      state.unexpectedWrites.push(`${method} ${path}`);
      return route.fulfill({ status: 500, json: { error: 'Unexpected fixture mutation' } });
    }
    if (path === '/events/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    const json = path === '/auth/me' ? user
      : path === '/auth/sessions' ? { items: [] }
      : path === '/buildings' ? { items: [building] }
      : path === '/buildings/bld_001' ? building
      : path === '/v1/authorization' ? {
        buildingId: url.searchParams.get('buildingId'),
        ...(url.searchParams.has('resourceType') ? { resourceType: url.searchParams.get('resourceType'), resourceId: url.searchParams.get('resourceId') } : {}),
        capabilities: ['occurrences:create-own', 'occurrences:read-own', 'notices:read'],
      }
      : path.startsWith('/features/') ? { items: features }
      : { items: [], total: 0 };
    return route.fulfill({ json });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('link', { name: 'Perfil', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meu perfil', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ativar verificação', exact: true })).toBeVisible();
  return state;
}

async function enroll(page: Page) {
  await page.getByRole('button', { name: 'Ativar verificação', exact: true }).click();
  await page.getByLabel('Senha atual', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Chave de configuração', { exact: true })).toHaveValue('SYNTHETICSECRET');
  await page.getByLabel('Código do aplicativo', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Confirmar e ativar', exact: true }).click();
  // The mock stream ends immediately. This wait is only a convenience:
  // network idleness does not prove React state stability. The rendered-code
  // assertions and request counters below are the regression checks.
  await page.waitForLoadState('networkidle');
}

test('recovery codes stay visible until acknowledgment even when the next status read fails', async ({ page }, testInfo) => {
  const state = await prepare(page, true);
  const readsBeforeConfirmation = state.statusReads;
  await enroll(page);
  const list = page.getByRole('list', { name: 'Códigos de recuperação' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText(recoveryCodes);
  expect(state.statusReads).toBe(readsBeforeConfirmation);
  expect(state.confirmPosts).toBe(1);
  expect(state.enrollPosts).toBe(1);
  expect(state.unexpectedWrites).toEqual([]);

  const screenshot = testInfo.outputPath('mfa-recovery-before-ack.png');
  await list.scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Recovery codes remain visible before acknowledgment (synthetic fixture)', {
    path: screenshot, contentType: 'image/png',
  });
  // Capturing evidence must not hide codes, issue another GET or acknowledge them.
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText(recoveryCodes);
  expect(state.statusReads).toBe(readsBeforeConfirmation);
  expect(state.confirmPosts).toBe(1);

  await page.getByRole('button', { name: 'Já guardei os códigos', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: statusError })).toBeVisible();
  await expect(list).toHaveCount(0);
  expect(state.statusReads).toBe(readsBeforeConfirmation + 1);
  expect(state.confirmPosts).toBe(1);
  expect(state.enrollPosts).toBe(1);
  expect(state.unexpectedWrites).toEqual([]);
});

test('normal status reload after acknowledgment shows the enabled optional control without replay', async ({ page }) => {
  const state = await prepare(page, false);
  await enroll(page);
  const list = page.getByRole('list', { name: 'Códigos de recuperação' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText(recoveryCodes);
  await page.getByRole('button', { name: 'Já guardei os códigos', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desativar verificação', exact: true })).toBeVisible();
  expect(state.confirmPosts).toBe(1);
  expect(state.enrollPosts).toBe(1);
  expect(state.unexpectedWrites).toEqual([]);
});
