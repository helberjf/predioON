import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, users, organizations, buildings, memberships, auditLogs, globalFeatureSettings, buildingFeatureSettings, featureRuntime, sqlClient, closeAppDb, withUserContext } from "@predioon/db";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("central de funcionalidades", () => {
  const id = randomUUID(), org = `flag_org_${id}`, b = `flag_b_${id}`, other = `flag_other_${id}`;
  const adminId = `flag_admin_${id}`, managerId = `flag_manager_${id}`;
  let server: Awaited<ReturnType<typeof startTestServer>>, admin: string, manager: string;
  let originalGlobal: typeof globalFeatureSettings.$inferSelect[] = [], originalRuntime: typeof featureRuntime.$inferSelect[] = [];
  const request = (path: string, method = "GET", body?: unknown, token = admin) => call(server.url, path, { method, token, body });
  async function ok(path: string, method = "GET", body?: unknown, token = admin) {
    const response = await request(path, method, body, token), data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data)); return data;
  }
  async function set(key: string, enabled: boolean | null, building = b) {
    const states = await ok(`/features/buildings/${building}`), state = states.items.find((s: any) => s.key === key);
    return ok(`/features/buildings/${building}/${key}`, "PUT", { enabled, version: state.version, reason: "Configuração de teste isolado" });
  }
  before(async () => {
    originalGlobal = await db.select().from(globalFeatureSettings).where(eq(globalFeatureSettings.key, "NOTICES"));
    originalRuntime = await db.select().from(featureRuntime).where(eq(featureRuntime.key, "NOTICES"));
    const passwordHash = await hashPassword("predioon123");
    await db.insert(organizations).values({ id: org, name: "Feature test", slug: org });
    await db.insert(buildings).values([b, other].map(id => ({ id, organizationId: org, name: id, code: id })));
    await db.insert(users).values([{ id: adminId, name: "Admin", email: `${adminId}@test.local`, passwordHash, isPlatformAdmin: true }, { id: managerId, name: "Manager", email: `${managerId}@test.local`, passwordHash }]);
    await db.insert(memberships).values({ userId: managerId, buildingId: b, role: "BUILDING_ADMIN" });
    server = await startTestServer();
    admin = (await login(server.url, `${adminId}@test.local`)).accessToken;
    manager = (await login(server.url, `${managerId}@test.local`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await db.delete(globalFeatureSettings).where(eq(globalFeatureSettings.key, "NOTICES"));
    if (originalGlobal.length) await db.insert(globalFeatureSettings).values(originalGlobal);
    await db.delete(featureRuntime).where(eq(featureRuntime.key, "NOTICES"));
    if (originalRuntime.length) await db.insert(featureRuntime).values(originalRuntime);
    await db.delete(auditLogs).where(eq(auditLogs.userId, adminId));
    await db.delete(buildings).where(inArray(buildings.id, [b, other]));
    await db.delete(users).where(inArray(users.id, [adminId, managerId]));
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeAppDb(); await sqlClient.end();
  });
  it("defaults keep all 23 features available and only platform admin can configure", async () => {
    assert.equal((await ok("/features/catalog")).items.length, 23);
    assert.equal((await ok(`/features/buildings/${b}`, "GET", undefined, manager)).items.length, 23);
    assert.equal((await request("/features/global", "GET", undefined, manager)).status, 403);
    assert.equal((await request(`/features/buildings/${b}/GAS`, "PUT", { enabled: false, version: 0, reason: "Sem permissão" }, manager)).status, 403);
    assert.equal((await request(`/features/buildings/${other}`, "GET", undefined, manager)).status, 403);
  });
  it("local setting is audited, versioned and global disable preserves local preference", async () => {
    await set("NOTICES", true);
    let states = await ok("/features/global"), current = states.items.find((s: any) => s.key === "NOTICES");
    await ok("/features/global/NOTICES", "PUT", { enabled: false, version: current.globalVersion, reason: "Pausa global de teste" });
    let local = (await ok(`/features/buildings/${b}`)).items.find((s: any) => s.key === "NOTICES");
    assert.equal(local.enabled, false); assert.equal(local.localEnabled, true); assert.equal(local.blockedBy, "GLOBAL");
    states = await ok("/features/global"); current = states.items.find((s: any) => s.key === "NOTICES");
    await ok("/features/global/NOTICES", "PUT", { enabled: true, version: current.globalVersion, reason: "Retomada global de teste" });
    local = (await ok(`/features/buildings/${b}`)).items.find((s: any) => s.key === "NOTICES");
    assert.equal(local.enabled, true); assert.ok(local.resumedAt);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.userId, adminId));
    assert.ok(logs.some(log => (log.metadata as any)?.reason === "Pausa global de teste"));
  });
  it("invalid settings and stale versions cannot overwrite a newer change", async () => {
    assert.equal((await request(`/features/buildings/${b}/GAS`, "PUT", { enabled: false, version: 0, reason: " " })).status, 400);
    assert.equal((await request("/features/global/GAS", "PUT", { enabled: null, version: 0, reason: "Inválido global" })).status, 400);
    const body = { enabled: false, version: 0, reason: "Pausa para manutenção" };
    const responses = await Promise.all([request(`/features/buildings/${b}/GAS`, "PUT", body), request(`/features/buildings/${b}/GAS`, "PUT", body)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request(`/features/buildings/${b}/NOT_A_FEATURE`, "PUT", body)).status, 400);
  });
  it("dependencies block grouping and severity without mutating preferences", async () => {
    await set("TICKET_GROUPING", true); await set("TICKETS", false);
    let items = (await ok(`/features/buildings/${b}`)).items;
    assert.equal(items.find((s: any) => s.key === "TICKET_GROUPING").enabled, false);
    assert.equal(items.find((s: any) => s.key === "TICKET_PRIORITY").blockedBy, "TICKETS");
    await set("TICKETS", null);
    items = (await ok(`/features/buildings/${b}`)).items;
    assert.equal(items.find((s: any) => s.key === "TICKET_GROUPING").enabled, true);
  });
  it("RLS prevents manager writes and another building's settings are not visible", async () => {
    await set("GAS", false, other);
    await assert.rejects(withUserContext({ userId: managerId, role: "BUILDING_ADMIN" }, tx => tx.insert(buildingFeatureSettings).values({ buildingId: b, key: "SMOKE", enabled: false })));
    const rows = await withUserContext({ userId: managerId, role: "BUILDING_ADMIN" }, tx => tx.select().from(buildingFeatureSettings).where(eq(buildingFeatureSettings.buildingId, other)));
    assert.equal(rows.length, 0);
    await assert.rejects(withUserContext({ userId: managerId, role: "BUILDING_ADMIN" }, tx => tx.execute(sql`select app_apply_feature_transition(${b}, 'GAS', true)`)));
  });
  it("disabled or demoted platform admin loses access immediately with the old token", async () => {
    await db.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, adminId));
    try { assert.equal((await request("/features/global")).status, 403); }
    finally { await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, adminId)); }
    await db.update(users).set({ active: false }).where(eq(users.id, adminId));
    try { assert.equal((await request(`/features/buildings/${b}/GAS`, "PUT", { enabled: true, version: 1, reason: "Conta desativada" })).status, 403); }
    finally { await db.update(users).set({ active: true }).where(eq(users.id, adminId)); }
  });
});
