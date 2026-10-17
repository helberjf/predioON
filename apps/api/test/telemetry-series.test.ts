import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

/** Drizzle wraps the driver error; postgres.js raises it directly. */
const denied = (error: unknown) => {
  const value = error as { code?: string; cause?: { code?: string } };
  return (value.code ?? value.cause?.code) === "42501";
};

// 056: the latest-readings query walks a catalog of series instead of sorting a week of samples.
describe("telemetry series catalog (056)", () => {
  const suffix = randomUUID().slice(0, 8), org = `ts056-${suffix}-org`, building = `ts056-${suffix}-a`, other = `ts056-${suffix}-b`;
  const tank = `ts056-${suffix}-tank`, silent = `ts056-${suffix}-silent`, foreign = `ts056-${suffix}-foreign`;
  const manager = `ts056-${suffix}-manager`, scoped = `ts056-${suffix}-scoped`;
  let server: TestServer;
  const reading = (device: string, buildingId: string, metric: string, value: number, age: string, id = randomUUID()) =>
    sqlClient`insert into telemetry(id,time,event_id,building_id,device_id,metric,value,numeric_value,unit)
      values(${id},now()-${age}::interval,${randomUUID()},${buildingId},${device},${metric},${String(value)},${value},'%')`;

  before(async () => {
    const hash = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Series 056',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'A','A'),(${other},${org},'B','B')`;
    await sqlClient`insert into devices(id,building_id,name,type) values(${tank},${building},'Caixa','WATER_LEVEL_SENSOR'),
      (${silent},${building},'Parado','WATER_LEVEL_SENSOR'),(${foreign},${other},'Vizinho','WATER_LEVEL_SENSOR')`;
    for (const user of [manager, scoped]) await sqlClient`insert into users(id,email,name,password_hash) values(${user},${`${user}@series056.test`},${user},${hash})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${manager},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${scoped},${building},'MAINTENANCE','device',${silent})`;
    // Newer first, then older: arrival order must not decide which one is latest.
    await reading(tank, building, "water_level_percent", 61, "1 minute");
    await reading(tank, building, "water_level_percent", 60, "5 minutes");
    await reading(tank, building, "water_level_percent", 59, "6 minutes");
    await reading(tank, building, "temperature_c", 24, "3 minutes");
    await reading(silent, building, "water_level_percent", 10, "8 days");
    await reading(foreign, other, "water_level_percent", 80, "1 minute");
    server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from telemetry where building_id in (${building},${other})`;
    await sqlClient`delete from role_bindings where user_id in (${manager},${scoped})`;
    await sqlClient`delete from buildings where organization_id=${org}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id in (${manager},${scoped})`;
    await closeAppDb(); await sqlClient.end();
  });

  it("records each series once, whatever the number of readings", async () => {
    const rows = await sqlClient`select device_id, metric from telemetry_series where building_id in (${building},${other}) order by 1,2`;
    assert.deepEqual(rows.map(row => `${row.device_id}:${row.metric}`), [
      `${foreign}:water_level_percent`, `${silent}:water_level_percent`, `${tank}:temperature_c`, `${tank}:water_level_percent`]);
  });

  it("returns exactly what DISTINCT ON over the last seven days returned", async () => {
    const token = (await login(server.url, `${manager}@series056.test`)).accessToken;
    const response = await call(server.url, `/telemetry/latest?buildingId=${building}`, { token });
    assert.equal(response.status, 200, await response.clone().text());
    const items = (await response.json()).items as Array<{ device_id: string; metric: string; numeric_value: number }>;
    const reference = await sqlClient`select distinct on (device_id, metric) device_id, metric, numeric_value from telemetry
      where building_id=${building} and time > now()-interval '7 days' order by device_id, metric, time desc, id desc`;
    const shape = (rows: Iterable<{ device_id: string; metric: string; numeric_value: number }>) =>
      [...rows].map(row => `${row.device_id}:${row.metric}=${row.numeric_value}`).sort();
    assert.deepEqual(shape(items), shape(reference as never));
    assert.deepEqual(shape(items), [`${tank}:temperature_c=24`, `${tank}:water_level_percent=61`], "a series silent for 8 days is not current");
  });

  it("ties on the same instant keep the previous tie-break (highest id)", async () => {
    const low = "00000000-0000-4000-8000-000000000001", high = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    await sqlClient`insert into telemetry(id,time,event_id,building_id,device_id,metric,value,numeric_value,unit) values
      (${low},date_trunc('second',now()),${randomUUID()},${building},${tank},'water_level_percent','70',70,'%'),
      (${high},date_trunc('second',now()),${randomUUID()},${building},${tank},'water_level_percent','71',71,'%')`;
    const token = (await login(server.url, `${manager}@series056.test`)).accessToken;
    const items = (await (await call(server.url, `/telemetry/latest?buildingId=${building}`, { token })).json()).items as Array<{ metric: string; numeric_value: number }>;
    assert.equal(items.find(row => row.metric === "water_level_percent")?.numeric_value, 71);
  });

  it("in PostgreSQL the catalog follows telemetry visibility and only the trigger writes it", async () => {
    const visible = await withUserContext({ userId: scoped, role: "RESIDENT" }, tx =>
      tx.execute(sql`select device_id from telemetry_series where building_id in (${building},${other}) order by 1`));
    assert.deepEqual([...visible].map(row => (row as { device_id: string }).device_id), [silent], "a device-scoped grant sees only its device");
    await assert.rejects(withUserContext({ userId: manager, role: "RESIDENT" }, tx =>
      tx.execute(sql`insert into telemetry_series(building_id,device_id,metric) values(${building},${tank},'forged')`)), denied);
    await assert.rejects(sqlClient.begin(async tx => {
      await tx`set local role predioon_ingest`;
      await tx`select 1 from telemetry_series limit 1`;
    }), { code: "42501" });
    await assert.rejects(sqlClient.begin(async tx => {
      await tx`set local role predioon_app`;
      await tx`select app_private_record_telemetry_series()`;
    }), { code: "42501" });
  });
});
