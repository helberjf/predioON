import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import postgres from "postgres";
import { baseline } from "../src/baseline-schema.js";
import { applyInfrastructure, loadInfrastructureMigrations } from "../src/infrastructure-migrations.js";

// Creates and drops its own databases; the URL must point to a disposable cluster.
const adminUrl = process.env.TEST_MIGRATIONS_DATABASE_URL;
const PHYSICAL = ["CAR_PARKING", "GARAGE_ACCESS", "MOTORCYCLE_PARKING", "PEDESTRIAN_ACCESS"];

describe("gate opening and parking are off by default (SQL049, SQL050)", { skip: !adminUrl, concurrency: false }, () => {
  let admin: postgres.Sql;
  const names: string[] = [], clients: postgres.Sql[] = [];
  const upTo = (limit: number) => async (owner: postgres.Sql) =>
    applyInfrastructure(owner, (await loadInfrastructureMigrations()).filter(row => Number.parseInt(row.id, 10) <= limit));
  async function database(): Promise<postgres.Sql> {
    const name = `physical_${randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`create database "${name}"`);
    names.push(name);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    const owner = postgres(url.toString(), { max: 1, onnotice: () => {} });
    clients.push(owner);
    await owner.unsafe(baseline);
    return owner;
  }
  const settings = async (owner: postgres.Sql) => (await owner`select feature_key, enabled from global_feature_settings order by 1`).map(row => `${row.feature_key}=${row.enabled}`);
  /** An installation in use: two condominiums with gates, a pending command and counted parking. */
  async function inUse(owner: postgres.Sql) {
    await owner`insert into organizations(id,name,slug) values('org','Fixture','org')`;
    await owner`insert into users(id,email,name) values('resident','resident@example.invalid','Resident')`;
    for (const id of ["a", "b"]) {
      await owner`insert into buildings(id,organization_id,name,code) values(${id},'org',${id},${id})`;
      await owner`insert into gateways(id,building_id,name,serial_number) values(${`gw-${id}`},${id},'Gateway',${`gw-${id}`})`;
      for (const kind of ["GARAGE", "PEDESTRIAN"]) {
        const device = `${kind}-${id}`;
        await owner`insert into devices(id,building_id,gateway_id,name,type) values(${device},${id},${`gw-${id}`},${device},'GATE_CONTROLLER')`;
        const [gate] = await owner`insert into gates(building_id,name,kind,gateway_id,device_id,enabled) values(${id},${kind},${kind},${`gw-${id}`},${device},true) returning id`;
        for (const status of ["PENDING", "SENT"]) await owner`insert into gate_commands(request_id,gate_id,building_id,gateway_id,device_id,requested_by,status,expires_at)
          values(${randomUUID()},${gate!.id},${id},${`gw-${id}`},${device},'resident',${status},now()+interval '10 seconds')`;
      }
      for (const vehicle of ["CAR", "MOTORCYCLE"]) await owner`insert into parking_lots(building_id,vehicle_type,capacity,occupied,source,observed_at) values(${id},${vehicle},10,4,'MANUAL',now())`;
    }
  }

  before(async () => { admin = postgres(adminUrl!, { max: 1, onnotice: () => {} }); });
  after(async () => {
    for (const client of clients) await client.end({ timeout: 0 });
    for (const name of names) await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin?.end();
  });

  it("starts a new installation with the four features off and every other one untouched", async () => {
    const owner = await database();
    await upTo(999)(owner);
    assert.deepEqual(await settings(owner), PHYSICAL.map(key => `${key}=false`));
    assert.equal((await owner`select count(*)::int as total from audit_logs`)[0]!.total, 0, "nothing was in use, so there is nothing to audit");
    assert.equal((await owner`select count(*)::int as total from feature_runtime`)[0]!.total, 0);
  });

  it("switches an installation in use off with the effects of the audited transition", async () => {
    const owner = await database();
    await upTo(48)(owner);
    await inUse(owner);
    // Condominium b had already paused its garage: that local choice is not a transition now.
    await owner`insert into building_feature_settings(building_id,feature_key,enabled) values('b','GARAGE_ACCESS',false)`;
    await owner`insert into feature_runtime(building_id,feature_key,resumed_at,generation) values('a','CAR_PARKING',now(),3)`;
    await upTo(999)(owner);

    assert.deepEqual(await settings(owner), PHYSICAL.map(key => `${key}=false`));
    const commands = await owner`select c.building_id, g.kind, c.status, c.failure_reason from gate_commands c join gates g on g.id=c.gate_id order by 1,2,3`;
    assert.deepEqual(commands.map(row => `${row.building_id}/${row.kind}/${row.status}/${row.failure_reason ?? "-"}`), [
      "a/GARAGE/FAILED/Funcionalidade desativada", "a/GARAGE/SENT/-", "a/PEDESTRIAN/FAILED/Funcionalidade desativada", "a/PEDESTRIAN/SENT/-",
      "b/GARAGE/PENDING/-", "b/GARAGE/SENT/-", "b/PEDESTRIAN/FAILED/Funcionalidade desativada", "b/PEDESTRIAN/SENT/-",
    ], "only pending commands of a feature that was on are cancelled; a command already sent is never rewritten");
    const lots = await owner`select occupied, observed_at, source, version from parking_lots`;
    assert.equal(lots.length, 4);
    assert.ok(lots.every(lot => lot.occupied === null && lot.observed_at === null && lot.source === "UNKNOWN" && lot.version === 2), "a count taken before the pause is not shown as current");
    const runtime = await owner`select building_id, feature_key, generation, paused_at is not null as paused from feature_runtime order by 1,2`;
    assert.deepEqual(runtime.map(row => `${row.building_id}/${row.feature_key}/${row.generation}/${row.paused}`), [
      "a/CAR_PARKING/4/true", "a/GARAGE_ACCESS/1/true", "a/MOTORCYCLE_PARKING/1/true", "a/PEDESTRIAN_ACCESS/1/true",
      "b/CAR_PARKING/1/true", "b/MOTORCYCLE_PARKING/1/true", "b/PEDESTRIAN_ACCESS/1/true",
    ]);
    const audit = await owner`select action, building_id, actor_type, user_id, resource_id, metadata from audit_logs order by action, resource_id, building_id`;
    assert.deepEqual(audit.filter(row => row.action === "ACCESS_COMMAND_CANCELLED_BY_FEATURE").map(row => `${row.building_id}/${row.metadata.feature}`).sort(), ["a/GARAGE_ACCESS", "a/PEDESTRIAN_ACCESS", "b/PEDESTRIAN_ACCESS"]);
    assert.deepEqual(audit.filter(row => row.action === "FEATURE_CONFIGURATION_CHANGED").map(row => `${row.resource_id}/${row.metadata.affectedBuildings}/${row.metadata.before}>${row.metadata.after}`),
      ["CAR_PARKING/2/true>false", "GARAGE_ACCESS/1/true>false", "MOTORCYCLE_PARKING/2/true>false", "PEDESTRIAN_ACCESS/2/true>false"]);
    assert.ok(audit.every(row => row.actor_type === "SYSTEM" && row.user_id === null), "no person is named as the author of a migration");
    assert.equal((await owner`select count(*)::int as total from gates where enabled`)[0]!.total, 4, "configuration is kept for when the feature is turned on again");

    assert.deepEqual(await applyInfrastructure(owner, await loadInfrastructureMigrations()), [], "nothing is applied twice");
  });

  it("leaves a platform setting that someone recorded exactly as it is", async () => {
    const owner = await database();
    await upTo(48)(owner);
    await inUse(owner);
    await owner`insert into global_feature_settings(feature_key,enabled,version) values('GARAGE_ACCESS',true,4),('CAR_PARKING',false,2)`;
    await upTo(999)(owner);
    assert.deepEqual(await settings(owner), ["CAR_PARKING=false", "GARAGE_ACCESS=true", "MOTORCYCLE_PARKING=false", "PEDESTRIAN_ACCESS=false"]);
    assert.deepEqual((await owner`select feature_key, version from global_feature_settings where feature_key in ('GARAGE_ACCESS','CAR_PARKING') order by 1`).map(row => `${row.feature_key}/${row.version}`), ["CAR_PARKING/2", "GARAGE_ACCESS/4"]);
    const garage = await owner`select c.status from gate_commands c join gates g on g.id=c.gate_id where g.kind='GARAGE' and c.status='PENDING'`;
    assert.equal(garage.length, 2, "a feature kept on keeps its pending commands");
    assert.equal((await owner`select count(*)::int as total from parking_lots where vehicle_type='CAR' and occupied=4`)[0]!.total, 2, "an explicit setting is not re-applied, even when it is off");
    assert.equal((await owner`select count(*)::int as total from parking_lots where vehicle_type='MOTORCYCLE' and occupied is null`)[0]!.total, 2);
  });
});
