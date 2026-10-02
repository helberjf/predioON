import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, BUILDING_URL, RESIDENT_URL } from "./environment";
import { authenticatedApi, isolatedTenant, signIn } from "./helpers";
import { withFixtureDatabase } from "./database";

async function fixture(request: APIRequestContext) {
  const base = await isolatedTenant(request);
  const delegate = await base.person("AcoesPontuais");
  const roles: string[] = [];
  const grant = async (permissions: string[], resource?: { type: string; id: string }) => {
    const role = `E2E_ACTION_${randomUUID()}`; roles.push(role);
    await withFixtureDatabase(async sql => sql.begin(async tx => {
      await tx`insert into roles(key,scope,label) values(${role},'BUILDING','Ações pontuais E2E')`;
      for (const permission of new Set(["buildings:read", ...permissions])) await tx`insert into role_permissions(role_key,permission_key) values(${role},${permission})`;
      await tx`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${delegate.id},${base.building.id},${role},${resource?.type ?? null},${resource?.id ?? null})`;
    }));
    return role;
  };
  const revoke = (role: string, permission: string) => withFixtureDatabase(async sql => { await sql`delete from role_permissions where role_key=${role} and permission_key=${permission}`; });
  const cleanup = () => withFixtureDatabase(async sql => sql.begin(async tx => {
    await tx`delete from audit_logs where building_id=${base.building.id}`;
    await tx`delete from buildings where id=${base.building.id}`;
    await tx`delete from users where id in ${tx([base.manager.id, base.resident.id, delegate.id])}`;
    if (roles.length) await tx`delete from roles where key in ${tx(roles)}`;
  }));
  return { ...base, delegate, grant, revoke, cleanup };
}
const alertRow = (page: Page, message: string) => page.getByRole("listitem").filter({ has: page.getByText(message, { exact: true }) });
const ticketRow = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
async function insertedAlert(buildingId: string, label: string, deviceId: string | null = null, gatewayId: string | null = null) {
  const id = randomUUID();
  await withFixtureDatabase(async sql => {
    await sql`insert into alerts(id,building_id,device_id,gateway_id,severity,type,message) values(${id},${buildingId},${deviceId},${gatewayId},'HIGH','GENERAL',${label})`;
  });
  return { id, message: label };
}

test("alerta exato separa reconhecer de resolver e remove controles após revogação", async ({ page, request }) => {
  const f = await fixture(request);
  try {
    const one = await insertedAlert(f.building.id, `Alerta concedido ${f.suffix}`);
    const other = await insertedAlert(f.building.id, `Alerta somente leitura ${f.suffix}`);
    const hidden = await insertedAlert(f.building.id, `Alerta privado ${f.suffix}`);
    const role = await f.grant(["alerts:read", "alerts:acknowledge"], { type: "alert", id: one.id });
    await f.grant(["alerts:read"], { type: "alert", id: other.id });
    const delegateApi = await authenticatedApi(request, f.delegate.email);
    const exact = await delegateApi.get(`/v1/authorization?buildingId=${f.building.id}&resourceType=alert&resourceId=${one.id}`);
    expect(exact.status()).toBe(200); expect((await exact.json()).capabilities).toContain("alerts:acknowledge");
    await signIn(page, BUILDING_URL, f.delegate.email); await page.goto(`${BUILDING_URL}/alertas`);
    await expect(alertRow(page, one.message)).toBeVisible();
    await expect(page.getByText(hidden.message, { exact: true })).toHaveCount(0);
    await alertRow(page, one.message).getByRole("button", { name: "Ver ações deste alerta", exact: true }).click();
    await expect(alertRow(page, one.message).getByRole("button", { name: "Reconhecer", exact: true })).toBeVisible();
    await expect(alertRow(page, one.message).getByRole("button", { name: "Resolver", exact: true })).toHaveCount(0);
    await f.revoke(role, "alerts:acknowledge");
    await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
    await expect(alertRow(page, one.message).getByRole("button", { name: "Reconhecer", exact: true })).toHaveCount(0);
    expect((await delegateApi.post(`/alerts/${one.id}/acknowledge`, {})).status()).toBe(403);
    await f.grant(["alerts:acknowledge"], { type: "alert", id: one.id });
    await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
    await expect(alertRow(page, one.message).getByRole("button", { name: "Reconhecer", exact: true })).toBeVisible();
    const acknowledged = page.waitForResponse(response => response.url() === `${API_URL}/alerts/${one.id}/acknowledge` && response.request().method() === "POST");
    await alertRow(page, one.message).getByRole("button", { name: "Reconhecer", exact: true }).click();
    const acknowledgement = await acknowledged;
    expect(acknowledgement.status()).toBe(200); expect((await acknowledgement.json()).status).toBe("ACKNOWLEDGED");
    await expect(alertRow(page, one.message)).toContainText("Em atendimento");
    await alertRow(page, other.message).getByRole("button", { name: "Ver ações deste alerta", exact: true }).click();
    await expect(alertRow(page, other.message).getByText("Nenhuma ação disponível para seu perfil neste alerta.")).toBeVisible();
    await expect(alertRow(page, other.message).getByRole("button", { name: /^(Reconhecer|Resolver)$/ })).toHaveCount(0);
    await f.revoke(role, "alerts:read");
    await page.getByRole("button", { name: "Atualizar alertas", exact: true }).click();
    await expect(page.getByText(one.message, { exact: true })).toHaveCount(0);
    await expect(page.getByText(other.message, { exact: true })).toBeVisible();
    expect((await delegateApi.post(`/alerts/${one.id}/resolve`, {})).status()).toBe(404);
  } finally { await f.cleanup(); }
});

