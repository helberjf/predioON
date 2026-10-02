import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { sql } from "drizzle-orm";
import { call, json, login, startTestServer, unique, type Session, type TestServer } from "./helpers.js";

describe("parking and scheduled notices integration", () => {
  let server: TestServer;
  let admin: Session;
  let resident: Session;
  const buildingId = unique("parking-bld");
  const organizationId = unique("parking-org");
  let carId: string;
  let noticeId: string;
  before(async () => {
    await sqlClient`insert into organizations (id, name, slug) values (${organizationId}, 'Parking test', ${organizationId})`;
    await sqlClient`insert into buildings (id, organization_id, name, code) values (${buildingId}, ${organizationId}, 'Parking test', ${buildingId})`;
    await sqlClient`insert into memberships (user_id, building_id, role) values ('building_admin', ${buildingId}, 'BUILDING_ADMIN'), ('resident_demo', ${buildingId}, 'RESIDENT')`;
    server = await startTestServer();
    admin = await login(server.url, "sindico@predioon.local");
    resident = await login(server.url, "morador@predioon.local");
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from buildings where id = ${buildingId}`;
    await sqlClient`delete from organizations where id = ${organizationId}`;
    await closeAppDb();
    await sqlClient.end();
  });
  it("creates separate car and motorcycle capacities without inventing availability", async () => {
    for (const [vehicleType, capacity] of [["CAR", 20], ["MOTORCYCLE", 8]]) {
      const response = await call(server.url, "/parking", { method: "POST", token: admin.accessToken, body: { buildingId, vehicleType, capacity } });
      assert.equal(response.status, 201);
      const lot = await json<{ id: string; available: number | null; status: string }>(response);
      assert.equal(lot.available, null);
      assert.equal(lot.status, "UNKNOWN");
      if (vehicleType === "CAR") carId = lot.id;
    }
  });
  it("blocks residents and unrelated buildings in both API and RLS", async () => {
    const edit = await call(server.url, `/parking/${carId}/occupancy`, { method: "PATCH", token: resident.accessToken, body: { occupied: 1, version: 1 } });
    assert.equal(edit.status, 403);
    assert.equal((await call(server.url, "/parking?buildingId=not-my-building", { token: resident.accessToken })).status, 403);
    await assert.rejects(withUserContext({ userId: "resident_demo", role: "RESIDENT" }, tx => tx.execute(sql`insert into parking_lots (building_id, vehicle_type, capacity) values ('bld_001', 'CAR', 10)`)));
    const visible = await withUserContext({ userId: "nobody", role: "RESIDENT" }, tx => tx.execute(sql`select id from parking_lots`));
    assert.equal(visible.length, 0);
  });
  it("rejects invalid occupancy and prevents lost updates with optimistic concurrency", async () => {
    for (const occupied of [-1, 1.5, 21]) {
      assert.equal((await call(server.url, `/parking/${carId}/occupancy`, { method: "PATCH", token: admin.accessToken, body: { occupied, version: 1 } })).status, 400);
    }
    const responses = await Promise.all([4, 5].map(occupied => call(server.url, `/parking/${carId}/occupancy`, { method: "PATCH", token: admin.accessToken, body: { occupied, version: 1 } })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const response = responses.find(r => r.status === 200)!;
    const lot = await json<{ occupied: number; available: number; source: string; version: number }>(response);
    assert.equal(lot.available, 20 - lot.occupied);
    assert.equal(lot.source, "MANUAL");
    assert.equal(lot.version, 2);
    const [audit] = await sqlClient`select action from audit_logs where resource_id = ${carId} and action = 'PARKING_OCCUPANCY_UPDATED'`;
    assert.ok(audit);
  });
  it("does not expose stale counts as current availability", async () => {
    await sqlClient`update parking_lots set observed_at = now() - interval '1 hour' where id = ${carId}`;
    const { items } = await json<{ items: Array<{ id: string; available: number | null; status: string }> }>(await call(server.url, `/parking?buildingId=${buildingId}`, { token: resident.accessToken }));
    assert.equal(items.find(l => l.id === carId)?.status, "STALE");
    assert.equal(items.find(l => l.id === carId)?.available, null);
  });
  it("hides future publication from residents, while admins can manage its recurrence", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const response = await call(server.url, "/notices", { method: "POST", token: admin.accessToken, body: { buildingId, title: "Dia do lixo", body: "Levar o lixo às 19h.", publishedAt: future, schedule: { startsAt: future, recurrence: "WEEKLY", timeZone: "America/Sao_Paulo" } } });
    assert.equal(response.status, 201);
    noticeId = (await json<{ id: string }>(response)).id;
    const read = async (token: string, suffix = "") => json<{ items: Array<{ id: string; nextOccurrenceAt: string }> }>(await call(server.url, `/notices?buildingId=${buildingId}${suffix}`, { token }));
    assert.ok(!(await read(resident.accessToken)).items.some(n => n.id === noticeId));
    assert.ok((await read(admin.accessToken, "&includeUnpublished=true")).items.some(n => n.id === noticeId && n.nextOccurrenceAt === future));
    assert.equal((await call(server.url, `/notices?buildingId=${buildingId}&includeUnpublished=true`, { token: resident.accessToken })).status, 403);
    const direct = await withUserContext({ userId: "resident_demo", role: "RESIDENT" }, tx => tx.execute(sql`select id from notices where id = ${noticeId}`));
    assert.equal(direct.length, 0, "RLS also hides unpublished announcements");
    const edit = await call(server.url, `/notices/${noticeId}`, { method: "PATCH", token: admin.accessToken, body: { title: "Limpeza do hall", publishedAt: new Date(Date.now() - 1000).toISOString() } });
    assert.equal(edit.status, 200);
    assert.ok((await read(resident.accessToken)).items.some(n => n.id === noticeId));
  });
});
