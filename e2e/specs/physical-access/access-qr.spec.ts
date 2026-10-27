import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "../../support/fixtures";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "../../support/environment";
import { authenticatedApi, isolatedTenant, signIn } from "../../support/helpers";
import { withFixtureDatabase } from "../../support/database";

// The resident reads the totem QR in the native app; here the browser plays the
// tablet and the API call stands in for that app, which has no browser surface.
async function qrFixture(request: APIRequestContext) {
  const base = await isolatedTenant(request);
  const gateway = await base.managerApi.create<{ id: string }>("/gateways", {
    buildingId: base.building.id, name: "Gateway do totem", serialNumber: `E2E-QR-${randomUUID()}`,
  });
  const device = await base.managerApi.create<{ id: string }>("/devices", {
    buildingId: base.building.id, gatewayId: gateway.id, name: "Controlador do totem", type: "GATE_CONTROLLER",
  });
  const gate = await base.managerApi.create<{ id: string }>("/access", {
    buildingId: base.building.id, gatewayId: gateway.id, deviceId: device.id,
    name: "Portão do totem", kind: "GARAGE", enabled: true, allowResidents: true,
  });
  const online = () => withFixtureDatabase(async (sql) => {
    await sql`update gateways set enabled=true,status='ONLINE',last_seen_at=clock_timestamp() where id=${gateway.id}`;
    await sql`update devices set enabled=true,status='ONLINE',last_seen_at=clock_timestamp() where id=${device.id}`;
  });
  await online();
  const residentApi = await authenticatedApi(request, base.resident.email);
  const cleanup = () => withFixtureDatabase((sql) => sql.begin(async (tx) => {
    await tx`delete from gate_commands where building_id=${base.building.id}`;
    await tx`delete from audit_logs where building_id=${base.building.id}`;
    await tx`delete from buildings where id=${base.building.id}`;
    await tx`delete from users where id in ${tx([base.manager.id, base.resident.id])}`;
  }));
  return { ...base, gate, residentApi, online, cleanup };
}
const gateCard = (page: Page) =>
  page.getByRole("heading", { name: "Portão do totem", exact: true })
    // e2e-selector-allow: o Card não tem região nomeada, como na spec de acessos.
    .locator("xpath=ancestor::section[1]");
const totems = (page: Page) => page.getByRole("region", { name: "Totens de Portão do totem" });

test("QR do totem: a plataforma libera, o síndico pareia o tablet e exigir QR muda o portal do morador", async ({ browser, page, request }) => {
  const f = await qrFixture(request);
  const tablet = await browser.newContext();
  try {
    await signIn(page, BUILDING_URL, f.manager.email);
    await page.goto(`${BUILDING_URL}/acessos`);
    await expect(page.getByRole("heading", { name: "Portão do totem", exact: true })).toBeVisible();
    await expect(totems(page)).toHaveCount(0);

    const released = await f.api.put(`/features/buildings/${f.building.id}/GATE_QR_ACCESS`,
      { enabled: true, version: 0, reason: "Adicional contratado na E2E" });
    expect(released.status()).toBe(200);
    await page.reload();
    await expect(totems(page).getByText("Nenhum tablet pareado para este portão.")).toBeVisible();

    const issued = page.waitForResponse((r) => r.url() === `${API_URL}/access/${f.gate.id}/totems/pairing` && r.request().method() === "POST");
    await totems(page).getByRole("button", { name: "Parear tablet", exact: true }).click();
    expect((await issued).status()).toBe(201);
    const dialog = page.getByRole("dialog", { name: "Parear tablet de Portão do totem" });
    const code = (await dialog.getByLabel("Código de pareamento").textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    const screen = await tablet.newPage();
    await screen.goto(`${BUILDING_URL}/totem`);
    await screen.getByLabel("Código de pareamento").fill(code.toLowerCase());
    await screen.getByLabel("Nome deste tablet").fill("Tablet da garagem");
    const shown = screen.waitForResponse((r) => r.url() === `${API_URL}/totem/display` && r.ok());
    await screen.getByRole("button", { name: "Parear tablet", exact: true }).click();
    const display = await (await shown).json() as { current: { content: string } };
    await expect(screen.getByRole("heading", { name: "Portão do totem", exact: true })).toBeVisible();
    await expect(screen.getByRole("img", { name: "QR do portão" })).toBeVisible();
    expect(display.current.content).toMatch(/^predioon-portao:v1:/);

    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(totems(page).getByText("Tablet da garagem", { exact: true })).toBeVisible();

    await gateCard(page).getByRole("button", { name: "Configurar", exact: true }).click();
    await page.getByLabel("Exigir QR do totem para moradores (abrir só no local)").check();
    const saved = page.waitForResponse((r) => r.url() === `${API_URL}/access/${f.gate.id}` && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Salvar acesso", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(totems(page).getByText("Exigido para moradores", { exact: true })).toBeVisible();

    const resident = await browser.newContext();
    try {
      const portal = await resident.newPage();
      await signIn(portal, RESIDENT_URL, f.resident.email);
      await portal.goto(`${RESIDENT_URL}/acessos`);
      await expect(portal.getByText("Este portão abre pelo QR do totem, no app do morador.", { exact: true })).toBeVisible();
      await expect(portal.getByRole("button", { name: "Abrir garagem", exact: true })).toHaveCount(0);
    } finally { await resident.close(); }

    await f.online();
    const opened = await f.residentApi.post("/access/qr/open", { content: display.current.content, requestId: randomUUID() });
    expect(opened.status()).toBe(202);

    await totems(page).getByRole("button", { name: "Renovar código agora", exact: true }).click();
    const renewed = page.waitForResponse((r) => r.url() === `${API_URL}/access/${f.gate.id}/qr/renew`);
    await totems(page).getByRole("button", { name: "Confirmar renovação", exact: true }).click();
    expect((await renewed).status()).toBe(204);
    await expect(totems(page).getByText("Código renovado. O QR anterior não abre mais.")).toBeVisible();
    const stale = await f.residentApi.post("/access/qr/resolve", { content: display.current.content });
    expect(stale.status()).toBe(404);

    await totems(page).getByRole("button", { name: "Desparear", exact: true }).click();
    const revoked = page.waitForResponse((r) => r.url().startsWith(`${API_URL}/access/${f.gate.id}/totems/`) && r.request().method() === "DELETE");
    await totems(page).getByRole("button", { name: "Confirmar", exact: true }).click();
    expect((await revoked).status()).toBe(204);
    await screen.reload();
    await expect(screen.getByText("Este tablet foi despareado. Peça um novo código à administração do condomínio.")).toBeVisible();
  } finally {
    await tablet.close();
    await f.cleanup();
  }
});
