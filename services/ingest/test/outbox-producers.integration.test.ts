import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { gatewayStatusTopic, telemetryTopic } from "@predioon/shared";
import { adminSession, sqlClient as owner } from "./fixtures/observation-admin.js";

describe("SQL038 source producers are atomic, durable and transport-free", { concurrency: false }, () => {
  let database: typeof import("@predioon/db/ingest");
  let pipeline: typeof import("../src/pipeline/telemetry.js");
  let gatewayStatus: typeof import("../src/pipeline/gateway-status.js");
  let offline: typeof import("../src/offline-sweeper.js");
  let configuration: typeof import("../src/config.js");
  let building: string, device: string, gateway: string;
  let fetchCalls = 0;
  async function packet(metric = "water_level_percent", value: number | boolean | string = 1, time = new Date(), event = randomUUID(), sourceDevice = device) {
    return Buffer.from(JSON.stringify({ schemaVersion: 1, eventId: event, buildingId: building, deviceId: sourceDevice, metric, value, quality: "GOOD", timestamp: time.toISOString() }));
  }
  async function ingest(raw: Buffer, sourceDevice = device) { await pipeline.handleTelemetry(telemetryTopic(building, sourceDevice), raw); }
  function offlinePacket(sourceBuilding = building, sourceGateway = gateway) {
    return Buffer.from(JSON.stringify({ schemaVersion: 1, buildingId: sourceBuilding, gatewayId: sourceGateway, state: "OFFLINE", timestamp: new Date().toISOString() }));
  }
  async function offlineStatus(raw = offlinePacket(), topicBuilding = building, topicGateway = gateway) {
    await gatewayStatus.handleGatewayStatus(gatewayStatusTopic(topicBuilding, topicGateway), raw);
  }
  async function rule(severity = "HIGH", metric = "water_level_percent", sourceDevice: string | null = device, cooldownSeconds = 300): Promise<string> {
    const [created] = await owner`insert into alert_rules(building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds)
      values(${building},${sourceDevice},${randomUUID()},${metric},'LT',20,${severity}::alert_severity,'FIXTURE_RULE','Reading {value}',${cooldownSeconds}) returning id`;
    return created!.id as string;
  }
  async function counts() {
    return (await owner`select
      (select count(*)::int from ingest_events where building_id=${building}) as dedup,
      (select count(*)::int from telemetry where building_id=${building}) as readings,
      (select count(*)::int from alerts where building_id=${building}) as alerts,
      (select count(*)::int from outbox_events where building_id=${building}) as events,
      (select count(*)::int from event_deliveries d join outbox_events e on e.id=d.event_id where e.building_id=${building}) as deliveries`)[0]!;
  }
  // A trigger runs as the role that fired it. `privileged` models a late writer
  // with more authority than the restricted service, e.g. another subsystem.
  async function trigger(table: string, operation: "insert" | "update", body: string, test: () => Promise<void>, timing: "before" | "after" = "before", privileged = false) {
    assert.ok(["alerts", "outbox_events", "devices", "gateways", "telemetry", "ingest_events", "daily_usage", "usage_cursors"].includes(table));
    await owner.unsafe(`create function notification_producer_fault() returns trigger language plpgsql${privileged ? " security definer set search_path=public,pg_temp" : ""} as $$ begin ${body} end $$`);
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
    const original = database.ingestDb.transaction.bind(database.ingestDb);
    mock.method(database.ingestDb, "transaction", ((callback: any) => original(async tx => {
      const execute = tx.execute.bind(tx);
      mock.method(tx, "execute", ((query: any) => {
        if (new PgDialect().sqlToQuery(query).sql.includes("pg_notify")) throw new Error("fixture realtime outage");
        return execute(query);
      }) as any);
      return callback(tx);
    })) as any);
  }
  // Sweeper is intentionally global, so each test switches every other source off.
  // The database may be shared with later suites: restore their exact flags.
  let priorSources: Array<{ kind: string; id: string; enabled: boolean }> = [];
  before(async () => {
    priorSources = [...await owner<typeof priorSources>`select 'gateways' as kind,id,enabled from gateways union all select 'devices',id,enabled from devices`];
    database = await import("@predioon/db/ingest");
    pipeline = await import("../src/pipeline/telemetry.js");
    gatewayStatus = await import("../src/pipeline/gateway-status.js");
    offline = await import("../src/offline-sweeper.js");
    configuration = await import("../src/config.js");
    configuration.config.ALERT_WEBHOOK_URL = "https://must-not-call.example.invalid";
  });
  beforeEach(async () => {
    // Keep previous sources inactive so each observation covers precisely the current one.
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
    for (const { kind, id, enabled } of priorSources) await owner.unsafe(`update ${kind === "gateways" ? "gateways" : "devices"} set enabled=$1 where id=$2`, [enabled, id]);
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
  it("persists an OFFLINE status message and outbox despite a fresh gateway heartbeat", async () => {
    const [before] = await owner`select last_seen_at,last_seen_at > clock_timestamp()-make_interval(secs=>${configuration.config.GATEWAY_OFFLINE_TIMEOUT_SECONDS}) as fresh from gateways where id=${gateway}`;
    assert.equal(before!.fresh, true);
    await offline.sweepOffline();
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    assert.equal((await owner`select status from gateways where id=${gateway}`)[0]!.status, "ONLINE");

    await offlineStatus();
    const [after] = await owner`select status,last_seen_at from gateways where id=${gateway}`;
    assert.equal(after!.status, "OFFLINE");
    assert.deepEqual(after!.last_seen_at, before!.last_seen_at, "a Last Will must not invent a newer heartbeat");
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 1, events: 1, deliveries: 1 });
    const [incident] = await owner`select a.gateway_id,a.device_id,a.type,a.severity,a.status,e.alert_id=a.id as own_source,d.status as delivery_status
      from alerts a join outbox_events e on e.alert_id=a.id join event_deliveries d on d.event_id=e.id where a.building_id=${building}`;
    assert.deepEqual({ ...incident }, { gateway_id: gateway, device_id: null, type: "COMMUNICATION_LOST", severity: "HIGH", status: "OPEN", own_source: true, delivery_status: "pending" });
    assert.equal(fetchCalls, 0);
  });
  it("keeps one unresolved incident for concurrent and repeated OFFLINE status messages", async () => {
    const raw = offlinePacket();
    await Promise.all([offlineStatus(raw), offlineStatus(raw), offlineStatus(raw)]);
    const first = await owner`select a.id,e.id as event_id,d.id as delivery_id from alerts a join outbox_events e on e.alert_id=a.id
      join event_deliveries d on d.event_id=e.id where a.building_id=${building}`;
    assert.equal(first.length, 1);
    await offlineStatus(raw);
    assert.deepEqual(await owner`select a.id,e.id as event_id,d.id as delivery_id from alerts a join outbox_events e on e.alert_id=a.id
      join event_deliveries d on d.event_id=e.id where a.building_id=${building}`, first);
    assert.equal((await owner`select status from gateways where id=${gateway}`)[0]!.status, "OFFLINE");
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 1, events: 1, deliveries: 1 });
    assert.equal(fetchCalls, 0);
  });
  it("rolls back a fresh gateway OFFLINE message when outbox persistence fails", async () => {
    const before = await owner`select status,last_seen_at,updated_at from gateways where id=${gateway}`;
    await trigger("outbox_events", "insert", "raise exception 'fixture crash before commit';", async () => {
      await assert.rejects(offlineStatus(), beforeCommitFailure);
      assert.deepEqual(await owner`select status,last_seen_at,updated_at from gateways where id=${gateway}`, before);
      assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
      assert.equal(fetchCalls, 0);
    });
  });
  it("does not apply an OFFLINE message across condominium or topic identities", async () => {
    const foreignBuilding = `${building}_foreign`, foreignGateway = `${gateway}_foreign`;
    await owner`insert into buildings(id,organization_id,name,code) select ${foreignBuilding},organization_id,'Other fixture',${foreignBuilding} from buildings where id=${building}`;
    await owner`insert into gateways(id,building_id,name,serial_number,status,last_seen_at)
      values(${foreignGateway},${foreignBuilding},'Other gateway',${foreignGateway},'ONLINE',clock_timestamp())`;
    const before = await owner`select id,building_id,status,last_seen_at,updated_at from gateways where id in (${gateway},${foreignGateway}) order by id`;
    // A real foreign source makes both routing negatives non-vacuous.
    await offlineStatus(offlinePacket(foreignBuilding, foreignGateway));
    // Topic and body agree, but this existing gateway belongs to another building.
    await offlineStatus(offlinePacket(building, foreignGateway), building, foreignGateway);
    assert.deepEqual(await owner`select id,building_id,status,last_seen_at,updated_at from gateways where id in (${gateway},${foreignGateway}) order by id`, before);
    assert.equal((await owner`select count(*)::int as count from alerts where building_id in (${building},${foreignBuilding})`)[0]!.count, 0);
    assert.equal((await owner`select count(*)::int as count from outbox_events where building_id in (${building},${foreignBuilding})`)[0]!.count, 0);
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    assert.equal(fetchCalls, 0);
  });
  for (const disabled of ["flag", "status"] as const) it(`ignores OFFLINE messages for a gateway disabled by ${disabled}`, async () => {
    if (disabled === "flag") await owner`update gateways set enabled=false where id=${gateway}`;
    else await owner`update gateways set status='DISABLED' where id=${gateway}`;
    const before = await owner`select status,last_seen_at,updated_at,enabled from gateways where id=${gateway}`;
    await offlineStatus();
    assert.deepEqual(await owner`select status,last_seen_at,updated_at,enabled from gateways where id=${gateway}`, before);
    assert.deepEqual(await counts(), { dedup: 0, readings: 0, alerts: 0, events: 0, deliveries: 0 });
    assert.equal(fetchCalls, 0);
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
      const {ingestDb:db,ingestSqlClient:sqlClient}=await import('@predioon/db/ingest');
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
      cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: undefined, TEST_INGEST_DATABASE_URL: undefined }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
  it("keeps a shared rule cooldown independent for each device", async () => {
    const secondDevice = `${device}_second`;
    await owner`insert into devices(id,building_id,gateway_id,name,type,status,last_seen_at)
      values(${secondDevice},${building},${gateway},'Second sensor','WATER_LEVEL_SENSOR','ONLINE',clock_timestamp())`;
    // One rule UUID with device_id NULL; separate per-device rules would hide the regression.
    const ruleId = await rule("HIGH", "water_level_percent", null, 60);
    const first = await packet();
    await ingest(first);
    // Sequential delivery is intentional: the first alert must be committed before B is checked.
    await ingest(await packet("water_level_percent", 2, new Date(), randomUUID(), secondDevice), secondDevice);
    assert.deepEqual(await counts(), { dedup: 2, readings: 2, alerts: 2, events: 2, deliveries: 2 });
    const perDevice = await owner`select device_id,count(*)::int as count from alerts where building_id=${building} and rule_id=${ruleId} group by device_id order by device_id`;
    assert.deepEqual(perDevice.map(row => ({ ...row })), [device, secondDevice].sort().map(id => ({ device_id: id, count: 1 })));

    // Distinct event IDs prove cooldown suppression rather than receipt deduplication.
    await ingest(await packet());
    await ingest(await packet("water_level_percent", 3, new Date(), randomUUID(), secondDevice), secondDevice);
    await ingest(first);
    assert.deepEqual(await counts(), { dedup: 4, readings: 4, alerts: 2, events: 2, deliveries: 2 });
    assert.equal(fetchCalls, 0);
  });
  it("uses alert processing time for cooldown when fresh-enough readings describe the recent past", async () => {
    const ruleId = await rule("HIGH", "water_level_percent", device, 60);
    const observedAt = new Date(Date.now() - 120_000);
    await ingest(await packet("water_level_percent", 1, observedAt));
    const [first] = await owner`select id,triggered_at,created_at from alerts where building_id=${building} and rule_id=${ruleId}`;
    assert.ok(first, "the two-minute-old reading is within the unchanged five-minute freshness window");
    assert.equal(new Date(first!.triggered_at).toISOString(), observedAt.toISOString());
    assert.ok(new Date(first!.created_at).getTime() - new Date(first!.triggered_at).getTime() > 60_000);
    await ingest(await packet("water_level_percent", 2, new Date(Date.now() - 110_000)));
    assert.deepEqual(await counts(), { dedup: 2, readings: 2, alerts: 1, events: 1, deliveries: 1 });
    assert.equal((await owner`select id from alerts where building_id=${building} and rule_id=${ruleId}`)[0]!.id, first!.id);
    assert.equal(fetchCalls, 0);
  });
  it("allows a new alert after processing cooldown expires even when the prior observation is recent", async () => {
    const ruleId = await rule("HIGH", "water_level_percent", device, 60);
    await ingest(await packet());
    // Only this fixture's source timestamp is arranged; no clock mock, sleep or immutable outbox mutation.
    await owner`update alerts set created_at=clock_timestamp()-interval '2 minutes' where building_id=${building} and rule_id=${ruleId}`;
    const [prior] = await owner`select id,created_at < clock_timestamp()-interval '1 minute' as expired,
      triggered_at > clock_timestamp()-interval '1 minute' as observation_recent from alerts where building_id=${building} and rule_id=${ruleId}`;
    assert.equal(prior!.expired, true);
    assert.equal(prior!.observation_recent, true);
    await ingest(await packet("water_level_percent", 2));
    assert.deepEqual(await counts(), { dedup: 2, readings: 2, alerts: 2, events: 2, deliveries: 2 });
    assert.equal((await owner`select count(*)::int as count from alerts where building_id=${building} and rule_id=${ruleId} and id<>${prior!.id}`)[0]!.count, 1);
    assert.equal(fetchCalls, 0);
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
      const locker = adminSession(); let sweeping: Promise<void> | undefined;
      try {
        await locker.begin(async tx => {
          await tx.unsafe(`select id from ${table} where id=$1 for update`, [target]);
          sweeping = offline.sweepOffline();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            if ((await owner`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count) break;
            await delay(20);
          }
          assert.ok((await owner`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count > 0);
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
      const locker = adminSession(); let sweeping: Promise<void> | undefined;
      try {
        await owner.unsafe(`update ${table} set last_seen_at=clock_timestamp()-interval '1 hour' where id=$1`, [target]);
        await locker.begin(async tx => {
          await tx.unsafe(`update ${table} set last_seen_at=clock_timestamp()-interval '500 milliseconds' where id=$1`, [target]);
          sweeping = offline.sweepOffline();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline && !(await owner`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count) await delay(20);
          assert.ok((await owner`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like ${`%from "${table}"%`}`)[0]!.count > 0);
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
    }, "after", true);
  });
});
