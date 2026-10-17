import { expect, test } from "./fixtures";
import { ADMIN_URL, API_URL, BUILDING_URL } from "./environment";
import { authenticatedApi, isolatedTenant, signIn } from "./helpers";

test("plataforma concede e revoga acesso temporário de suporte; o síndico acompanha sem poder alterar", async ({ page, request, browser }) => {
  const fixture = await isolatedTenant(request);
  const staff = await fixture.person("Suporte");
  const reason = `Diagnóstico do medidor ${fixture.suffix}`;

  await signIn(page, ADMIN_URL, "admin@predioon.local");
  await page.getByRole("link", { name: "Acesso de suporte", exact: true }).click();
  await page.getByLabel("Pessoa", { exact: true }).selectOption(staff.id);
  await page.getByLabel("Motivo da inclusão", { exact: true }).fill("Atendimento técnico");
  const added = page.waitForResponse(response => response.url() === `${API_URL}/v1/support-access/staff` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  expect((await added).status()).toBe(201);
  await expect(page.getByText(/ainda não acessa nenhum condomínio/)).toBeVisible();

  await page.getByLabel("Condomínio", { exact: true }).selectOption(fixture.building.id);
  await page.getByLabel("Quem recebe", { exact: true }).selectOption(staff.id);
  await page.getByRole("checkbox", { name: "Alertas", exact: true }).check();
  await page.getByLabel("Prazo", { exact: true }).selectOption("8");
  await page.getByLabel("Motivo do acesso", { exact: true }).fill(reason);
  const granted = page.waitForResponse(response => response.url() === `${API_URL}/v1/support-access/grants` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Conceder acesso", exact: true }).click();
  expect((await granted).status()).toBe(201);
  const telemetryRow = page.getByRole("listitem").filter({ hasText: "Leituras dos sensores" }).filter({ hasText: reason });
  await expect(telemetryRow).toContainText("Ativa");
  await expect(page.getByRole("listitem").filter({ hasText: "Alertas ·" }).filter({ hasText: reason })).toContainText("Ativa");

  const supportApi = await authenticatedApi(request, staff.email);
  const mine = async () => (await (await supportApi.get("/v1/support-access/mine")).json()).items as Array<{ capability: string }>;
  expect((await mine()).map(row => row.capability).sort()).toEqual(["alerts:read", "telemetry:read"]);

  // The manager reviews in another session and has no control over the grant.
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await signIn(manager, BUILDING_URL, fixture.manager.email);
  await manager.getByRole("link", { name: "Acesso de suporte", exact: true }).click();
  const reviewed = manager.getByRole("listitem").filter({ hasText: "Leituras dos sensores" }).filter({ hasText: reason });
  await expect(reviewed).toContainText("Equipe de suporte da plataforma");
  await expect(reviewed).toContainText("Ativa");
  await expect(manager.getByRole("button", { name: "Revogar", exact: true })).toHaveCount(0);

  await telemetryRow.getByRole("button", { name: "Revogar", exact: true }).click();
  const revoked = page.waitForResponse(response => response.url().startsWith(`${API_URL}/v1/support-access/grants/`) && response.request().method() === "DELETE");
  await telemetryRow.getByRole("button", { name: "Confirmar", exact: true }).click();
  expect((await revoked).status()).toBe(204);
  await expect(telemetryRow).toContainText("Revogada");
  expect((await mine()).map(row => row.capability)).toEqual(["alerts:read"]);

  await manager.reload();
  await expect(manager.getByRole("listitem").filter({ hasText: "Leituras dos sensores" }).filter({ hasText: reason })).toContainText("Revogada");
  await managerContext.close();
});