test("alerta combina leitura no equipamento e resolução no gateway real sem consultar inventário", async ({ page, request }) => {
  const f = await fixture(request);
  try {
    const gatewayId = `e2e-action-gateway-${randomUUID()}`;
    await withFixtureDatabase(async sql => { await sql`insert into gateways(id,building_id,name,serial_number) values(${gatewayId},${f.building.id},'Gateway de ações',${gatewayId})`; });
    const device = await f.managerApi.create<{ id: string }>("/devices", { buildingId: f.building.id, gatewayId, name: "Dispositivo de ações", type: "WATER_LEVEL_SENSOR" });
    const one = await insertedAlert(f.building.id, `Alerta de pais combinados ${f.suffix}`, device.id, gatewayId);
    const noGateway = await insertedAlert(f.building.id, `Alerta sem gateway registrado ${f.suffix}`, device.id);
    const neighbor = await insertedAlert(f.building.id, `Outro alerta privado ${f.suffix}`);
    await f.grant(["alerts:read"], { type: "device", id: device.id });
    await f.grant(["alerts:resolve"], { type: "gateway", id: gatewayId });
    await signIn(page, BUILDING_URL, f.delegate.email);
    const inventory: string[] = [];
    page.on("request", request => { if (["/devices", "/gateways"].includes(new URL(request.url()).pathname)) inventory.push(request.url()); });
    await page.goto(`${BUILDING_URL}/alertas`);
    await alertRow(page, one.message).getByRole("button", { name: "Ver ações deste alerta", exact: true }).click();
    await expect(alertRow(page, one.message).getByRole("button", { name: "Reconhecer", exact: true })).toHaveCount(0);
    const resolved = page.waitForResponse(response => response.url() === `${API_URL}/alerts/${one.id}/resolve` && response.request().method() === "POST");
    await alertRow(page, one.message).getByRole("button", { name: "Resolver", exact: true }).click();
    const resolution = await resolved;
    expect(resolution.status()).toBe(200); expect((await resolution.json()).status).toBe("RESOLVED");
    await expect(alertRow(page, one.message)).toContainText("Resolvido");
    await alertRow(page, noGateway.message).getByRole("button", { name: "Ver ações deste alerta", exact: true }).click();
    await expect(alertRow(page, noGateway.message).getByText("Nenhuma ação disponível para seu perfil neste alerta.")).toBeVisible();
    await expect(alertRow(page, noGateway.message).getByRole("button", { name: "Resolver", exact: true })).toHaveCount(0);
    const delegateApi = await authenticatedApi(request, f.delegate.email);
    expect((await delegateApi.post(`/alerts/${noGateway.id}/resolve`, {})).status()).toBe(403);
    await expect(page.getByText(neighbor.message, { exact: true })).toHaveCount(0);
    expect(inventory).toEqual([]);
  } finally { await f.cleanup(); }
});

