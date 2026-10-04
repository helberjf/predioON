import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { telemetryTopic } from "@predioon/shared";
import { baseline } from "../../../packages/db/src/baseline-schema.js";
import { applyInfrastructure, loadInfrastructureMigrations } from "../../../packages/db/src/infrastructure-migrations.js";
import type { sqlClient } from "@predioon/db";

type Sql = typeof sqlClient;
const postgres = createRequire(new URL("../../../packages/db/package.json", import.meta.url))("postgres") as (url: string, options: object) => Sql;
const adminUrl = process.env.TEST_NOTIFICATION_PRODUCERS_DATABASE_URL;

describe("SQL038 source producers are atomic, durable and transport-free", { skip: !adminUrl, concurrency: false }, () => {
  const name = `notification_producers_${randomUUID().replaceAll("-", "")}`;
  let admin: Sql, owner: Sql, databaseUrl: string;
  let database: typeof import("@predioon/db");
  let pipeline: typeof import("../src/pipeline/telemetry.js");
  let offline: typeof import("../src/offline-sweeper.js");
  let configuration: typeof import("../src/config.js");
  let building: string, device: string, gateway: string;
  let fetchCalls = 0;
  async function packet(metric = "water_level_percent", value: number | boolean | string = 1, time = new Date(), event = randomUUID()) {
    return Buffer.from(JSON.stringify({ schemaVersion: 1, eventId: event, buildingId: building, deviceId: device, metric, value, quality: "GOOD", timestamp: time.toISOString() }));
  }
  async function ingest(raw: Buffer) { await pipeline.handleTelemetry(telemetryTopic(building, device), raw); }
  async function rule(severity = "HIGH", metric = "water_level_percent") {
    await owner`insert into alert_rules(building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template)
      values(${building},${device},${randomUUID()},${metric},'LT',20,${severity}::alert_severity,'FIXTURE_RULE','Reading {value}')`;
  }
  async function counts() {
    return (await owner`select
      (select count(*)::int from ingest_events where building_id=${building}) as dedup,
      (select count(*)::int from telemetry where building_id=${building}) as readings,
      (select count(*)::int from alerts where building_id=${building}) as alerts,
      (select count(*)::int from outbox_events where building_id=${building}) as events,
      (select count(*)::int from event_deliveries d join outbox_events e on e.id=d.event_id where e.building_id=${building}) as deliveries`)[0]!;
  }
  async function trigger(table: string, operation: "insert" | "update", body: string, test: () => Promise<void>, timing: "before" | "after" = "before") {
    assert.ok(["alerts", "outbox_events", "devices", "gateways", "telemetry", "ingest_events", "daily_usage", "usage_cursors"].includes(table));
    await owner.unsafe(`create function notification_producer_fault() returns trigger language plpgsql as $$ begin ${body} end $$`);
    await owner.unsafe(`create trigger zz_notification_fault ${timing} ${operation} on ${table} for each row execute function notification_producer_fault()`);
    try { await test(); } finally {
      await owner.unsafe(`drop trigger zz_notification_fault on ${table}`);
      await owner`drop function notification_producer_fault()`;
    }
  }
  async function usageProfile() {
    await owner`update devices set type='ENERGY_METER' where id=${device}`;
    const profile = randomUUID();
    await owner`insert into monitoring_profiles(id,building_id,device_id,kind,daily_limit,adaptive_enabled,max_gap_seconds)
      values(${profile},${building},${device},'ENERGY',1,false,3600)`;
    await ingest(await packet("energy_total_kwh", 100, new Date(Date.now() - 1000)));
    return profile;
  }
  const beforeCommitFailure = (error: unknown): boolean => error instanceof Error
    && (error.message === "fixture crash before commit" || beforeCommitFailure(error.cause));
  function failRealtime() {
    const original = database.db.transaction.bind(database.db);
    mock.method(database.db, "transaction", ((callback: any) => original(async tx => {
      const execute = tx.execute.bind(tx);
      mock.method(tx, "execute", ((query: any) => {
        if (new PgDialect().sqlToQuery(query).sql.includes("pg_notify")) throw new Error("fixture realtime outage");
        return execute(query);
      }) as any);
      return callback(tx);
    })) as any);
  }
  before(async () => {
    assert.equal(process.env.TEST_NOTIFICATION_DISPOSABLE_DB, "1", "Use an explicitly disposable, isolated PostgreSQL cluster");
    assert.match(new URL(adminUrl!).hostname, /^(localhost|127\.0\.0\.1)$/);
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`; databaseUrl = url.toString();
    owner = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    await owner.unsafe(baseline); await applyInfrastructure(owner, await loadInfrastructureMigrations());
    process.env.DATABASE_URL = databaseUrl;
    database = await import("@predioon/db");
    pipeline = await import("../src/pipeline/telemetry.js");
    offline = await import("../src/offline-sweeper.js");
    configuration = await import("../src/config.js");
    configuration.config.ALERT_WEBHOOK_URL = "https://must-not-call.example.invalid";
  });
  beforeEach(async () => {
    // Sweeper is intentionally global. Keep previous test fixtures inactive so
    // each observation covers precisely the current source, on this UUID DB.
    await owner`update gateways set enabled=false`; await owner`update devices set enabled=false`;
    const suffix = randomUUID(); building = `npb_${suffix.slice(0, 8)}`; device = `npd_${suffix.slice(0, 8)}`; gateway = `npg_${suffix.slice(0, 8)}`;
    await owner`insert into organizations(id,name,slug) values(${suffix},'Fixture',${suffix})`;
    await owner`insert into buildings(id,organization_id,name,code) values(${building},${suffix},'Fixture',${suffix})`;
    await owner`insert into gateways(id,building_id,name,serial_number,status,last_seen_at) values(${gateway},${building},'Gateway',${suffix},'ONLINE',clock_timestamp())`;
    await owner`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at) values(${device},${building},${gateway},'Sensor','WATER_LEVEL_SENSOR','ONLINE',clock_timestamp())`;
    fetchCalls = 0;
    mock.method(globalThis, "fetch", async () => { fetchCalls++; return new Response(null, { status: 204 }); });
    mock.method(console, "error", () => {});
  });
  afterEach(() => { mock.restoreAll(); });
  after(async () => {
    if (database) await database.sqlClient.end({ timeout: 0 });
    if (owner) await owner.end({ timeout: 0 });
    if (admin) { await admin.unsafe(`drop database if exists "${name}" with (force)`); await admin.end(); }
  });

  it("persists rules, raw source and outbox once despite MQTT replay, without producer HTTP", async () => {
    await rule(); const raw = await packet(); await ingest(raw); await ingest(raw);
    assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 1, events: 1, deliveries: 1 });
    const [source] = await owner`select a.id,a.triggered_at,a.message,a.triggered_value,e.alert_id from alerts a join outbox_events e on e.alert_id=a.id where a.building_id=${building}`;
    assert.match(source!.id, /^[a-f0-9-]{36}$/); assert.equal(source!.alert_id, source!.id);
    assert.equal(new Date(source!.triggered_at).toISOString(), JSON.parse(raw.toString()).timestamp);
    assert.equal(source!.message, "Reading 1"); assert.equal(source!.triggered_value, 1);
    assert.equal(fetchCalls, 0);
  });
  it("records low severity domain events without a webhook delivery", async () => {
    await rule("LOW"); await ingest(await packet());
    assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 1, events: 1, deliveries: 0 });
    assert.equal(fetchCalls, 0);
  });
  it("enqueues usage limits in the source transaction", async () => {
    await usageProfile(); await ingest(await packet("energy_total_kwh", 110));
    assert.deepEqual(await counts(), { dedup: 2, readings: 2, alerts: 1, events: 1, deliveries: 1 });
    assert.equal(fetchCalls, 0);
  });
  it("rolls back raw, dedup, usage and alerts when outbox insertion fails before commit", async () => {
    await usageProfile();
    await trigger("outbox_events", "insert", "raise exception 'fixture crash before commit';", async () => {
      await assert.rejects(ingest(await packet("energy_total_kwh", 110)), beforeCommitFailure);
      assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 0, events: 0, deliveries: 0 });
      assert.equal((await owner`select last_value from usage_cursors where building_id=${building}`)[0]!.last_value, 100);
    });
  });
  it("keeps committed pending delivery after realtime fails and replay cannot duplicate it", async () => {
    await rule(); failRealtime(); const raw = await packet(); await ingest(raw); await ingest(raw);
    assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 1, events: 1, deliveries: 1 });
    assert.equal((await owner`select d.status from event_deliveries d join outbox_events e on e.id=d.event_id where e.building_id=${building}`)[0]!.status, "pending");
    assert.equal(fetchCalls, 0);
  });
  it("commits gateway OFFLINE, source alert and outbox before SSE, exactly once", async () => {
    await owner`update gateways set last_seen_at=clock_timestamp()-interval '1 hour' where id=${gateway}`;
    failRealtime(); await offline.sweepOffline(); await offline.sweepOffline();
    assert.equal((await owner`select status from gateways where id=${gateway}`)[0]!.status, "OFFLINE");
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 1, events: 1, deliveries: 1 });
    assert.equal(fetchCalls, 0);
  });
  it("rolls back gateway OFFLINE if its source alert/outbox cannot be persisted", async () => {
    await owner`update gateways set last_seen_at=clock_timestamp()-interval '1 hour' where id=${gateway}`;
    await trigger("outbox_events", "insert", "raise exception 'fixture crash before commit';", async () => {
      await assert.rejects(offline.sweepOffline(), beforeCommitFailure);
      assert.equal((await owner`select status from gateways where id=${gateway}`)[0]!.status, "ONLINE");
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    });
  });
  for (const table of ["devices", "gateways"] as const) it(`does not ACK telemetry after a ${table} heartbeat trigger silently skips ONLINE`, async () => {
    await rule();
    await trigger(table, "update", "return null;", async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    });
  });
  for (const table of ["ingest_events", "telemetry"] as const) it(`does not ACK a ${table} source insertion silently skipped by a trigger`, async () => {
    await rule();
    await trigger(table, "insert", "return null;", async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    });
  });
  for (const table of ["daily_usage", "usage_cursors"] as const) it(`rolls back accepted source when ${table} silently skips the usage change`, async () => {
    await usageProfile();
    await trigger(table, "insert", "return null;", async () => {
      await assert.rejects(ingest(await packet("energy_total_kwh", 110)), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 0, events: 0, deliveries: 0 });
    });
  });
  for (const phase of ["before", "after"] as const) it(`survives an actual process kill ${phase} the source transaction commit`, async () => {
    await rule(); const raw = await packet(); const marker = `notification_fixture_${phase}`;
    const code = `
      const {db,sqlClient}=await import('@predioon/db');
      const {sql}=await import('drizzle-orm');
      const {handleTelemetry}=await import('./src/pipeline/telemetry.ts');
      const original=db.transaction.bind(db); let first=true;
      db.transaction=async callback=>{
        if(!first) return original(callback); first=false; let pid;
        const result=await original(async tx=>{
          pid=(await tx.execute(sql\`select pg_backend_pid() as pid\`))[0].pid;
          const result=await callback(tx);
          if('${phase}'==='before'){console.log('${marker}:'+pid);await new Promise(()=>{});}
          return result;
        });
        if('${phase}'==='after'){console.log('${marker}:'+pid);await new Promise(()=>{});}
        return result;
      };
      await handleTelemetry(${JSON.stringify(telemetryTopic(building, device))},Buffer.from(${JSON.stringify(raw.toString("base64"))},'base64'));
      await sqlClient.end();`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const exited = once(child, "exit"); let output = "";
    try {
      const pid = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Crash fixture did not reach its transaction boundary")), 10_000);
        child.stdout.on("data", chunk => {
          output += String(chunk); const match = output.match(new RegExp(`${marker}:(\\d+)`));
          if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
        });
        child.on("exit", () => { clearTimeout(timeout); reject(new Error("Crash fixture exited before transaction marker")); });
      });
      assert.equal(child.kill("SIGKILL"), true); await exited;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && (await owner`select count(*)::int as count from pg_stat_activity where pid=${pid}`)[0]!.count) await delay(20);
      assert.equal((await owner`select count(*)::int as count from pg_stat_activity where pid=${pid}`)[0]!.count, 0);
      assert.deepEqual(await counts(), phase === "before" ? { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 }
        : { dedup: 1, readings: 1, alerts: 1, events: 1, deliveries: 1 });
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
  });
  it("serializes rule cooldown for concurrent accepted readings", async () => {
    await rule(); await Promise.all([ingest(await packet()), ingest(await packet())]);
    assert.deepEqual(await counts(), { dedup: 2, readings: 2, alerts: 1, events: 1, deliveries: 1 });
  });
  it("commits device OFFLINE plus exactly one communication alert/outbox under concurrent sweeps", async () => {
    await owner`update devices set last_seen_at=clock_timestamp()-interval '1 hour' where id=${device}`;
    await Promise.all([offline.sweepOffline(), offline.sweepOffline()]); await offline.sweepOffline();
    assert.equal((await owner`select status from devices where id=${device}`)[0]!.status, "OFFLINE");
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 1, events: 1, deliveries: 1 });
  });
  it("preserves paused device communication status without inventing module alerts", async () => {
    await owner`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'WATER_TANK',false)`;
    await owner`update devices set last_seen_at=clock_timestamp()-interval '1 hour' where id=${device}`;
    await offline.sweepOffline();
    assert.equal((await owner`select status from devices where id=${device}`)[0]!.status, "OFFLINE");
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
  });
  it("captures only the eligible ANY communication alternative at the producer boundary", async () => {
    await owner`update devices set type='ENERGY_METER',last_seen_at=clock_timestamp()-interval '1 hour' where id=${device}`;
    await owner`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'ENERGY_CONSUMPTION',false)`;
    await offline.raiseCommunicationAlert({ buildingId: building, deviceId: device, message: "Meter offline" });
    assert.equal((await counts()).deliveries, 1);
    const witnesses = await owner`select feature_key,generation from delivery_witness_features f join event_deliveries d on d.id=f.delivery_id join outbox_events e on e.id=d.event_id where e.building_id=${building}`;
    assert.deepEqual(witnesses.map(row => ({ ...row })), [{ feature_key: "ELECTRICAL", generation: 0 }]);
    assert.equal(fetchCalls, 0);
  });
  it("does not sweep fresh, disabled or never-seen sources", async () => {
    await offline.sweepOffline();
    await owner`update gateways set enabled=false,last_seen_at=clock_timestamp()-interval '1 hour' where id=${gateway}`;
    await owner`update devices set last_seen_at=null where id=${device}`;
    await offline.sweepOffline();
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    assert.equal((await owner`select status from devices where id=${device}`)[0]!.status, "ONLINE");
  });
  for (const table of ["devices", "gateways"] as const) {
    it(`rechecks ${table} heartbeat after waiting for the source row`, async () => {
      const target = table === "devices" ? device : gateway;
      await owner.unsafe(`update ${table} set last_seen_at=clock_timestamp()-interval '1 hour' where id=$1`, [target]);
      const locker = postgres(databaseUrl, { max: 1, onnotice: () => {} }); let sweeping: Promise<void> | undefined;
      try {
        await locker.begin(async tx => {
          await tx.unsafe(`select id from ${table} where id=$1 for update`, [target]);
          sweeping = offline.sweepOffline();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            if ((await owner`select count(*)::int as count from pg_stat_activity where datname=${name} and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count) break;
            await delay(20);
          }
          assert.ok((await owner`select count(*)::int as count from pg_stat_activity where datname=${name} and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count > 0);
          await tx.unsafe(`update ${table} set last_seen_at=clock_timestamp() where id=$1`, [target]);
        });
        await sweeping;
        assert.equal((await owner.unsafe(`select status from ${table} where id=$1`, [target]))[0]!.status, "ONLINE");
        assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
      } finally { await locker.end({ timeout: 0 }); }
    });
    it(`uses DB clock after the ${table} lock wait when source crosses the stale cutoff`, async () => {
      const target = table === "devices" ? device : gateway;
      const key = table === "devices" ? "DEVICE_OFFLINE_TIMEOUT_SECONDS" : "GATEWAY_OFFLINE_TIMEOUT_SECONDS";
      const previous = configuration.config[key]; configuration.config[key] = 1;
      const locker = postgres(databaseUrl, { max: 1, onnotice: () => {} }); let sweeping: Promise<void> | undefined;
      try {
        await owner.unsafe(`update ${table} set last_seen_at=clock_timestamp()-interval '1 hour' where id=$1`, [target]);
        await locker.begin(async tx => {
          await tx.unsafe(`update ${table} set last_seen_at=clock_timestamp()-interval '500 milliseconds' where id=$1`, [target]);
          sweeping = offline.sweepOffline();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline && !(await owner`select count(*)::int as count from pg_stat_activity where datname=${name} and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count) await delay(20);
          assert.ok((await owner`select count(*)::int as count from pg_stat_activity where datname=${name} and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count > 0);
          await delay(750);
        });
        await sweeping;
        assert.equal((await owner.unsafe(`select status from ${table} where id=$1`, [target]))[0]!.status, "OFFLINE");
        assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 1, events: 1, deliveries: 1 });
      } finally { configuration.config[key] = previous; await locker.end({ timeout: 0 }); }
    });
    it(`rolls back ${table} OFFLINE when its UPDATE is silently skipped`, async () => {
      const target = table === "devices" ? device : gateway;
      await owner.unsafe(`update ${table} set last_seen_at=clock_timestamp()-interval '1 hour' where id=$1`, [target]);
      await trigger(table, "update", "return null;", async () => {
        await assert.rejects(offline.sweepOffline(), /not persisted/i);
        assert.equal((await owner.unsafe(`select status from ${table} where id=$1`, [target]))[0]!.status, "ONLINE");
        assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
      });
    });
  }
  for (const timing of ["before", "after"] as const) it(`rolls back a ${timing.toUpperCase()} trigger that rewrites the source alert message`, async () => {
    await rule();
    const body = timing === "before" ? "new.message:='rewritten'; return new;" : "update alerts set message='rewritten' where id=new.id; return new;";
    await trigger("alerts", "insert", body, async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    }, timing);
  });
  it("does not acknowledge an alert insertion silently skipped by a trigger", async () => {
    await rule();
    await trigger("alerts", "insert", "return null;", async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    });
  });
  it("rolls back communication after an AFTER alert trigger reverts the confirmed OFFLINE status", async () => {
    await owner`update gateways set last_seen_at=clock_timestamp()-interval '1 hour' where id=${gateway}`;
    await trigger("alerts", "insert", "update gateways set status='ONLINE' where id=new.gateway_id; return new;", async () => {
      await assert.rejects(offline.sweepOffline(), /not persisted/i);
      assert.equal((await owner`select status from gateways where id=${gateway}`)[0]!.status, "ONLINE");
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    }, "after");
  });
  for (const table of ["ingest_events", "telemetry"] as const) it(`rejects an AFTER alert trigger deleting previously confirmed ${table}`, async () => {
    await rule();
    await trigger("alerts", "insert", `delete from ${table} where building_id=new.building_id; return new;`, async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    }, "after");
  });
  for (const table of ["daily_usage", "usage_cursors"] as const) it(`rejects an AFTER alert trigger rewriting previously confirmed ${table}`, async () => {
    const profile = await usageProfile();
    const mutation = table === "daily_usage" ? "quantity=0" : "last_value=0";
    await trigger("alerts", "insert", `update ${table} set ${mutation} where building_id=new.building_id; return new;`, async () => {
      await assert.rejects(ingest(await packet("energy_total_kwh", 110)), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 0, events: 0, deliveries: 0 });
      assert.equal((await owner`select last_value from usage_cursors where profile_id=${profile}`)[0]!.last_value, 100);
      assert.equal((await owner`select quantity from daily_usage where profile_id=${profile}`)[0]!.quantity, 0);
    }, "after");
  });
  it("rejects an AFTER gateway heartbeat trigger rewriting the confirmed device heartbeat", async () => {
    await rule();
    await trigger("gateways", "update", "if pg_trigger_depth()=1 then update devices set status='OFFLINE' where gateway_id=new.id; end if; return new;", async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
      assert.equal((await owner`select status from devices where id=${device}`)[0]!.status, "ONLINE");
    }, "after");
  });
  it("rejects a later alert that rewrites a previously confirmed alert in the same transaction", async () => {
    await rule(); await rule();
    await trigger("alerts", "insert", "update alerts set message='rewritten by later alert' where building_id=new.building_id and id<>new.id; return new;", async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    }, "after");
  });
  for (const value of ["10", "false", "null"] as const) it(`preserves literal JSON string ${JSON.stringify(value)} without coercion when confirming source`, async () => {
    await ingest(await packet("vendor_status", value));
    const [persisted] = await owner`select value,numeric_value from telemetry where building_id=${building}`;
    assert.equal(persisted!.value, value); assert.equal(persisted!.numeric_value, null);
    assert.deepEqual(await counts(), { dedup: 1, readings: 1, alerts: 0, events: 0, deliveries: 0 });
  });
  it("rejects an AFTER gateway heartbeat that invalidates a previously confirmed outbox delivery", async () => {
    await rule();
    await trigger("gateways", "update", "update event_deliveries d set status='failed',failure_category='HTTP_PERMANENT' from outbox_events e where e.id=d.event_id and e.building_id=new.building_id; return new;", async () => {
      await assert.rejects(ingest(await packet()), /not persisted/i);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    }, "after");
  });
});
