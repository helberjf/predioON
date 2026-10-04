import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import postgres from "postgres";
import { baseline } from "../src/baseline-schema.js";
import { applyInfrastructure, loadInfrastructureMigrations } from "../src/infrastructure-migrations.js";

// This suite creates a fresh database. Its URL must point to a disposable test
// cluster: roles are cluster-wide, and only here are runtime roles made LOGIN.
const adminUrl = process.env.TEST_NOTIFICATION_DATABASE_URL;
const migrationPath = fileURLToPath(new URL("../../../infrastructure/038-durable-alert-delivery.sql", import.meta.url));

describe("durable alert delivery SQL038, real restricted connections", { skip: !adminUrl, concurrency: false }, () => {
  const name = `notification_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID();
  let admin: postgres.Sql, owner: postgres.Sql;
  const clients: postgres.Sql[] = [];
  let migrated = false;
  let building = "", device = "", gateway = "";

  async function runtime(role = "predioon_notifications") {
    const url = new URL(adminUrl!); url.pathname = `/${name}`; url.username = role; url.password = password;
    const client = postgres(url.toString(), { max: 1, idle_timeout: 0, onnotice: () => {} });
    clients.push(client);
    return client;
  }
  async function alert(options: { type?: string; severity?: string; metric?: string; deviceType?: string; future?: boolean; core?: boolean } = {}) {
    if (options.deviceType) await owner`update devices set type=${options.deviceType} where id=${device}`;
    let rule: string | null = null;
    if (options.metric) {
      rule = randomUUID();
      await owner`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template)
        values(${rule},${building},${device},${rule},${options.metric},'GT',1,'RULE','fixture')`;
    }
    const id = randomUUID();
    await owner`insert into alerts(id,building_id,device_id,gateway_id,rule_id,severity,type,message,triggered_at)
      values(${id},${building},${options.core ? null : device},${options.core ? gateway : null},${rule},
        ${options.severity ?? "HIGH"}::alert_severity,${options.type ?? "DEVICE_OFFLINE"},'private fixture message',
        clock_timestamp() + ${options.future ? "60 seconds" : "0 seconds"}::interval)`;
    return id;
  }
  async function enqueue(id: string) {
    const [row] = await owner`select notification_enqueue_alert(${id}::uuid) as id`;
    return row!.id as string;
  }
  async function setting(feature: string, enabled: boolean) {
    await owner.begin(async tx => {
      await tx`select set_config('app.user_id','notification_admin',true)`;
      await tx`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},${feature},${enabled})
        on conflict(building_id,feature_key) do update set enabled=excluded.enabled`;
      await tx`select app_apply_feature_transition(${building},${feature},${enabled})`;
    });
  }
  async function claimed(client: postgres.Sql) {
    await client`select notification_begin_attempt()`;
    const rows = await client`select * from notification_claim(1)`;
    assert.equal(rows.length, 1);
    return rows[0]!;
  }
  async function blocked(pid: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if ((await owner`select wait_event_type from pg_stat_activity where pid=${pid}`)[0]?.wait_event_type === "Lock") return;
      await delay(20);
    }
    assert.fail("Expected the SQL operation to wait on the held database lock");
  }
  async function trigger(table: string, timing: "before" | "after", operation: "insert" | "update" | "delete", body: string, test: () => Promise<void>) {
    assert.ok(["outbox_events", "event_deliveries", "delivery_witnesses", "delivery_witness_features", "notification_attempts", "feature_runtime"].includes(table));
    await owner.unsafe(`create function notification_test_trigger() returns trigger language plpgsql as $$ begin ${body} end $$`);
    await owner.unsafe(`create trigger zz_notification_test ${timing} ${operation} on ${table} for each row execute function notification_test_trigger()`);
    try { await test(); } finally {
      await owner.unsafe(`drop trigger zz_notification_test on ${table}`);
      await owner`drop function notification_test_trigger()`;
    }
  }

  before(async () => {
    assert.equal(process.env.TEST_NOTIFICATION_DISPOSABLE_DB, "1", "Only an explicitly disposable cluster may change cluster-wide runtime logins and memberships");
    assert.match(new URL(adminUrl!).hostname, /^(localhost|127\.0\.0\.1)$/);
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    owner = postgres(url.toString(), { max: 1, onnotice: () => {} });
    await owner.unsafe(baseline);
    const migrations = await loadInfrastructureMigrations();
    await applyInfrastructure(owner, migrations.filter(row => Number.parseInt(row.id, 10) <= 37));
    try { await access(migrationPath); migrated = true; } catch { /* RED baseline has no SQL038. */ }
    if (migrated) {
      // Migration must harden an existing runtime as well as a freshly created
      // one. Explicitly injected column grants must also be removed by the
      // table REVOKE ALL, as PostgreSQL specifies for corresponding columns.
      await owner`do $$ begin if not exists(select 1 from pg_roles where rolname='predioon_notifications') then create role predioon_notifications nologin; end if; end $$`;
      await owner`grant predioon_app to predioon_notifications`;
      await owner`grant predioon_notifications to predioon_identity`;
      await owner`grant select(password_hash) on users to predioon_notifications`;
      assert.equal((await owner`select has_column_privilege('predioon_notifications','users','password_hash','SELECT') as granted`)[0]!.granted, true);
      await owner`create table notification_test_acl_observations(granted boolean not null)`;
      await owner`create function notification_test_default_column_grant() returns event_trigger language plpgsql as $$
        declare target text; begin
        if tg_tag='CREATE TABLE' then
          for target in select object_identity from pg_event_trigger_ddl_commands() where object_type='table' loop
            if target='public.outbox_events' then
              execute 'grant select(alert_id) on outbox_events to public';
              insert into notification_test_acl_observations values(has_column_privilege('predioon_notifications','outbox_events','alert_id','SELECT'));
            end if;
          end loop;
        end if; end $$`;
      await owner`create event trigger notification_test_default_grant on ddl_command_end execute function notification_test_default_column_grant()`;
      await applyInfrastructure(owner, migrations);
      assert.deepEqual((await owner`select granted from notification_test_acl_observations`).map(row => row.granted), [true]);
      await owner`drop event trigger notification_test_default_grant`;
      await owner`drop function notification_test_default_column_grant()`;
      await owner`drop table notification_test_acl_observations`;
      const [role] = await owner`select rolcanlogin,rolsuper,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
        from pg_roles where rolname='predioon_notifications'`;
      assert.deepEqual(role, { rolcanlogin: false, rolsuper: false, rolinherit: false, rolbypassrls: false,
        rolcreatedb: false, rolcreaterole: false, rolreplication: false });
      for (const role of ["predioon_notifications", "predioon_app", "predioon_identity", "predioon_broker_auth"])
        await owner.unsafe(`alter role "${role}" login password '${password}'`);
    }
    await owner`insert into users(id,email,name,is_platform_admin) values('notification_admin','notification-admin@example.invalid','Admin',true)`;
  });
  beforeEach(async () => {
    if (migrated) await owner`truncate notification_attempts,delivery_witness_features,delivery_witnesses,event_deliveries,outbox_events cascade`;
    const suffix = randomUUID(); building = `notification_b_${suffix}`; device = `notification_d_${suffix}`; gateway = `notification_g_${suffix}`;
    await owner`insert into organizations(id,name,slug) values(${suffix},'Fixture',${suffix})`;
    await owner`insert into buildings(id,organization_id,name,code) values(${building},${suffix},'Fixture',${suffix})`;
    await owner`insert into gateways(id,building_id,name,serial_number) values(${gateway},${building},'Gateway',${suffix})`;
    await owner`insert into devices(id,building_id,gateway_id,type,name) values(${device},${building},${gateway},'ENERGY_METER','Meter')`;
  });
  afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.end({ timeout: 0 }))); });
  after(async () => {
    if (owner) await owner.end({ timeout: 0 });
    if (admin) { await admin.unsafe(`drop database if exists "${name}" with (force)`); await admin.end(); }
  });

  it("enqueues only the committed source atomically and does not copy private payload", async () => {
    const id = await alert();
    await assert.rejects(owner.begin(async tx => {
      await tx`select notification_enqueue_alert(${id}::uuid)`;
      throw new Error("rollback fixture");
    }), /rollback fixture/);
    assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 0);
    const event = await enqueue(id);
    assert.equal(await enqueue(id), event);
    assert.equal((await owner`select count(*)::int as count from event_deliveries`)[0]!.count, 1);
    const columns = await owner`select column_name from information_schema.columns where table_name='outbox_events'`;
    assert.ok(!columns.some(row => /message|payload|credential|telemetry/.test(row.column_name)));
  });
  it("keeps severity separate from eligibility and creates no low severity webhook", async () => {
    await enqueue(await alert({ severity: "LOW" }));
    assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 1);
    assert.equal((await owner`select count(*)::int as count from event_deliveries`)[0]!.count, 0);
  });
  it("retains valid ANY alternative while ALL loses either requirement", async () => {
    await enqueue(await alert());
    await enqueue(await alert({ metric: "unknown_metric" }));
    await setting("ENERGY_CONSUMPTION", false);
    const rows = await owner`select status from event_deliveries order by created_at`;
    assert.deepEqual(rows.map(row => row.status), ["pending", "cancelled"]);
  });
  it("never invents an initially disabled ANY witness or resurrects future alerts after resume", async () => {
    await setting("ELECTRICAL", false);
    await enqueue(await alert({ future: true }));
    await setting("ELECTRICAL", true);
    await setting("ENERGY_CONSUMPTION", false);
    await setting("ENERGY_CONSUMPTION", true);
    assert.equal((await owner`select status from event_deliveries`)[0]!.status, "cancelled");
  });
  it("requires AI together with usage and supports core gateway alerts", async () => {
    await enqueue(await alert({ type: "ADAPTIVE_ENERGY_LIMIT" }));
    await enqueue(await alert({ core: true, type: "GATEWAY_OFFLINE" }));
    await setting("AI_ANALYSIS", false);
    const rows = await owner`select status from event_deliveries order by created_at`;
    assert.deepEqual(rows.map(row => row.status), ["cancelled", "pending"]);
    const client = await runtime(); const claim = await claimed(client);
    assert.equal((await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`)[0]!.device_id, gateway);
  });
  it("exposes no direct table or enqueue access to any runtime login", async () => {
    const id = await alert(); await enqueue(id);
    for (const role of ["predioon_notifications", "predioon_app", "predioon_identity", "predioon_broker_auth"]) {
      const client = await runtime(role);
      await assert.rejects(client`select * from event_deliveries`, error => (error as { code?: string }).code === "42501");
      await assert.rejects(client`select notification_enqueue_alert(${id}::uuid)`, error => (error as { code?: string }).code === "42501");
    }
  });
  it("rejects reentrant acquisition and claims through an actual restricted backend", async () => {
    await enqueue(await alert()); const client = await runtime();
    const claim = await claimed(client);
    await assert.rejects(client`select notification_begin_attempt()`, /already|reentrant/i);
    const payload = await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`;
    assert.equal(payload.length, 1); assert.equal(payload[0]!.message, "private fixture message");
    assert.equal(payload[0]!.device_id, device);
    assert.equal((await client`select notification_end_attempt() as ended`)[0]!.ended, true);
    await assert.rejects(client`select * from notification_claim(1)`, /attempt|barrier/i);
  });
  it("does not let a second connection complete a copied claim token", async () => {
    await enqueue(await alert()); const first = await runtime(), second = await runtime();
    const claim = await claimed(first); await second`select notification_begin_attempt()`;
    const [result] = await second`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',200,null) as result`;
    assert.equal(result!.result, "stale");
    assert.equal((await owner`select status from event_deliveries`)[0]!.status, "inflight");
    const [done] = await first`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',204,null) as result`;
    assert.equal(done!.result, "delivered");
  });
  it("uses bounded retry, explicit missing destination and a stable idempotency key", async () => {
    await enqueue(await alert()); const client = await runtime(); const claim = await claimed(client);
    const [payload] = await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`;
    const [retry] = await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',429,999999) as result`;
    assert.equal(retry!.result, "retry");
    const [row] = await owner`select extract(epoch from available_at-clock_timestamp()) as delay from event_deliveries`;
    assert.ok(Number(row!.delay) > 0 && Number(row!.delay) <= 300);
    await client`select notification_end_attempt()`;
    await owner`update event_deliveries set available_at=clock_timestamp()-interval '1 second'`;
    const next = await claimed(client);
    const [again] = await client`select * from notification_revalidate(${next.delivery_id}::uuid,${next.claim_token}::uuid)`;
    assert.equal(again!.idempotency_key, payload!.idempotency_key);
    assert.equal((await client`select notification_complete(${next.delivery_id}::uuid,${next.claim_token}::uuid,'no_destination',null,null) as result`)[0]!.result, "no_destination");
  });
  it("preserves delivery state on ledger reapplication", async () => {
    await enqueue(await alert()); const migrations = await loadInfrastructureMigrations();
    assert.deepEqual(await applyInfrastructure(owner, migrations), []);
    assert.equal((await owner`select count(*)::int as count from schema_migrations`)[0]!.count, 38);
    assert.equal((await owner`select count(*)::int as count from event_deliveries`)[0]!.count, 1);
  });
  it("removes preexisting runtime column grants, PUBLIC column grants and memberships", async () => {
    const [grants] = await owner`select
      has_column_privilege('predioon_notifications','users','password_hash','SELECT') as secret,
      has_column_privilege('predioon_notifications','outbox_events','alert_id','SELECT') as event,
      exists(select 1 from pg_auth_members where member='predioon_notifications'::regrole) as member`;
    assert.deepEqual(grants, { secret: false, event: false, member: false });
    const client = await runtime();
    await assert.rejects(client`select password_hash from users`, error => (error as { code?: string }).code === "42501");
  });
  it("removes incoming runtime memberships that could SET ROLE into the worker", async () => {
    const client = await runtime("predioon_identity");
    await assert.rejects(client`set role predioon_notifications`, error => (error as { code?: string }).code === "42501");
    assert.equal((await owner`select count(*)::int as count from pg_auth_members where roleid='predioon_notifications'::regrole`)[0]!.count, 0);
  });
  it("distinguishes unbound parking ALL readings from ANY communication and bound gates", async () => {
    await enqueue(await alert({ deviceType: "PARKING_SENSOR" }));
    await enqueue(await alert({ metric: "parking_occupied" }));
    await setting("CAR_PARKING", false);
    assert.deepEqual((await owner`select status from event_deliveries order by created_at`).map(row => row.status), ["pending", "cancelled"]);
    await owner`update devices set type='GATE_CONTROLLER' where id=${device}`;
    await owner`insert into gates(building_id,name,kind,gateway_id,device_id) values(${building},'Gate','GARAGE',${gateway},${device})`;
    const event = await enqueue(await alert());
    const features = await owner`select f.feature_key from delivery_witness_features f join event_deliveries d on d.id=f.delivery_id where d.event_id=${event}`;
    assert.deepEqual(features.map(row => row.feature_key), ["GARAGE_ACCESS"]);
    await setting("GARAGE_ACCESS", false);
    assert.equal((await owner`select status from event_deliveries where event_id=${event}`)[0]!.status, "cancelled");
  });
  it("preserves alert status and device enabled independence in permitsAlert", async () => {
    const id = await alert();
    await owner`update alerts set status='RESOLVED' where id=${id}`;
    await owner`update devices set enabled=false,status='DISABLED' where id=${device}`;
    await enqueue(id); const client = await runtime(); const claim = await claimed(client);
    assert.equal((await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`).length, 1);
  });
  it("cancels a deleted source while retaining the immutable event identity", async () => {
    const id = await alert(); const event = await enqueue(id);
    await owner`delete from alerts where id=${id}`;
    const client = await runtime(); await client`select notification_begin_attempt()`;
    assert.equal((await client`select * from notification_claim(1)`).length, 0);
    const [row] = await owner`select status,failure_category from event_deliveries where event_id=${event}`;
    assert.deepEqual(row, { status: "cancelled", failure_category: "SOURCE_GONE" });
    assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 1);
  });
  it("gives concurrent workers different reservations and prevents a second claim per attempt", async () => {
    await enqueue(await alert()); await enqueue(await alert());
    const first = await runtime(), second = await runtime();
    await Promise.all([first`select notification_begin_attempt()`, second`select notification_begin_attempt()`]);
    const [a, b] = await Promise.all([first`select * from notification_claim(1)`, second`select * from notification_claim(1)`]);
    assert.equal(a.length, 1); assert.equal(b.length, 1);
    assert.notEqual(a[0]!.delivery_id, b[0]!.delivery_id); assert.notEqual(a[0]!.claim_token, b[0]!.claim_token);
    await assert.rejects(first`select * from notification_claim(1)`, /already claimed/i);
  });
  it("recovers an expired reservation without accepting the old token", async () => {
    await enqueue(await alert()); const first = await runtime(), second = await runtime(); const a = await claimed(first);
    await owner`update event_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=${a.delivery_id}`;
    const b = await claimed(second);
    assert.equal(b.delivery_id, a.delivery_id); assert.notEqual(b.claim_token, a.claim_token);
    assert.equal((await first`select notification_complete(${a.delivery_id}::uuid,${a.claim_token}::uuid,'http',200,null) as result`)[0]!.result, "stale");
    assert.equal((await second`select notification_complete(${b.delivery_id}::uuid,${b.claim_token}::uuid,'http',200,null) as result`)[0]!.result, "delivered");
    assert.equal((await owner`select attempts from event_deliveries`)[0]!.attempts, 2);
  });
  it("computes lease after waiting for the feature barrier", async () => {
    await enqueue(await alert()); const client = await runtime(); const pid = (await client`select pg_backend_pid() as pid`)[0]!.pid;
    let waiting: Promise<unknown> | undefined;
    await owner.begin(async tx => {
      await tx`select pg_advisory_xact_lock(814772,1)`;
      waiting = Promise.resolve(client`select notification_begin_attempt()`);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await tx`select wait_event_type from pg_stat_activity where pid=${pid}`)[0]?.wait_event_type === "Lock") break;
        await delay(20);
      }
      assert.equal((await tx`select wait_event_type from pg_stat_activity where pid=${pid}`)[0]!.wait_event_type, "Lock");
      await delay(250);
    });
    await waiting;
    const [claim] = await client`select * from notification_claim(1)`;
    const [time] = await owner`select extract(epoch from ${claim!.lease_until}::timestamptz-clock_timestamp()) as remaining`;
    assert.ok(Number(time!.remaining) > 19 && Number(time!.remaining) <= 20);
  });
  it("rejects a lease that expires during the completion row-lock wait", async () => {
    await enqueue(await alert()); const client = await runtime(); const claim = await claimed(client);
    const pid = (await client`select pg_backend_pid() as pid`)[0]!.pid;
    let waiting: Promise<postgres.RowList<postgres.Row[]>> | undefined;
    await owner.begin(async tx => {
      await tx`update event_deliveries set lease_until=clock_timestamp()+interval '200 milliseconds' where id=${claim.delivery_id}`;
      waiting = Promise.resolve(client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',200,null) as result`);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && (await tx`select wait_event_type from pg_stat_activity where pid=${pid}`)[0]?.wait_event_type !== "Lock") await delay(20);
      assert.equal((await tx`select wait_event_type from pg_stat_activity where pid=${pid}`)[0]!.wait_event_type, "Lock");
      await delay(250);
    });
    assert.equal((await waiting!)![0]!.result, "stale");
    assert.equal((await owner`select status from event_deliveries`)[0]!.status, "inflight");
  });
  it("holds pause until the session ends and does not hold a transaction during the external-effect window", async () => {
    await enqueue(await alert({ metric: "energy_total_kwh" })); const client = await runtime(); const claim = await claimed(client);
    const pid = (await client`select pg_backend_pid() as pid`)[0]!.pid;
    const [backend] = await owner`select state,xact_start from pg_stat_activity where pid=${pid}`;
    assert.equal(backend!.state, "idle"); assert.equal(backend!.xact_start, null);
    const pauser = await runtime("predioon_app"); const pausePid = (await pauser`select pg_backend_pid() as pid`)[0]!.pid;
    let settled = false;
    const pause = pauser.begin(async tx => {
      await tx`select set_config('app.user_id','notification_admin',true)`;
      await tx`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'ENERGY_CONSUMPTION',false)`;
      await tx`select app_apply_feature_transition(${building},'ENERGY_CONSUMPTION',false)`;
    }).finally(() => { settled = true; });
    await blocked(pausePid); assert.equal(settled, false);
    assert.equal((await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',204,null) as result`)[0]!.result, "delivered");
    await client`select notification_end_attempt()`; await pause;
    assert.equal((await owner`select status from event_deliveries`)[0]!.status, "delivered");
  });
  it("refuses lock-only access and rollback-contaminated connections", async () => {
    const client = await runtime();
    await client`select pg_advisory_lock_shared(814772,1)`;
    await assert.rejects(client`select * from notification_claim(1)`, /attempt barrier/i);
    await assert.rejects(client`select notification_begin_attempt()`, /reentrant/i);
    await client`select pg_advisory_unlock_shared(814772,1)`;
    await assert.rejects(client.begin(async tx => { await tx`select notification_begin_attempt()`; throw new Error("rollback fixture"); }), /rollback fixture/);
    await assert.rejects(client`select * from notification_claim(1)`, /attempt barrier/i);
    const pid = (await client`select pg_backend_pid() as pid`)[0]!.pid;
    assert.equal((await owner`select count(*)::int as count from pg_locks where pid=${pid} and locktype='advisory' and classid=814772 and objid=1`)[0]!.count, 1);
    await client.end({ timeout: 0 });
    assert.equal((await owner`select count(*)::int as count from pg_locks where pid=${pid} and locktype='advisory' and classid=814772 and objid=1`)[0]!.count, 0);
  });
  it("keeps RLS effective after an accidental broad table grant", async () => {
    await enqueue(await alert()); const client = await runtime();
    await owner`grant select,insert,update,delete on event_deliveries to predioon_notifications`;
    try {
      assert.equal((await client`select * from event_deliveries`).length, 0);
      await assert.rejects(client`insert into event_deliveries(event_id,consumer,action) values(${randomUUID()},'webhook','alert.raised.v1')`, error => (error as { code?: string }).code === "42501");
    } finally { await owner`revoke all on event_deliveries from predioon_notifications`; }
  });
  it("keeps origins and delivery identities immutable even for direct owner updates", async () => {
    await enqueue(await alert());
    await assert.rejects(owner`update outbox_events set event_version=1`, /immutable/i);
    await assert.rejects(owner`delete from delivery_witness_features`, /immutable/i);
    await assert.rejects(owner`update event_deliveries set action='forged'`, /immutable/i);
  });
  it("refuses arbitrary claim limits, outcome categories and foreign tokens", async () => {
    await enqueue(await alert()); const client = await runtime();
    for (const limit of [null, -1, 0, 2, 500]) await assert.rejects(client`select * from notification_claim(${limit})`, /limit/i);
    const claim = await claimed(client);
    for (const [outcome, status, retry] of [["raw private error", null, null], ["http", null, null], ["http", 999, null], ["network", 200, null], ["timeout", null, 20], ["http", 200, 20], ["http", 429, -1]] as const)
      await assert.rejects(client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,${outcome},${status},${retry})`, /invalid.*outcome/i);
    assert.equal((await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${randomUUID()}::uuid)`).length, 0);
    assert.equal((await client`select notification_complete(${claim.delivery_id}::uuid,${randomUUID()}::uuid,'http',200,null) as result`)[0]!.result, "stale");
  });
  for (const table of ["outbox_events", "event_deliveries", "delivery_witnesses", "delivery_witness_features"]) {
    it(`rolls back enqueue when ${table} BEFORE INSERT silently skips a write`, async () => {
      const id = await alert();
      await trigger(table, "before", "insert", "return null;", async () => {
        await assert.rejects(enqueue(id));
        assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 0);
        assert.equal((await owner`select count(*)::int as count from event_deliveries`)[0]!.count, 0);
      });
    });
  }
  it("rolls back enqueue when a trigger rewrites delivery availability", async () => {
    const id = await alert();
    await trigger("event_deliveries", "before", "insert", "new.available_at:=clock_timestamp()+interval '1 year'; return new;", async () => {
      await assert.rejects(enqueue(id), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 0);
    });
  });
  for (const timing of ["before", "after"] as const) {
    it(`rolls back completion when ${timing.toUpperCase()} trigger preserves inflight state`, async () => {
      await enqueue(await alert()); const client = await runtime(); const claim = await claimed(client);
      const body = timing === "before" ? "new:=old; return new;" : "if pg_trigger_depth()=1 then update event_deliveries set status=old.status,claim_token=old.claim_token,claim_backend_pid=old.claim_backend_pid,claim_backend_start=old.claim_backend_start,lease_until=old.lease_until,updated_at=old.updated_at where id=new.id; end if; return new;";
      await trigger("event_deliveries", timing, "update", body, async () => {
        await assert.rejects(client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',200,null)`, /not persisted/i);
        assert.equal((await owner`select status from event_deliveries`)[0]!.status, "inflight");
      });
    });
    it(`rolls back feature setting/runtime/cancellation when ${timing.toUpperCase()} trigger preserves pending state`, async () => {
      await enqueue(await alert({ metric: "energy_total_kwh" }));
      const body = timing === "before" ? "new:=old; return new;" : "if pg_trigger_depth()=1 then update event_deliveries set status=old.status,failure_category=old.failure_category,updated_at=old.updated_at where id=new.id; end if; return new;";
      await trigger("event_deliveries", timing, "update", body, async () => {
        await assert.rejects(setting("ENERGY_CONSUMPTION", false), /not persisted/i);
        assert.equal((await owner`select count(*)::int as count from feature_runtime where building_id=${building}`)[0]!.count, 0);
        assert.equal((await owner`select count(*)::int as count from building_feature_settings where building_id=${building}`)[0]!.count, 0);
        assert.equal((await owner`select status from event_deliveries`)[0]!.status, "pending");
      });
    });
  }
  it("rolls back runtime transition when its upsert is skipped", async () => {
    await enqueue(await alert({ metric: "energy_total_kwh" }));
    await trigger("feature_runtime", "before", "insert", "return null;", async () => {
      await assert.rejects(setting("ENERGY_CONSUMPTION", false), /not persisted/i);
      assert.equal((await owner`select status from event_deliveries`)[0]!.status, "pending");
    });
  });
  it("releases only its own acquired session barrier when attempt registration is skipped", async () => {
    const client = await runtime(); const pid = (await client`select pg_backend_pid() as pid`)[0]!.pid;
    await trigger("notification_attempts", "before", "insert", "return null;", async () => {
      await assert.rejects(client`select notification_begin_attempt()`, /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from pg_locks where pid=${pid} and locktype='advisory' and classid=814772 and objid=1`)[0]!.count, 0);
    });
  });
  it("detects failed end cleanup and requires closing the contaminated client", async () => {
    const client = await runtime(); await client`select notification_begin_attempt()`;
    await trigger("notification_attempts", "before", "delete", "return null;", async () => {
      await assert.rejects(client`select notification_end_attempt()`, /cleanup failed/i);
      await assert.rejects(client`select notification_begin_attempt()`, /already open/i);
    });
    await client.end({ timeout: 0 });
    const replacement = await runtime(); await replacement`select notification_begin_attempt()`;
    assert.equal((await owner`select count(*)::int as count from notification_attempts`)[0]!.count, 1);
  });
  it("invalidates a closed attempt even when the same backend opens a new attempt", async () => {
    await enqueue(await alert()); await enqueue(await alert()); const client = await runtime(); const claim = await claimed(client);
    await client`select notification_end_attempt()`; await client`select notification_begin_attempt()`;
    assert.equal((await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`).length, 0);
    assert.equal((await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',200,null) as result`)[0]!.result, "stale");
    const [next] = await client`select * from notification_claim(1)`;
    assert.notEqual(next!.delivery_id, claim.delivery_id);
    assert.equal((await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`).length, 0);
    assert.equal((await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',200,null) as result`)[0]!.result, "stale");
  });
  it("requires the captured backend start as well as the PID after connection loss", async () => {
    await enqueue(await alert()); const first = await runtime(); const claim = await claimed(first);
    await first.end({ timeout: 0 });
    const replacement = await runtime(); await replacement`select notification_begin_attempt()`;
    const pid = (await replacement`select pg_backend_pid() as pid`)[0]!.pid;
    // Simulate PID reuse, preserving the older start identity in the delivery.
    await owner`update event_deliveries set claim_backend_pid=${pid} where id=${claim.delivery_id}`;
    // Supply every other required attempt fact so that backend-start fencing,
    // rather than the claim_called/target guard, is what prevents completion.
    await owner`update notification_attempts set claim_called=true,delivery_id=${claim.delivery_id} where backend_pid=${pid}`;
    assert.equal((await replacement`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',200,null) as result`)[0]!.result, "stale");
    assert.equal((await replacement`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`).length, 0);
  });
  it("does not start HTTP with less than the fixed send deadline plus finalization margin", async () => {
    await enqueue(await alert()); const client = await runtime(); const claim = await claimed(client);
    await owner`update event_deliveries set lease_until=clock_timestamp()+interval '5 seconds' where id=${claim.delivery_id}`;
    assert.equal((await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`).length, 0);
    assert.equal((await owner`select status from event_deliveries`)[0]!.status, "inflight");
  });
  it("exhausts exactly five attempts and never retries a permanent client rejection", async () => {
    await enqueue(await alert()); const client = await runtime();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = await claimed(client);
      const [result] = await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'timeout',null,null) as result`;
      assert.equal(result!.result, attempt < 5 ? "retry" : "failed");
      await client`select notification_end_attempt()`;
      await owner`update event_deliveries set available_at=clock_timestamp()-interval '1 second'`;
    }
    const [exhausted] = await owner`select attempts,failure_category from event_deliveries`;
    assert.deepEqual(exhausted, { attempts: 5, failure_category: "ATTEMPTS_EXHAUSTED" });
    await enqueue(await alert()); const claim = await claimed(client);
    assert.equal((await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,'http',403,null) as result`)[0]!.result, "failed");
    assert.equal((await owner`select failure_category from event_deliveries where id=${claim.delivery_id}`)[0]!.failure_category, "HTTP_PERMANENT");
  });
  it("does not reset any terminal or reserved state when its source is enqueued again", async () => {
    for (const status of ["pending", "retry", "inflight", "delivered", "cancelled", "failed", "no_destination"]) {
      const id = await alert(); const event = await enqueue(id);
      await owner`update event_deliveries set status=${status},attempts=3,
        lease_until=case when ${status}='inflight' then clock_timestamp()+interval '20 seconds' end,
        claim_token=case when ${status}='inflight' then gen_random_uuid() end,
        claim_backend_pid=case when ${status}='inflight' then pg_backend_pid() end,
        claim_backend_start=case when ${status}='inflight' then notification_backend_start() end where event_id=${event}`;
      const [before] = await owner`select to_jsonb(d) as value from event_deliveries d where event_id=${event}`;
      assert.equal(await enqueue(id), event);
      assert.deepEqual((await owner`select to_jsonb(d) as value from event_deliveries d where event_id=${event}`)[0]!.value, before!.value);
    }
  });
  it("rolls back enqueue after an AFTER trigger changes the delivered schedule", async () => {
    const id = await alert();
    await trigger("event_deliveries", "after", "insert", "update event_deliveries set available_at=clock_timestamp()+interval '1 year' where id=new.id; return new;", async () => {
      await assert.rejects(enqueue(id), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 0);
    });
  });
  it("rolls back enqueue after an AFTER witness trigger adds an unauthorized feature", async () => {
    const id = await alert();
    await trigger("delivery_witness_features", "after", "insert", "if pg_trigger_depth()=1 then insert into delivery_witness_features values(new.delivery_id,new.clause_id,'GAS',0) on conflict do nothing; end if; return new;", async () => {
      await assert.rejects(enqueue(id), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 0);
    });
  });
  it("rolls back a runtime generation rewritten by an immediate AFTER trigger", async () => {
    await enqueue(await alert({ metric: "energy_total_kwh" }));
    await trigger("feature_runtime", "after", "insert", "update feature_runtime set generation=99 where building_id=new.building_id and feature_key=new.feature_key; return new;", async () => {
      await assert.rejects(setting("ENERGY_CONSUMPTION", false), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from feature_runtime where building_id=${building}`)[0]!.count, 0);
      assert.equal((await owner`select status from event_deliveries`)[0]!.status, "pending");
    });
  });
  it("rolls back cancellation if an AFTER trigger inserts another ineligible pending delivery", async () => {
    await enqueue(await alert({ metric: "energy_total_kwh" }));
    await trigger("event_deliveries", "after", "update", "if pg_trigger_depth()=1 and new.status='cancelled' then insert into outbox_events(event_type,event_version,building_id,alert_id) select 'alert.raised',1,e.building_id,gen_random_uuid() from outbox_events e where e.id=new.event_id; insert into event_deliveries(event_id,consumer,action) select id,'webhook','alert.raised.v1' from outbox_events where alert_id not in(select id from alerts); end if; return new;", async () => {
      await assert.rejects(setting("ENERGY_CONSUMPTION", false), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from event_deliveries`)[0]!.count, 1);
      assert.equal((await owner`select count(*)::int as count from feature_runtime where building_id=${building}`)[0]!.count, 0);
    });
  });
  it("preserves all prior 021 cursor, daily usage, parking and audited command effects", async () => {
    const profile = randomUUID();
    await owner`insert into monitoring_profiles(id,building_id,device_id,kind) values(${profile},${building},${device},'ENERGY')`;
    await owner`insert into usage_cursors(profile_id,building_id,last_at,last_value,good) values(${profile},${building},clock_timestamp(),1,true)`;
    await owner`insert into daily_usage(profile_id,building_id,day,first_at,last_at) values(${profile},${building},to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),clock_timestamp(),clock_timestamp())`;
    await setting("ENERGY_CONSUMPTION", false);
    assert.equal((await owner`select count(*)::int as count from usage_cursors where profile_id=${profile}`)[0]!.count, 0);
    assert.equal((await owner`select incomplete from daily_usage where profile_id=${profile}`)[0]!.incomplete, true);
    await owner`insert into parking_lots(building_id,vehicle_type,capacity,occupied,source,observed_at) values(${building},'CAR',10,2,'MANUAL',clock_timestamp())`;
    await setting("CAR_PARKING", false);
    assert.deepEqual((await owner`select occupied,observed_at,source,version from parking_lots where building_id=${building}`)[0], { occupied: null, observed_at: null, source: "UNKNOWN", version: 2 });
    await owner`update devices set type='GATE_CONTROLLER' where id=${device}`;
    const gate = randomUUID(), command = randomUUID();
    await owner`insert into gates(id,building_id,name,kind,gateway_id,device_id) values(${gate},${building},'Gate','GARAGE',${gateway},${device})`;
    await owner`insert into gate_commands(id,request_id,gate_id,building_id,gateway_id,device_id,requested_by,expires_at)
      values(${command},${randomUUID()},${gate},${building},${gateway},${device},'notification_admin',clock_timestamp()+interval '10 seconds')`;
    await setting("GARAGE_ACCESS", false);
    assert.deepEqual((await owner`select status,failure_reason from gate_commands where id=${command}`)[0], { status: "FAILED", failure_reason: "Funcionalidade desativada" });
    assert.equal((await owner`select count(*)::int as count from audit_logs where resource_id=${command} and action='ACCESS_COMMAND_CANCELLED_BY_FEATURE'`)[0]!.count, 1);
    // Delivery retry helpers cannot publish or mutate a physical command.
    const client = await runtime();
    await assert.rejects(client`update gate_commands set status='SENT' where id=${command}`, error => (error as { code?: string }).code === "42501");
    assert.equal((await owner`select status from gate_commands where id=${command}`)[0]!.status, "FAILED");
  });
  it("confirms enqueue again after an AFTER witness trigger changes its delivery", async () => {
    const id = await alert();
    await trigger("delivery_witnesses", "after", "insert", "update event_deliveries set status='failed',failure_category='HTTP_PERMANENT' where id=new.delivery_id; return new;", async () => {
      await assert.rejects(enqueue(id), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from outbox_events`)[0]!.count, 0);
    });
  });
  it("confirms claim again after an AFTER attempt trigger changes the reservation", async () => {
    await enqueue(await alert()); const client = await runtime(); await client`select notification_begin_attempt()`;
    await trigger("notification_attempts", "after", "update", "if new.delivery_id is not null then update event_deliveries set claim_token=gen_random_uuid() where id=new.delivery_id; end if; return new;", async () => {
      await assert.rejects(client`select * from notification_claim(1)`, /not persisted/i);
      assert.equal((await owner`select status from event_deliveries`)[0]!.status, "pending");
      assert.equal((await owner`select claim_called from notification_attempts`)[0]!.claim_called, false);
    });
  });
  it("confirms runtime again after an AFTER cancellation trigger changes its generation", async () => {
    await enqueue(await alert({ metric: "energy_total_kwh" }));
    await trigger("event_deliveries", "after", "update", "if new.status='cancelled' then update feature_runtime set generation=99 where building_id=(select building_id from outbox_events where id=new.event_id); end if; return new;", async () => {
      await assert.rejects(setting("ENERGY_CONSUMPTION", false), /not persisted/i);
      assert.equal((await owner`select count(*)::int as count from feature_runtime where building_id=${building}`)[0]!.count, 0);
      assert.equal((await owner`select status from event_deliveries`)[0]!.status, "pending");
    });
  });
  for (const kind of ["device type", "rule metric", "gate binding", "parking binding"] as const) {
    it(`intersects current ${kind} policy with the immutable origin witness`, async () => {
      let id: string;
      if (kind === "device type") id = await alert({ deviceType: "ENERGY_METER" });
      else if (kind === "rule metric") id = await alert({ metric: "energy_total_kwh" });
      else if (kind === "gate binding") {
        await owner`update devices set type='GATE_CONTROLLER' where id=${device}`;
        await owner`insert into gates(building_id,name,kind,gateway_id,device_id) values(${building},'Gate','GARAGE',${gateway},${device})`;
        id = await alert();
      } else {
        await owner`update devices set type='PARKING_SENSOR' where id=${device}`;
        await owner`insert into parking_lots(building_id,vehicle_type,capacity,sensor_id) values(${building},'CAR',10,${device})`;
        id = await alert({ metric: "parking_occupied" });
      }
      const event = await enqueue(id);
      const [original] = await owner`select jsonb_agg(to_jsonb(f) order by clause_id,feature_key) as value from delivery_witness_features f join event_deliveries d on d.id=f.delivery_id where d.event_id=${event}`;
      const newer = kind === "gate binding" ? "PEDESTRIAN_ACCESS" : kind === "parking binding" ? "MOTORCYCLE_PARKING" : "WATER_CONSUMPTION";
      // Disable the NEW branch before rebinding. The origin is still valid;
      // nevertheless the current persisted source policy must reject delivery.
      await setting(newer, false);
      if (kind === "device type") await owner`update devices set type='WATER_METER' where id=${device}`;
      else if (kind === "rule metric") await owner`update alert_rules set metric='water_total_m3' where id=(select rule_id from alerts where id=${id})`;
      else if (kind === "gate binding") await owner`update gates set kind='PEDESTRIAN' where device_id=${device}`;
      else await owner`update parking_lots set vehicle_type='MOTORCYCLE' where sensor_id=${device}`;
      const client = await runtime(); await client`select notification_begin_attempt()`;
      assert.equal((await client`select * from notification_claim(1)`).length, 0);
      assert.equal((await owner`select status from event_deliveries where event_id=${event}`)[0]!.status, "cancelled");
      await client`select notification_end_attempt()`; await setting(newer, true);
      assert.equal((await owner`select status from event_deliveries where event_id=${event}`)[0]!.status, "cancelled");
      assert.deepEqual((await owner`select jsonb_agg(to_jsonb(f) order by clause_id,feature_key) as value from delivery_witness_features f join event_deliveries d on d.id=f.delivery_id where d.event_id=${event}`)[0]!.value, original!.value);
    });
  }
  it("does not invent a fallback witness after its rule is deleted", async () => {
    const id = await alert({ metric: "energy_total_kwh", future: true }); await enqueue(id);
    await owner`delete from alert_rules where id=(select rule_id from alerts where id=${id})`;
    await setting("ENERGY_CONSUMPTION", false);
    // ENERGY_METER fallback still permits ELECTRICAL, but the original rule
    // witnessed ENERGY only. Removing the rule cannot create that alternative.
    assert.equal((await owner`select status from event_deliveries`)[0]!.status, "cancelled");
  });
});
