import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { areaIds, bookings, prepareAreas } from './areas-fixture';

test.beforeEach(async ({ page }) => page.clock.setFixedTime(new Date('2026-10-27T15:00:00.000Z')));

test('an unavailable area never exposes its UUID or permits an unidentified approval', async ({ page }) => {
  const fixture = await prepareAreas(page, { failure: true });
  await page.goto('/areas');
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os espaços');
  for (const id of areaIds) await expect(page.getByText(id, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aprovar', exact: true }).first()).toBeDisabled();
  fixture.recoverAreas();
  await page.getByRole('button', { name: 'Atualizar espaços', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Salão de festas', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar', exact: true }).first()).toBeEnabled();
});

test('slow area loading does not expose internal identifiers', async ({ page }) => {
  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  await prepareAreas(page, { areaDelay: delay });
  await page.goto('/areas');
  await expect(page.getByText('Identificando espaço…').first()).toBeVisible();
  for (const id of areaIds) await expect(page.getByText(id, { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Salão de festas', exact: true })).toBeVisible();
});

test('approvals are submitted once and the resulting counts and list refresh', async ({ page }) => {
  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  const fixture = await prepareAreas(page, { decisionDelay: delay });
  await page.goto('/areas');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Salão de festas', exact: true }) });
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Aprovando…', exact: true })).toBeDisabled();
  expect(fixture.writes).toEqual([{ id: bookings[0].id, status: 'CONFIRMED' }]);
  release();
  await expect(page.getByRole('status').filter({ hasText: 'Reserva aprovada' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aguardando aprovação', exact: true })).toContainText('1');
  await page.getByRole('tab', { name: 'Próximas reservas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Salão de festas', exact: true })).toBeVisible();
});

test('a refused decision keeps the booking for retry', async ({ page }) => {
  const fixture = await prepareAreas(page, { decisionFailure: true });
  await page.goto('/areas');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Salão de festas', exact: true }) });
  await card.getByRole('button', { name: 'Recusar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível aprovar agora');
  await expect(card.getByRole('button', { name: 'Recusar', exact: true })).toBeEnabled();
  fixture.recoverDecision();
  await card.getByRole('button', { name: 'Recusar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reserva recusada' })).toBeVisible();
});

test('a successful decision cannot be repeated while both lists are refreshing', async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const fixture = await prepareAreas(page, { refreshDelay: delayed });
  await page.goto('/areas');
  await page.getByRole('button', { name: /1 de novembro de 2026:/ }).click();
  const selected = page.getByRole('region', { name: 'Reservas do dia' });
  await expect(selected.getByRole('button', { name: 'Aprovar', exact: true })).toBeVisible();
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Salão de festas', exact: true }) });
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reserva aprovada' })).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(selected.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);
  expect(fixture.writes).toEqual([{ id: bookings[0].id, status: 'CONFIRMED' }]);
  release();
});

test('read-only access never offers reservation decisions', async ({ page }) => {
  await prepareAreas(page, { manager: false });
  await page.goto('/areas');
  await expect(page.getByRole('heading', { name: 'Áreas comuns', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recusar', exact: true })).toHaveCount(0);
});

test('desktop and mobile remain readable and accessible', async ({ page }, info) => {
  await prepareAreas(page);
  await page.goto('/areas');
  await expect(page.getByRole('heading', { name: 'Salão de festas', exact: true })).toBeVisible();
  await expect(page.getByText('unidade Unidade DEMO', { exact: false })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('#conteudo').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('areas-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('areas-mobile.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('#conteudo').analyze()).violations).toEqual([]);
});

test('Codegen records the common-area navigation flow', async ({ page, context }, info) => {
  await prepareAreas(page);
  const actions: Array<{ action: unknown; code: string }> = [];
  // Recorder used by Playwright Codegen; raw output stays with the test evidence.
  const recorder = context as unknown as {
    _enableRecorder(options: { language: string; mode: string; recorderMode: string; omitCallTracking: boolean }, callbacks: Record<string, (page: unknown, action: unknown, code: string) => void>): Promise<void>;
    _disableRecorder(): Promise<void>;
  };
  const record = (_page: unknown, action: unknown, code: string) => { actions.push({ action, code }); };
  await recorder._enableRecorder({ language: 'playwright-test', mode: 'recording', recorderMode: 'api', omitCallTracking: true }, { actionAdded: record, actionUpdated: record, signalAdded: record });
  await page.goto('/areas');
  await page.getByRole('tab', { name: 'Próximas reservas', exact: true }).click();
  await page.getByRole('tab', { name: 'Regras das áreas', exact: true }).click();
  await page.getByRole('tab', { name: 'Calendário do mês', exact: true }).click();
  await recorder._disableRecorder();
  const output = info.outputPath('codegen-areas.json');
  await writeFile(output, JSON.stringify(actions, null, 2));
  await info.attach('codegen-areas.json', { path: output, contentType: 'application/json' });
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.some(item => item.code?.includes('Próximas reservas'))).toBe(true);
});
