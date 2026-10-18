import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

// Hermes (React Native) does not parse PostgreSQL's text timestamps: the apps showed
// "Data indisponível" for sensor readings and the gateway's last contact (found on
// the emulator on 18/10). Every timestamp they read must be ISO-8601 UTC.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("timestamps read by the native apps are ISO-8601", () => {
  const suffix = randomUUID().slice(0, 8), org = `iso-${suffix}-org`, building = `iso-${suffix}-a`;
  const gateway = `iso-${suffix}-gw`, device = `iso-${suffix}-dev`, manager = `iso-${suffix}-manager`;
  let server: TestServer, token: string;
  const get = async (path: string) => {
    const response = await call(server.url, path, { token });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };

  before(async () => {
    await sqlClient`insert into organizations(id,name,slug) values(${org},'ISO',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'A','A')`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'GW',${gateway},'ONLINE',clock_timestamp())`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,status) values(${device},${building},${gateway},'Caixa','WATER_LEVEL_SENSOR','ONLINE')`;
    await sqlClient`insert into users(id,email,name,password_hash) values(${manager},${`${manager}@iso.test`},${manager},${await hashPassword("predioon123")})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${manager},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value,unit)
      values(clock_timestamp()-interval '1 minute',${randomUUID()},${building},${device},'water_level_percent','70',70,'%')`;
    await sqlClient`insert into alerts(building_id,device_id,severity,type,status,message) values(${building},${device},'HIGH','LOW_WATER_LEVEL','OPEN','Nível baixo')`;
    server = await startTestServer();
    token = (await login(server.url, `${manager}@iso.test`)).accessToken;
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from telemetry where building_id=${building}`;
    await sqlClient`delete from audit_logs where building_id=${building}`;
    await sqlClient`delete from role_bindings where user_id=${manager}`;
    await sqlClient`delete from buildings where id=${building}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id=${manager}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("latest readings and series buckets", async () => {
    const latest = (await get(`/telemetry/latest?buildingId=${building}`)).items as Array<{ time: string }>;
    assert.ok(latest.length > 0);
    for (const row of latest) assert.match(row.time, ISO);
    const series = (await get(`/telemetry/series?deviceId=${device}&metric=water_level_percent&bucket=5m`)).items as Array<{ bucket: string }>;
    assert.ok(series.length > 0);
    for (const row of series) assert.match(row.bucket, ISO);
  });

  it("gateway last contact and recent alerts on the building overview", async () => {
    const overview = await get(`/overview/building?buildingId=${building}`);
    const text = JSON.stringify(overview);
    const stamps = [...text.matchAll(/"(?:last_seen_at|triggered_at|lastSeenAt|triggeredAt)":"([^"]+)"/g)].map(match => match[1]!);
    assert.ok(stamps.length >= 2, text);
    for (const stamp of stamps) assert.match(stamp, ISO);
  });
});
