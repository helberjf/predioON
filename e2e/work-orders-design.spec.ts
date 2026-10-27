import { expect, test, type Page } from "@playwright/test";
import type { WorkOrderView } from "@predioon/contracts/work-orders";

const API = "http://127.0.0.1:3197";
const title = "Higienização do reservatório";
const teamId = "22222222-2222-4222-8222-222222222222";

async function prepare(page: Page, canDistribute = true) {
  const user = { id: "manager", name: "Marina Silva", email: "marina@example.test", role: "BUILDING_ADMIN", memberships: [{ buildingId: "bld_001", role: "BUILDING_ADMIN" }] };
  let order: WorkOrderView = { id: "11111111-1111-4111-8111-111111111111", buildingId: "bld_001", title,
    description: "Planejar a limpeza e a comunicação aos moradores.", status: "OPEN", priority: "NORMAL", version: 1,
    assignedName: null, assignedTeamId: teamId, assignedUserId: null, assignedToMe: true,
    assetId: "33333333-3333-4333-8333-333333333333", assetName: "Reservatório superior", occurrenceId: null,
    dueAt: "2026-11-05T12:00:00.000Z", createdBy: "manager", createdAt: "2026-10-27T12:00:00.000Z", updatedAt: "2026-10-27T12:00:00.000Z", startedAt: null, closedAt: null };
  const writes: Record<string, unknown>[] = [];
  await page.route(`${API}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/auth/web/refresh") return route.fulfill({ json: { accessToken: "design-test-token", user } });
    if (path === "/auth/me") return route.fulfill({ json: user });
    if (path === "/events/stream") return route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
    if (path === "/buildings") return route.fulfill({ json: { items: [{ id: "bld_001", name: "Condomínio Vista Verde", active: true }] } });
    if (path === "/buildings/bld_001") return route.fulfill({ json: { id: "bld_001", name: "Condomínio Vista Verde", address: {} } });
    if (path === "/v1/authorization") return route.fulfill({ json: { capabilities: canDistribute ? ["work-orders:assign", "work-orders:read-assigned"] : ["work-orders:read-assigned"] } });
    if (path === "/v1/tenancy/teams") return route.fulfill({ json: { items: [{ id: teamId, name: "Manutenção predial" }], nextCursor: null } });
    if (path === "/v1/tenancy/people") return route.fulfill({ json: { items: [{ id: "ana", name: "Ana Martins", email: "ana@example.test" }, { id: "joao", name: "João Ferreira", email: "joao@example.test" }], nextCursor: null } });
    if (path.startsWith("/v1/work-orders")) {
      if (request.method() === "PATCH" || request.method() === "POST") {
        const body = request.postDataJSON(); writes.push(body);
        order = { ...order, ...body, version: order.version + 1 };
        return route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: order });
      }
      return route.fulfill({ json: path === "/v1/work-orders" ? { items: [order], canDistribute, nextCursor: null } : { ...order, events: [] } });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/ordens-servico", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  return writes;
}

const item = (page: Page) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("typed provider is saved explicitly, survives reload and can be removed", async ({ page }) => {
  const writes = await prepare(page);
  const card = item(page);
  await card.getByRole("button", { name: "Alterar responsável" }).click();
  await card.getByRole("radio", { name: "Digitar nome" }).check();
  await card.getByLabel("Nome da pessoa ou empresa").fill("  Limpa Água Serviços  ");
  expect(writes).toHaveLength(0);
  await card.getByRole("button", { name: "Salvar responsável" }).click();
  await expect(card).toContainText("Limpa Água Serviços");
  expect(writes[0]).toEqual({ version: 1, assignedName: "Limpa Água Serviços", assignedUserId: null, assignedTeamId: null });
  await page.reload();
  await expect(item(page)).toContainText("Limpa Água Serviços");
  await item(page).getByRole("button", { name: "Alterar responsável" }).click();
  await item(page).getByRole("radio", { name: "Definir depois" }).check();
  await item(page).getByRole("button", { name: "Salvar responsável" }).click();
  await expect(item(page)).toContainText("Sem responsável");
});

test("discard does not save and blank provider names cannot be submitted", async ({ page }) => {
  const writes = await prepare(page);
  await item(page).getByRole("button", { name: "Alterar responsável" }).click();
  await item(page).getByRole("radio", { name: "Digitar nome" }).check();
  await item(page).getByLabel("Nome da pessoa ou empresa").fill("   ");
  await expect(item(page).getByRole("button", { name: "Salvar responsável" })).toBeDisabled();
  await item(page).getByLabel("Nome da pessoa ou empresa").fill("Nome descartado");
  await expect(item(page).getByRole("button", { name: "Iniciar", exact: true })).toBeDisabled();
  await item(page).getByRole("button", { name: "Descartar" }).click();
  expect(writes).toHaveLength(0);
  await expect(item(page)).toContainText("Equipe Manutenção predial");
  await expect(item(page).getByRole("button", { name: "Iniciar", exact: true })).toBeEnabled();
});

test("a failed save preserves the typed name for retry", async ({ page }) => {
  const writes = await prepare(page);
  let refused = false;
  await page.route(`${API}/v1/work-orders/*`, async route => {
    if (route.request().method() === "PATCH" && !refused) {
      refused = true;
      return route.fulfill({ status: 503, json: { error: "Não foi possível salvar agora. Tente novamente." } });
    }
    return route.fallback();
  });
  await item(page).getByRole("button", { name: "Alterar responsável" }).click();
  await item(page).getByRole("radio", { name: "Digitar nome" }).check();
  await item(page).getByLabel("Nome da pessoa ou empresa").fill("Prestador mantido");
  await item(page).getByRole("button", { name: "Salvar responsável" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível salvar agora");
  await expect(item(page).getByLabel("Nome da pessoa ou empresa")).toHaveValue("Prestador mantido");
  await expect(item(page).getByRole("button", { name: "Salvar responsável" })).toBeEnabled();
  expect(writes).toHaveLength(0);
  await item(page).getByRole("button", { name: "Salvar responsável" }).click();
  await expect(item(page)).toContainText("Prestador mantido");
  expect(writes).toHaveLength(1);
});

test("registered people can be searched without accents and assigned", async ({ page }) => {
  const writes = await prepare(page);
  await item(page).getByRole("button", { name: "Alterar responsável" }).click();
  await item(page).getByLabel("Buscar pessoa ou equipe").fill("joao");
  const select = item(page).getByRole("combobox", { name: "Responsável", exact: true });
  await expect(select.getByRole("option", { name: "João Ferreira" })).toHaveCount(1);
  await expect(select.getByRole("option", { name: "Ana Martins" })).toHaveCount(0);
  await select.selectOption("user:joao");
  expect(writes).toHaveLength(0);
  await item(page).getByRole("button", { name: "Salvar responsável" }).click();
  await expect(item(page)).toContainText("João Ferreira");
  expect(writes[0]).toEqual({ version: 1, assignedName: null, assignedUserId: "joao", assignedTeamId: null });
});

test("new orders accept an external provider", async ({ page }) => {
  const writes = await prepare(page);
  const form = page.getByRole("form", { name: "Nova ordem de serviço", exact: true });
  await form.getByLabel("O que precisa ser feito").fill("Revisar bomba");
  await form.getByLabel("Nome da pessoa ou empresa").fill("Carlos · Hidráulica");
  await form.getByRole("button", { name: "Abrir ordem de serviço" }).click();
  await expect(page.getByRole("status")).toContainText("Ordem de serviço aberta.");
  expect(writes[0]).toMatchObject({ title: "Revisar bomba", assignedName: "Carlos · Hidráulica", assignedUserId: null, assignedTeamId: null });
});

test("executors cannot edit the provider", async ({ page }) => {
  await prepare(page, false);
  await expect(page.getByRole("form", { name: "Nova ordem de serviço" })).toHaveCount(0);
  await expect(item(page).getByRole("button", { name: "Alterar responsável" })).toHaveCount(0);
  await expect(item(page).getByRole("button", { name: "Iniciar", exact: true })).toBeVisible();
});

test("desktop and mobile layouts fit and keep the provider form usable", async ({ page }, testInfo) => {
  await prepare(page);
  await item(page).getByRole("button", { name: "Alterar responsável" }).click();
  await item(page).getByRole("radio", { name: "Digitar nome" }).check();
  await item(page).getByLabel("Nome da pessoa ou empresa").fill("Limpa Água Serviços");
  await page.screenshot({ path: testInfo.outputPath("ordens-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(item(page).getByLabel("Nome da pessoa ou empresa")).toBeVisible();
  await expect(item(page).getByRole("button", { name: "Salvar responsável" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ordens-mobile.png"), fullPage: true });
});
