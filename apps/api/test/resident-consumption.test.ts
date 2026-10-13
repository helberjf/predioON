import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { ROLE_CAPABILITIES } from "@predioon/shared";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("consumption reaches residents only when the administration releases it (SQL051)", () => {
  const suffix = randomUUID(), org = `051-org-${suffix}`, a = `051-a-${suffix}`, b = `051-b-${suffix}`;
  const manager = `051-manager-${suffix}`, resident = `051-resident-${suffix}`, neighbour = `051-neighbour-${suffix}`, worker = `051-worker-${suffix}`;
  const tokens: Record<string, string> = {};
  let server: TestServer, today: string, yesterday: string;

  const get = (path: string, who: string) => call(server.url, path, { token: tokens[who] });
  const release = (released: unknown, who = manager, building = a) => call(server.url, "/monitoring/resident-access", { method: "PUT", token: tokens[who], body: { buildingId: building, released } });
  const published = (who = resident, building = a) => get(`/monitoring/published?buildingId=${building}`, who);

  before(async () => {
    const hash = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Resident consumption',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A',${a}),(${b},${org},'B',${b})`;
    for (const id of [manager, resident, neighbour, worker]) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${`${id}@consumption.test`},${id},${hash})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${manager},${a},'BUILDING_ADMIN'),(${resident},${a},'RESIDENT'),(${worker},${a},'MAINTENANCE'),(${neighbour},${b},'RESIDENT')`;
    [{ today, yesterday }] = await sqlClient`select to_char(now() at time zone b.timezone,'YYYY-MM-DD') as today,
      to_char((now() - interval '1 day') at time zone b.timezone,'YYYY-MM-DD') as yesterday from buildings b where b.id=${a}` as unknown as [{ today: string; yesterday: string }];
    for (const [building, device, kind, type, quantity] of [[a, "energy", "ENERGY", "ENERGY_METER", 120], [a, "energy2", "ENERGY", "ENERGY_METER", 30], [a, "water", "WATER", "WATER_METER", 12],
      [a, "pump", "PUMP", "PUMP_MONITOR", 90], [b, "foreign", "ENERGY", "ENERGY_METER", 999]] as const) {
      const id = `051-${device}-${suffix}`;
      await sqlClient`insert into devices(id,building_id,name,type) values(${id},${building},${`Medidor secreto ${device}`},${type})`;
      const [profile] = await sqlClient`insert into monitoring_profiles(building_id,device_id,kind,tariff,daily_limit) values(${building},${id},${kind},7.77,555) returning id`;
      for (const [day, factor] of [[today, 1], [yesterday, 2]] as const) await sqlClient`insert into daily_usage(profile_id,building_id,day,quantity,estimated_cost,covered_seconds,first_at,last_at)
        values(${profile!.id},${building},${day},${quantity * factor},4321,60,now(),now())`;
    }
    server = await startTestServer();
    for (const id of [manager, resident, neighbour, worker]) tokens[id] = (await login(server.url, `${id}@consumption.test`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id in (${a},${b})`;
    await sqlClient`delete from buildings where id in (${a},${b})`;
    await sqlClient`delete from users where id in (${manager},${resident},${neighbour},${worker})`;
    await sqlClient`delete from organizations where id=${org}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("starts not released: a resident receives no consumption and no water tank level", async () => {
    const refused = await published();
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "O consumo não está liberado para moradores neste condomínio" });
    assert.equal((await get(`/monitoring?buildingId=${a}`, resident)).status, 403, "the private panel stays closed either way");
    assert.equal((await get(`/telemetry/latest?buildingId=${a}`, resident)).status, 403, "the published water level is no longer a resident reading");
    assert.ok(!ROLE_CAPABILITIES.RESIDENT.includes("telemetry:read-published") && ROLE_CAPABILITIES.RESIDENT.includes("monitoring:read-published"));
    assert.deepEqual((await sqlClient`select permission_key from role_permissions where role_key='RESIDENT' and permission_key in ('telemetry:read-published','monitoring:read-published')`).map(row => row.permission_key), ["monitoring:read-published"]);
    assert.deepEqual(await (await get(`/monitoring/resident-access?buildingId=${a}`, manager)).json(), { buildingId: a, released: false });
  });

  it("lets only the condominium's administration decide, and audits the decision", async () => {
    assert.equal((await published(manager)).status, 403, "not released means nobody receives the projection");
    // Granting the resident role requires holding everything in it; inviting residents must keep working.
    assert.equal((await sqlClient`select count(*)::int as total from role_permissions where role_key='BUILDING_ADMIN' and permission_key='monitoring:read-published'`)[0]!.total, 1);
    for (const who of [resident, worker, neighbour]) {
      assert.equal((await release(true, who)).status, 403, who);
      assert.equal((await get(`/monitoring/resident-access?buildingId=${a}`, who)).status, 403, who);
    }
    assert.equal((await release(true, manager, b)).status, 403, "a manager decides for their own condominium only");
    for (const bad of ["true", 1, null]) assert.equal((await release(bad)).status, 400);
    assert.equal((await sqlClient`select count(*)::int as total from resident_consumption_settings where building_id in (${a},${b})`)[0]!.total, 0);

    const released = await release(true);
    assert.equal(released.status, 200);
    assert.deepEqual(await released.json(), { buildingId: a, released: true });
    assert.deepEqual(await (await release(true)).json(), { buildingId: a, released: true }, "repeating the same choice changes nothing");
    const audit = await sqlClient`select user_id, actor_type, resource_id, metadata from audit_logs where building_id=${a} and action='RESIDENT_CONSUMPTION_CHANGED'`;
    assert.deepEqual(audit.map(row => ({ ...row })), [{ user_id: manager, actor_type: "USER", resource_id: a, metadata: { before: false, after: true } }]);
  });

  it("shows a released resident daily quantities of energy and water and nothing else", async () => {
    const response = await published();
    assert.equal(response.status, 200);
    const text = await response.text(), body = JSON.parse(text) as { buildingId: string; day: string; items: Array<{ kind: string; unit: string; today: number | null; history: Array<{ day: string; quantity: number; incomplete: boolean }> }> };
    assert.equal(body.day, today);
    assert.deepEqual(body.items.map(item => [item.kind, item.unit, item.today]), [["ENERGY", "kWh", 150], ["WATER", "m³", 12]], "meters of the same kind are added; the pump is not consumption");
    assert.deepEqual(body.items[0]!.history, [{ day: yesterday, quantity: 300, incomplete: false }, { day: today, quantity: 150, incomplete: false }]);
    for (const secret of ["4321", "7.77", "555", "Medidor secreto", "051-energy", "tariff", "Cost", "cost", "limit", "profile", "device", "PUMP", "999"]) assert.ok(!text.includes(secret), secret);
    assert.deepEqual(Object.keys(body.items[0]!).sort(), ["history", "kind", "today", "unit"]);

    assert.equal((await get(`/monitoring?buildingId=${a}`, resident)).status, 403, "release does not open the private panel");
    assert.equal((await published(neighbour, a)).status, 403, "a resident of another condominium is not released here");
    assert.equal((await published(neighbour, b)).status, 403, "and their own condominium was not released");
    assert.equal((await published(worker)).status, 403, "staff use the private panel, not the residents' projection");
    // The administrator holds the capability in order to grant the resident role, and so sees what residents see.
    assert.deepEqual((await (await published(manager)).json() as typeof body).items.map(item => item.today), [150, 12]);
  });

  it("ends at once when the release is withdrawn or the bond with the condominium ends", async () => {
    await sqlClient`update role_bindings set active=false where user_id=${resident} and building_id=${a}`;
    assert.equal((await published()).status, 403);
    await sqlClient`update role_bindings set active=true where user_id=${resident} and building_id=${a}`;
    assert.equal((await published()).status, 200);

    assert.deepEqual(await (await release(false)).json(), { buildingId: a, released: false });
    assert.equal((await published()).status, 403);
    const audit = await sqlClient`select metadata from audit_logs where building_id=${a} and action='RESIDENT_CONSUMPTION_CHANGED' order by created_at`;
    assert.deepEqual(audit.map(row => row.metadata), [{ before: false, after: true }, { before: true, after: false }]);
  });

  it("keeps the setting and its helpers behind the API's own rules", async () => {
    for (const client of [appSqlClient, identitySqlClient]) await assert.rejects(client`select enabled from resident_consumption_settings`, { code: "42501" });
    await assert.rejects(identitySqlClient`select app_set_resident_consumption(${a},true)`, { code: "42501" });
    // Without an authenticated person in the transaction nobody is an administrator.
    await assert.rejects(appSqlClient`select app_set_resident_consumption(${a},true)`, { code: "42501" });
    assert.deepEqual([...await appSqlClient`select * from app_published_consumption(${a},${yesterday},${today})`], []);
    assert.equal((await appSqlClient`select app_resident_consumption_released(${a}) as released`)[0]!.released, null);
  });
});
