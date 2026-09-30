import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, and } from "drizzle-orm";
import { db, sqlClient, devices, gateways, memberships, auditLogs, users } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { gates, gateCommands } from "../../../packages/db/src/schema-access.js";
import { startTestServer, login, call } from "./helpers.js";
import { hashPassword } from "../src/auth/passwords.js";

describe("acessos HTTP e isolamento RLS", { skip: process.env.RUN_ACCESS_DB_TESTS !== "1" }, () => {
  const suffix = randomUUID();
  const gatewayId = `gw_access_${suffix}`; const deviceId = `gate_${suffix}`;
  const residentId = `resident_access_${suffix}`; const email = `${residentId}@test.local`;
  let gateId: string; let server: Awaited<ReturnType<typeof startTestServer>>;
  let admin: Awaited<ReturnType<typeof login>>; let resident: Awaited<ReturnType<typeof login>>;
  before(async () => {
    await db.insert(users).values({ id: residentId, name: "Morador acessos", email, passwordHash: await hashPassword("predioon123") });
    await db.insert(memberships).values({ userId: residentId, buildingId: "bld_001", role: "RESIDENT" });
    await db.insert(gateways).values({ id: gatewayId, buildingId: "bld_001", name: "Gateway acessos", serialNumber: gatewayId, status: "ONLINE", lastSeenAt: new Date() });
    await db.insert(devices).values({ id: deviceId, buildingId: "bld_001", gatewayId, name: "Garagem", type: "GARAGE_GATE", status: "ONLINE", lastSeenAt: new Date() });
    server = await startTestServer();
    admin = await login(server.url, "admin@predioon.local");
    resident = await login(server.url, email);
    const created = await call(server.url, "/access", { method: "POST", token: admin.accessToken, body: { buildingId: "bld_001", name: "Garagem teste", kind: "GARAGE", gatewayId, deviceId, enabled: true, allowResidents: true } });
    assert.equal(created.status, 201); gateId = (await created.json()).id;
  });
  after(async () => {
    await server?.close();
    if (gateId) { await db.delete(gateCommands).where(eq(gateCommands.gateId, gateId)); await db.delete(auditLogs).where(eq(auditLogs.resourceId, gateId)); await db.delete(gates).where(eq(gates.id, gateId)); }
    await db.delete(devices).where(eq(devices.id, deviceId)); await db.delete(gateways).where(eq(gateways.id, gatewayId));
    await db.delete(users).where(eq(users.id, residentId));
    await closeAppDb(); await sqlClient.end();
  });
  it("morador não altera configuração e prédio externo é negado", async () => {
    assert.equal((await call(server.url, `/access/${gateId}`, { method: "PATCH", token: resident.accessToken, body: { enabled: false } })).status, 403);
    assert.equal((await call(server.url, "/access?buildingId=bld_002", { token: resident.accessToken })).status, 403);
    const modified = await withUserContext({ userId: residentId, role: "RESIDENT" }, tx => tx.update(gates).set({ enabled: false }).where(eq(gates.id, gateId)).returning());
    assert.equal(modified.length, 0, "RLS também bloqueia alteração direta por morador");
  });
  it("mantém pendente até ACK, deduplica pedidos e limita novas aberturas", async () => {
    const requestId = randomUUID();
    const open = () => call(server.url, `/access/${gateId}/open`, { method: "POST", token: resident.accessToken, body: { requestId } });
    const first = await open(); assert.equal(first.status, 202); const one = await first.json(); assert.equal(one.status, "PENDING");
    const repeat = await open(); assert.equal(repeat.status, 200); assert.equal((await repeat.json()).id, one.id);
    assert.equal((await call(server.url, `/access/${gateId}/open`, { method: "POST", token: resident.accessToken, body: { requestId: randomUUID() } })).status, 429);
  });
  it("token antigo não abre depois da revogação do vínculo", async () => {
    await db.update(memberships).set({ active: false }).where(and(eq(memberships.userId, resident.user.id), eq(memberships.buildingId, "bld_001")));
    assert.equal((await call(server.url, `/access/${gateId}/open`, { method: "POST", token: resident.accessToken, body: { requestId: randomUUID() } })).status, 403);
  });
});