test("gestão de chamado exato altera somente o item concedido sem criar chamado nem agir sobre grupo oculto", async ({ page, request }) => {
  const f = await fixture(request);
  try {
    const residentApi = await authenticatedApi(request, f.resident.email);
    const one = await residentApi.create<{ id: string; title: string }>("/occurrences", { buildingId: f.building.id, title: `Chamado delegado ${f.suffix}`, description: "Relato privado autorizado", category: "GENERAL" });
    const hidden = await residentApi.create<{ id: string; title: string }>("/occurrences", { buildingId: f.building.id, title: `Vizinho oculto ${f.suffix}`, description: "Relato privado do vizinho", category: "GENERAL" });
    expect((await f.managerApi.post("/occurrences/group", { buildingId: f.building.id, occurrenceIds: [one.id, hidden.id] })).status()).toBe(201);
    const role = await f.grant(["occurrences:manage"], { type: "occurrence", id: one.id });
    const delegateApi = await authenticatedApi(request, f.delegate.email);
    expect((await delegateApi.get(`/occurrences/${one.id}`)).status()).toBe(200);
    await signIn(page, BUILDING_URL, f.delegate.email); await page.goto(`${BUILDING_URL}/chamados`);
    await expect(ticketRow(page, one.title)).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir novo chamado", exact: true })).toHaveCount(0);
    await ticketRow(page, one.title).getByRole("button", { name: "Ver histórico e responder", exact: true }).click();
    await expect(page.getByLabel("Situação do chamado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar meu chamado", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Aplicar status/ })).toHaveCount(0);
    await expect(page.getByText(hidden.title, { exact: true })).toHaveCount(0);
    // Hold real pre-revocation responses, rather than fabricating a payload.
    // A manual refresh during this window must queue a fresh authorized read.
    let release!: () => void;
    let hold = true;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const targets = ["list", "detail", "authorization"] as const;
    const arrivals = new Map<string, () => void>();
    const arrived = targets.map(target => new Promise<void>(resolve => { arrivals.set(target, resolve); }));
    await page.route(url => url.origin === API_URL && (url.pathname === "/occurrences" || url.pathname === `/occurrences/${one.id}` || (url.pathname === "/v1/authorization" && url.searchParams.get("resourceId") === one.id)), async route => {
      if (!hold || route.request().method() !== "GET") return route.continue();
      const url = new URL(route.request().url());
      const target = url.pathname === "/occurrences" ? "list" : url.pathname === "/v1/authorization" ? "authorization" : "detail";
      const response = await route.fetch();
      arrivals.get(target)?.();
      await pending;
      await route.fulfill({ response });
    });
    try {
      await page.getByLabel("Situação do chamado", { exact: true }).selectOption("IN_PROGRESS");
      const changed = page.waitForResponse(response => response.url() === `${API_URL}/occurrences/${one.id}` && response.request().method() === "PATCH");
      await page.getByRole("button", { name: "Salvar andamento", exact: true }).click();
      expect((await changed).status()).toBe(200);
      await Promise.all(arrived);
      expect((await (await f.managerApi.get(`/occurrences/${hidden.id}`)).json()).status).toBe("OPEN");
      await page.getByLabel("Mensagem para este chamado", { exact: true }).fill("Rascunho que deve desaparecer após revogação");
      await f.revoke(role, "occurrences:manage");
      await page.getByRole("button", { name: "Atualizar", exact: true }).click();
      hold = false; release();
      await expect(page.getByLabel("Mensagem para este chamado", { exact: true })).toHaveCount(0);
      await expect(page.getByText(one.title, { exact: true })).toHaveCount(0);
      expect((await delegateApi.patch(`/occurrences/${one.id}`, { status: "DONE" })).status()).toBe(404);
    } finally { hold = false; release(); await page.unrouteAll({ behavior: "wait" }); }
  } finally { await f.cleanup(); }
});

test("leitura própria exata permite responder e cancelar, mas não concede criação ou gestão no portal do morador", async ({ page, request }) => {
  const f = await fixture(request);
  try {
    const temporary = await f.grant(["occurrences:read-own", "occurrences:create-own"]);
    const delegateApi = await authenticatedApi(request, f.delegate.email);
    const own = await delegateApi.create<{ id: string; title: string }>("/occurrences", { buildingId: f.building.id, title: `Meu chamado exato ${f.suffix}`, description: "Relato próprio para acompanhamento", category: "GENERAL" });
    await f.revoke(temporary, "occurrences:read-own"); await f.revoke(temporary, "occurrences:create-own");
    await f.grant(["occurrences:read-own"], { type: "occurrence", id: own.id });
    await signIn(page, RESIDENT_URL, f.delegate.email); await page.goto(`${RESIDENT_URL}/chamados`);
    await expect(ticketRow(page, own.title)).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir novo chamado", exact: true })).toHaveCount(0);
    await ticketRow(page, own.title).getByRole("button", { name: "Ver histórico e responder", exact: true }).click();
    await expect(page.getByLabel("Situação do chamado", { exact: true })).toHaveCount(0);
    await page.getByLabel("Mensagem para este chamado", { exact: true }).fill("Nova informação do solicitante");
    const comment = page.waitForResponse(response => response.url() === `${API_URL}/occurrences/${own.id}/comments` && response.request().method() === "POST");
    await page.getByRole("button", { name: "Enviar resposta", exact: true }).click(); expect((await comment).status()).toBe(201);
    await expect(page.getByText("Nova informação do solicitante", { exact: true })).toBeVisible();
    const cancelled = page.waitForResponse(response => response.url() === `${API_URL}/occurrences/${own.id}` && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Cancelar meu chamado", exact: true }).click(); expect((await cancelled).status()).toBe(200);
    expect((await (await delegateApi.get(`/occurrences/${own.id}`)).json()).status).toBe("CANCELLED");
    expect((await delegateApi.post("/occurrences", { buildingId: f.building.id, title: "Criação não autorizada", description: "Descrição", category: "GENERAL" })).status()).toBe(403);
  } finally { await f.cleanup(); }
});
