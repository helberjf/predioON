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
  await page.getByRole('tab', { name: 'Próximas reservas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelar reserva', exact: true })).toHaveCount(0);
});

test('manager confirms cancellation once and it disappears while the agenda refreshes', async ({ page }, info) => {
  let release!: () => void;
  const fixture = await prepareAreas(page, { refreshDelay: new Promise<void>(resolve => { release = resolve; }) });
  await page.goto('/areas?aba=proximas');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Espaço gourmet', exact: true }) });
  await card.getByRole('button', { name: 'Cancelar reserva', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar reserva?' });
  await expect(dialog).toContainText('Espaço gourmet');
  await expect(dialog).toContainText('Unidade DEMO');
  await expect(dialog).toContainText('03/11/2026');
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('cancellation-dialog.png') });
  await dialog.getByRole('button', { name: 'Manter reserva', exact: true }).click();
  expect(fixture.writes).toEqual([]);
  await card.getByRole('button', { name: 'Cancelar reserva', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Reserva cancelada' })).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(fixture.writes).toEqual([{ id: bookings[2].id, status: 'CANCELLED' }]);
  release();
});

test('failed cancellation stays in the dialog and can be retried without losing the booking', async ({ page }) => {
  const fixture = await prepareAreas(page, { cancellationFailure: true });
  await page.goto('/areas?aba=proximas');
  await page.getByRole('tabpanel').getByRole('button', { name: 'Cancelar reserva', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar reserva?' });
  await dialog.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível cancelar agora');
  fixture.recoverCancellation();
  await dialog.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(fixture.writes).toHaveLength(2);
});

test('an approved booking can then be cancelled from the day calendar without duplicate requests', async ({ page }) => {
  let release!: () => void;
  const fixture = await prepareAreas(page, { cancellationDelay: new Promise<void>(resolve => { release = resolve; }) });
  await page.goto('/areas');
  await page.getByRole('button', { name: /1 de novembro de 2026:/ }).click();
  const selected = page.getByRole('region', { name: 'Reservas do dia' });
  await selected.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await selected.getByRole('button', { name: 'Cancelar reserva', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar reserva?' });
  await dialog.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancelando…', exact: true })).toBeDisabled();
  expect(fixture.writes).toEqual([{ id: bookings[0].id, status: 'CONFIRMED' }, { id: bookings[0].id, status: 'CANCELLED' }]);
  release();
  await expect(dialog).toBeHidden();
  await expect(selected.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(selected.getByRole('button', { name: 'Cancelar reserva', exact: true })).toHaveCount(0);
});

test('apartment quota defaults to one for a new space and persists two or unlimited', async ({ page }, info) => {
  const fixture = await prepareAreas(page);
  await page.goto('/areas?aba=regras');
  const newArea = page.getByRole('form', { name: 'Cadastrar área', exact: true });
  await expect(newArea.getByRole('combobox', { name: 'Limite por apartamento', exact: true })).toHaveValue('1');
  await newArea.getByRole('textbox', { name: 'Nome da área', exact: true }).fill('Brinquedoteca');
  await newArea.getByRole('button', { name: 'Cadastrar área', exact: true }).click();
  await expect.poll(() => fixture.areaWrites[0]?.monthlyLimitPerUnit).toBe(1);
  const salon = page.getByRole('form', { name: 'Salão de festas', exact: true });
  await salon.getByRole('combobox', { name: 'Limite por apartamento', exact: true }).selectOption('2');
  await salon.getByRole('button', { name: 'Salvar regras', exact: true }).click();
  await expect.poll(() => fixture.areaWrites.at(-1)?.monthlyLimitPerUnit).toBe(2);
  await page.reload();
  await expect(salon.getByRole('combobox', { name: 'Limite por apartamento', exact: true })).toHaveValue('2');
  await salon.getByRole('combobox', { name: 'Limite por apartamento', exact: true }).selectOption('');
  await salon.getByRole('button', { name: 'Salvar regras', exact: true }).click();
  await expect.poll(() => fixture.areaWrites.at(-1)?.monthlyLimitPerUnit).toBeNull();
  await page.reload();
  await expect(salon.getByRole('combobox', { name: 'Limite por apartamento', exact: true })).toHaveValue('');
  expect((await new AxeBuilder({ page }).include('#conteudo').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('rules-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('rules-mobile.png'), fullPage: true });
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
  await page.getByRole('tabpanel').getByRole('button', { name: 'Cancelar reserva', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancelar reserva?' }).getByRole('button', { name: 'Manter reserva', exact: true }).click();
  await page.getByRole('tab', { name: 'Regras das áreas', exact: true }).click();
  await page.getByRole('form', { name: 'Salão de festas', exact: true }).getByRole('combobox', { name: 'Limite por apartamento', exact: true }).selectOption('2');
  await page.getByRole('form', { name: 'Salão de festas', exact: true }).getByRole('button', { name: 'Salvar regras', exact: true }).click();
  await page.getByRole('tab', { name: 'Calendário do mês', exact: true }).click();
  await recorder._disableRecorder();
  const output = info.outputPath('codegen-areas.json');
  await writeFile(output, JSON.stringify(actions, null, 2));
  await info.attach('codegen-areas.json', { path: output, contentType: 'application/json' });
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.some(item => item.code?.includes('Próximas reservas'))).toBe(true);
  expect(actions.some(item => item.code?.includes('Cancelar reserva'))).toBe(true);
  expect(actions.some(item => item.code?.includes('Limite por apartamento'))).toBe(true);
});
