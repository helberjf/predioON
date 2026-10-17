import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

// 058: background service health for the platform administration, counts and instants only.
describe("platform service health (058)", () => {
  const suffix = randomUUID().slice(0, 8), org = `svc058-${suffix}-org`, building = `svc058-${suffix}-a`;
  const gateway = `svc058-${suffix}-gw`, device = `svc058-${suffix}-dev`;
  const admin = `svc058-${suffix}-admin`, manager = `svc058-${suffix}-manager`;
  const tokens: Record<string, string> = {};
  let server: TestServer;
  const services = (who: string) => call(server.url, "/overview/platform/services", { token: tokens[who] });

  before(async () => {
    const hash = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Services',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'A','A')`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'GW',${gateway},'ONLINE',clock_timestamp())`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,status) values(${device},${building},${gateway},'Caixa','WATER_LEVEL_SENSOR','ONLINE')`;
    for (const id of [admin, manager]) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${`${id}@svc058.test`},${id},${hash})`;
    await sqlClient`insert into role_bindings(user_id,role_key) values(${admin},'PLATFORM_ADMIN')`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${manager},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into telemetry(time,received_at,event_id,building_id,device_id,metric,value,numeric_value,unit)
      values(clock_timestamp()-interval '1 second',clock_timestamp(),${randomUUID()},${building},${device},'water_level_percent','70',70,'%')`;
    server = await startTestServer();
    for (const id of [admin, manager]) tokens[id] = (await login(server.url, `${id}@svc058.test`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from telemetry where building_id=${building}`;
    await sqlClient`delete from role_bindings where user_id in (${admin},${manager})`;
    await sqlClient`delete from buildings where id=${building}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id in (${admin},${manager})`;
    await closeAppDb(); await sqlClient.end();
  });

  it("gives the platform administrator counts and instants of every background service", async () => {
    const response = await services(admin);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "database", "ingest", "jobs", "notifications", "physicalCommands"]);
    assert.deepEqual(Object.keys(body.ingest).sort(), ["gatewaysEnabled", "gatewaysOnline", "lastReadingAt", "lastReceivedAt", "readingsLastHour"]);
    assert.ok(Date.parse(body.checkedAt) - Date.parse(body.ingest.lastReceivedAt) < 60_000, "the fixture reading is the latest one");
    assert.ok(body.ingest.readingsLastHour >= 1 && body.ingest.gatewaysOnline >= 1);
    for (const key of ["waiting", "deliveredLastDay", "failedLastDay"]) assert.equal(typeof body.notifications[key], "number");
    for (const key of ["waiting", "acknowledgedLastDay", "failedLastDay"]) assert.equal(typeof body.physicalCommands[key], "number");
    const automations = body.jobs.find((job: { name: string }) => job.name === "automations");
    assert.deepEqual({ scheduled: automations.scheduled, intervalSeconds: automations.intervalSeconds }, { scheduled: true, intervalSeconds: 300 });
    assert.ok(body.database.bytes > body.database.telemetryBytes && body.database.telemetryBytes > 0);
    // Nothing identifying: no condominium, device, reading value or destination appears.
    const text = JSON.stringify(body);
    for (const secret of [building, device, gateway, "70", "water_level_percent"]) assert.ok(!text.includes(`"${secret}"`), secret);
  });

  it("is refused to a building manager and, in PostgreSQL, to anyone without the capability", async () => {
    assert.equal((await services(manager)).status, 403);
    await sqlClient`update role_bindings set active=false where user_id=${admin}`;
    try { assert.equal((await services(admin)).status, 403, "losing the role removes access on the same session"); }
    finally { await sqlClient`update role_bindings set active=true where user_id=${admin}`; }
    await assert.rejects(sqlClient.begin(async tx => {
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id', ${manager}, true)`;
      await tx`select app_platform_service_health()`;
    }), { code: "42501" });
    for (const role of ["predioon_ingest", "predioon_notifications", "predioon_identity"]) {
      await assert.rejects(sqlClient.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select app_platform_service_health()`;
      }), { code: "42501" }, role);
    }
  });
});
