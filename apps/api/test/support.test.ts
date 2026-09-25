import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, users, organizations, buildings, memberships, auditLogs, sqlClient, closeAppDb, withUserContext } from "@predioon/db";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("suporte remoto HTTP e RLS", () => {
  const suffix = randomUUID();
  const org = `support_org_${suffix}`; const building = `support_bld_${suffix}`; const other = `support_other_${suffix}`;
  const adminId = `support_admin_${suffix}`; const residentId = `support_resident_${suffix}`; const managerId = `support_manager_${suffix}`;
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let admin: string; let resident: string; let manager: string;
  const config = { displayName: "PC Portaria", anydeskId: "123 456 789", enabled: true };
  const req = (path: string, method = "GET", body?: unknown, token = admin) => call(server.url, path, { method, token, body });
  const save = (body = config) => req(`/support/${building}`, "PUT", body);
  const open = (requestId = randomUUID(), reason = "Verificar a configuração do gateway", id = building) => req(`/support/${id}/requests`, "POST", { requestId, reason });
  before(async () => {
    const passwordHash = await hashPassword("predioon123");
    await db.insert(organizations).values({ id: org, name: "Suporte Teste", slug: org });
    await db.insert(buildings).values([{ id: building, organizationId: org, name: "Condomínio Suporte", code: building }, { id: other, organizationId: org, name: "Outro condomínio", code: other }]);
    await db.insert(users).values([
      { id: adminId, name: "Técnico Teste", email: `${adminId}@test.local`, isPlatformAdmin: true, passwordHash },
      { id: residentId, name: "Morador Teste", email: `${residentId}@test.local`, passwordHash },
      { id: managerId, name: "Síndico Teste", email: `${managerId}@test.local`, passwordHash },
    ]);
    await db.insert(memberships).values([{ userId: residentId, buildingId: building, role: "RESIDENT" }, { userId: managerId, buildingId: building, role: "BUILDING_ADMIN" }]);
    server = await startTestServer();
    admin = (await login(server.url, `${adminId}@test.local`)).accessToken;
    resident = (await login(server.url, `${residentId}@test.local`)).accessToken;
    manager = (await login(server.url, `${managerId}@test.local`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await db.delete(auditLogs).where(inArray(auditLogs.userId, [adminId, residentId, managerId]));
    await db.delete(buildings).where(inArray(buildings.id, [building, other]));
    await db.delete(users).where(inArray(users.id, [adminId, residentId, managerId]));
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeAppDb(); await sqlClient.end();
  });
  it("começa sem computador configurado e permite configurar sem armazenar senha", async () => {
    const first = await req(`/support?buildingId=${building}`);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { config: null, requests: [] });
    const response = await save(); assert.equal(response.status, 200);
    const saved = await response.json(); assert.equal(saved.anydeskId, "123456789"); assert.equal(saved.revision, 1);
    assert.ok(!JSON.stringify(saved).toLowerCase().includes("password"));
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  it("nega acesso anônimo, moradores e síndicos em todas as operações", async () => {
    assert.equal((await call(server.url, `/support?buildingId=${building}`)).status, 401);
    for (const token of [resident, manager]) {
      assert.equal((await req(`/support?buildingId=${building}`, "GET", undefined, token)).status, 403);
      assert.equal((await req(`/support/${building}`, "PUT", config, token)).status, 403);
      assert.equal((await req(`/support/${building}/requests`, "POST", { requestId: randomUUID(), reason: "Tentar conexão" }, token)).status, 403);
      assert.equal((await req(`/support/${building}/requests/${randomUUID()}`, "PATCH", { outcome: "RESOLVED", notes: "Teste" }, token)).status, 403);
    }
  });
  it("rejeita parâmetros e senhas, mesmo para administrador", async () => {
    assert.equal((await req(`/support/${building}`, "PUT", { ...config, password: "never-store" })).status, 400);
    assert.equal((await save({ ...config, anydeskId: "123456789?password=secret" })).status, 400);
    assert.equal((await req(`/support/${building}/requests`, "POST", { requestId: randomUUID(), reason: "  " })).status, 400);
    assert.equal((await req(`/support/${building}/requests`, "POST", { requestId: randomUUID(), reason: "Valid reason", anydeskId: "999999999" })).status, 400);
  });
  it("gera destino do cadastro e deduplica cliques concorrentes com uma auditoria", async () => {
    const requestId = randomUUID();
    const responses = await Promise.all([open(requestId), open(requestId)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
    const [a, b] = await Promise.all(responses.map(r => r.json()));
    assert.equal(a.request.id, b.request.id); assert.equal(a.launchUri, "anydesk:123456789");
    assert.equal(a.request.status, "OPEN"); assert.equal(a.request.closedAt, null); assert.equal(a.request.requestedByName, "Técnico Teste");
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, a.request.id));
    assert.equal(logs.filter(log => log.action === "SUPPORT_REQUESTED").length, 1);
    assert.equal((await open(requestId, "Um motivo diferente")).status, 409);
    const list = await (await req(`/support?buildingId=${other}`)).json(); assert.deepEqual(list, { config: null, requests: [] });
  });
  it("configuração desabilitada ou alterada impede reaproveitar solicitação antiga", async () => {
    const requestId = randomUUID(); assert.equal((await open(requestId)).status, 201);
    assert.equal((await save({ ...config, enabled: false })).status, 200);
    assert.equal((await open()).status, 409); assert.equal((await open(requestId)).status, 409);
    assert.equal((await save({ ...config, anydeskId: "987654321" })).status, 200);
    assert.equal((await open(requestId)).status, 409);
    assert.equal((await (await open()).json()).launchUri, "anydesk:987654321");
    assert.equal((await save()).status, 200);
  });
  it("registra resultado manual uma vez e impede encerrar pedido de outro prédio", async () => {
    const requestId = randomUUID(); const result = await (await open(requestId)).json();
    const id = result.request.id; const body = { outcome: "NOT_CONNECTED", notes: "Computador desligado; retorno necessário" };
    assert.equal((await req(`/support/${other}/requests/${id}`, "PATCH", body)).status, 404);
    assert.equal((await req(`/support/${building}/requests/${id}`, "PATCH", { ...body, outcome: "CONNECTED" })).status, 400);
    const closed = await req(`/support/${building}/requests/${id}`, "PATCH", body); assert.equal(closed.status, 200);
    const record = await closed.json(); assert.equal(record.status, "NOT_CONNECTED"); assert.equal(record.closedBy, adminId); assert.ok(record.closedAt);
    assert.equal((await req(`/support/${building}/requests/${id}`, "PATCH", body)).status, 200);
    assert.equal((await req(`/support/${building}/requests/${id}`, "PATCH", { outcome: "RESOLVED", notes: "Alteração tardia" })).status, 409);
    assert.equal((await open(requestId)).status, 409);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, id));
    assert.equal(logs.filter(log => log.action === "SUPPORT_RESULT_RECORDED").length, 1);
  });
  it("nega token antigo após desativação ou remoção de administrador", async () => {
    try {
      await db.update(users).set({ active: false }).where(eq(users.id, adminId));
      assert.equal((await req(`/support?buildingId=${building}`)).status, 403);
      assert.equal((await save()).status, 403); assert.equal((await open()).status, 403);
      const hidden = await withUserContext({ userId: adminId, role: "PLATFORM_ADMIN" }, tx => tx.execute(sql`select * from support_hosts`));
      assert.equal(hidden.length, 0, "RLS também verifica desativação atual");
      await db.update(users).set({ active: true, isPlatformAdmin: false }).where(eq(users.id, adminId));
      assert.equal((await req(`/support?buildingId=${building}`)).status, 403);
      assert.equal((await save()).status, 403); assert.equal((await open()).status, 403);
    } finally { await db.update(users).set({ active: true, isPlatformAdmin: true }).where(eq(users.id, adminId)); }
  });
  it("usa o relógio do banco ao encerrar mesmo se o relógio da API estiver atrasado", async t => {
    const opened = await open(); assert.equal(opened.status, 201);
    const item = (await opened.json()).request;
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() - 30_000 });
    try {
      const response = await req(`/support/${building}/requests/${item.id}`, "PATCH", { outcome: "UNRESOLVED", notes: "Relógio local em ajuste" });
      assert.equal(response.status, 200);
      const closed = await response.json(); assert.ok(Date.parse(closed.closedAt) >= Date.parse(closed.createdAt));
    } finally { t.mock.timers.reset(); }
  });
  it("retorna erro de validação para identificadores de caminho malformados", async () => {
    assert.equal((await req(`/support/${building}/requests/not-a-uuid`, "PATCH", { outcome: "RESOLVED", notes: "Validar equipamento" })).status, 400);
    assert.equal((await req("/support/invalid%20building", "PUT", config)).status, 400);
  });
  it("RLS protege dados mesmo com papel de administrador declarado por usuário comum", async () => {
    for (const userId of [residentId, managerId]) {
      const rows = await withUserContext({ userId, role: "PLATFORM_ADMIN" }, tx => tx.execute(sql`select * from support_hosts`));
      assert.equal(rows.length, 0);
      const requests = await withUserContext({ userId, role: "PLATFORM_ADMIN" }, tx => tx.execute(sql`select * from support_requests`));
      assert.equal(requests.length, 0);
      const changed = await withUserContext({ userId, role: "PLATFORM_ADMIN" }, tx => tx.execute(sql`update support_hosts set enabled = false where building_id = ${building} returning building_id`));
      assert.equal(changed.length, 0);
      const hiddenAudit = await withUserContext({ userId, role: userId === managerId ? "BUILDING_ADMIN" : "RESIDENT" }, tx => tx.execute(sql`select * from audit_logs where resource_type = 'remote_support'`));
      assert.equal(hiddenAudit.length, 0, "histórico técnico não vaza pela auditoria geral");
      await assert.rejects(withUserContext({ userId, role: "PLATFORM_ADMIN" }, tx => tx.execute(sql`insert into support_hosts (building_id,display_name,anydesk_id) values (${other},'Malicioso','999999999')`)));
    }
  });
  it("condomínio inativo ou inexistente não recebe solicitações", async () => {
    assert.equal((await open(randomUUID(), "Verificação", `missing_${suffix}`)).status, 404);
    await db.update(buildings).set({ active: false }).where(eq(buildings.id, other));
    assert.equal((await req(`/support/${other}`, "PUT", config)).status, 404);
  });
});
