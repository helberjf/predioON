import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import postgres from "postgres";
import { baseline } from "../../../packages/db/src/baseline-schema.js";
import { applyInfrastructure, loadInfrastructureMigrations } from "../../../packages/db/src/infrastructure-migrations.js";
import { notificationAttemptFactory } from "../src/database.js";
import { runNotificationAttempt } from "../src/protocol.js";

const adminUrl = process.env.TEST_NOTIFICATION_DATABASE_URL;

describe("notification worker SQL/HTTP/process recovery, isolated real database", { skip: !adminUrl, concurrency: false, timeout: 180_000 }, () => {
  const database = `notification_worker_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID();
  let admin: postgres.Sql, owner: postgres.Sql, workerUrl: string;
  let building = "", device = "", gateway = "";
  const servers: Server[] = [];
  const clients: postgres.Sql[] = [];
  const processes: ChildProcess[] = [];

  const factory = () => notificationAttemptFactory(onclose => {
    const client = postgres(workerUrl, { max: 1, idle_timeout: 0, connect_timeout: 5, onclose, onnotice: () => {} });
    clients.push(client); return client;
  });
  async function endpoint(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
    const server = createServer(handler); servers.push(server);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}/alerts`;
  }
  async function enqueue(severity = "HIGH") {
    const id = randomUUID();
    await owner.begin(async tx => {
      await tx`insert into alerts(id,building_id,device_id,severity,type,message,triggered_at)
        values(${id},${building},${device},${severity}::alert_severity,'DEVICE_OFFLINE','private synthetic alert',clock_timestamp())`;
      await tx`select notification_enqueue_alert(${id}::uuid)`;
    });
    return id;
  }
  async function state() {
    const rows = await owner`select status,attempts,failure_category,claim_token,lease_until,
      extract(epoch from available_at-updated_at)::integer as delay_seconds from event_deliveries order by created_at`;
    assert.equal(rows.length, 1); return rows[0]!;
  }
  async function workerBackend() {
    const rows = await owner`select a.backend_pid as pid,s.state,s.xact_start,s.usename,
      exists(select 1 from pg_locks l where l.pid=a.backend_pid and l.locktype='advisory' and l.classid=814772 and l.objid=1 and l.mode='ShareLock' and l.granted) as barrier
      from notification_attempts a join pg_stat_activity s on s.pid=a.backend_pid and s.backend_start=a.backend_start`;
    assert.equal(rows.length, 1); return rows[0]!;
  }
  async function helper(signature: string, replacement: string, run: () => Promise<void>) {
    const original = (await owner`select pg_get_functiondef(${signature}::regprocedure) as ddl`)[0]!.ddl as string;
    await owner.unsafe(replacement);
    try { await run(); } finally { await owner.unsafe(original); }
  }
  before(async () => {
    assert.equal(process.env.TEST_NOTIFICATION_DISPOSABLE_DB, "1", "Only an explicitly disposable cluster may change the runtime login");
    assert.match(new URL(adminUrl!).hostname, /^(localhost|127\.0\.0\.1)$/);
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${database}"`);
    const url = new URL(adminUrl!); url.pathname = `/${database}`;
    owner = postgres(url.toString(), { max: 3, onnotice: () => {} });
    await owner.unsafe(baseline); await applyInfrastructure(owner, await loadInfrastructureMigrations());
    const [statement] = await owner`select format('alter role predioon_notifications login password %L',${password}::text) as ddl`;
    await owner.unsafe(statement!.ddl as string);
    url.username = "predioon_notifications"; url.password = password; workerUrl = url.toString();
    await owner`insert into users(id,email,name,is_platform_admin) values('notification_worker_admin','notification-worker@example.invalid','Fixture admin',true)`;
  });
  beforeEach(async () => {
    await owner`truncate notification_attempts,delivery_witness_features,delivery_witnesses,event_deliveries,outbox_events cascade`;
    const id = randomUUID(); building = `notification_worker_b_${id}`; device = `notification_worker_d_${id}`; gateway = `notification_worker_g_${id}`;
    await owner`insert into organizations(id,name,slug) values(${id},'Fixture',${id})`;
    await owner`insert into buildings(id,organization_id,name,code) values(${building},${id},'Fixture',${id})`;
    await owner`insert into gateways(id,building_id,name,serial_number) values(${gateway},${building},'Gateway',${id})`;
    await owner`insert into devices(id,building_id,gateway_id,type,name) values(${device},${building},${gateway},'ENERGY_METER','Fixture')`;
  });
  afterEach(async () => {
    for (const child of processes.splice(0)) if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
    await Promise.all(clients.splice(0).map(client => client.end({ timeout: 0 })));
    await Promise.all(servers.splice(0).map(server => { server.closeAllConnections(); return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }));
  });
  after(async () => {
    await owner?.end({ timeout: 0 });
    if (admin) {
      await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname=${database} and pid<>pg_backend_pid()`;
      await admin.unsafe(`drop database if exists "${database}"`); await admin.end({ timeout: 0 });
    }
  });

  it("delivers one real POST with stable identity while backend is idle outside a transaction", async () => {
    const alert = await enqueue(); let posts = 0; let checked: Promise<void> | undefined;
    const url = await endpoint((req, res) => {
      posts++; let body = ""; req.setEncoding("utf8"); req.on("data", (chunk: string) => { body += chunk; });
      req.on("end", () => { checked = (async () => {
        const parsed = JSON.parse(body); assert.equal(parsed.alertId, alert); assert.equal(parsed.deviceId, device);
        assert.equal(parsed.buildingId, building); assert.equal(parsed.message, "private synthetic alert");
        const event = (await owner`select id from outbox_events`)[0]!.id;
        assert.equal(req.headers["idempotency-key"], `${event}/webhook/alert.raised.v1`);
        const backend = await workerBackend(); assert.equal(backend.state, "idle"); assert.equal(backend.xact_start, null);
        assert.equal(backend.usename, "predioon_notifications"); assert.equal(backend.barrier, true);
        res.writeHead(204); res.end();
      })().catch(error => { res.destroy(); throw error; }); });
    });
    assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), "delivered");
    await checked; assert.equal(posts, 1); assert.equal((await state()).status, "delivered");
    assert.equal((await owner`select count(*)::integer as n from notification_attempts`)[0]!.n, 0);
  });

  it("two workers never send the same live reservation concurrently", async () => {
    await enqueue(); let posts = 0; let entered!: () => void; const observed = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const url = await endpoint((req, res) => { posts++; req.resume(); entered(); void held.then(() => { res.writeHead(204); res.end(); }); });
    const first = runNotificationAttempt(factory(), new AbortController().signal, url);
    await observed;
    const second = await runNotificationAttempt(factory(), new AbortController().signal, url);
    release(); assert.equal(await first, "delivered"); assert.equal(second, "empty"); assert.equal(posts, 1);
  });

  it("HTTP statuses persist retry/permanent outcomes with bounded delay and no inline resend", async () => {
    await enqueue(); let posts = 0; let status = 500;
    const url = await endpoint((req, res) => { posts++; req.resume(); res.writeHead(status, { "Retry-After": "999999999" }); res.end(); });
    for (status of [500, 429, 503, 403]) {
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), status === 403 ? "failed" : "retry");
      const result = await state(); assert.equal(result.attempts, posts);
      assert.equal(result.claim_token, null); assert.equal(result.lease_until, null);
      if (status === 500) assert.equal(result.delay_seconds, 5);
      else if (status === 429 || status === 503) assert.equal(result.delay_seconds, 300);
      await owner`update event_deliveries set available_at=clock_timestamp()-interval '1 second'`;
    }
    assert.equal(posts, 4); assert.equal((await state()).failure_category, "HTTP_PERMANENT");
  });

  it("missing destination becomes explicit terminal state without a webhook", async () => {
    await enqueue(); assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, undefined), "no_destination");
    const result = await state(); assert.equal(result.status, "no_destination"); assert.equal(result.failure_category, "NO_DESTINATION");
    assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, undefined), "empty");
  });

  it("low severity records an immutable event without creating a delivery", async () => {
    await enqueue("LOW"); assert.equal((await owner`select count(*)::integer as n from outbox_events`)[0]!.n, 1);
    assert.equal((await owner`select count(*)::integer as n from event_deliveries`)[0]!.n, 0);
    assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, "http://127.0.0.1:1"), "empty");
  });

  it("exclusive feature pause waits for HTTP then cancels pending work without resurrection", async () => {
    // ENERGY_METER uses ANY(ENERGY_CONSUMPTION,ELECTRICAL). Make energy
    // the sole original witness; pausing one still-enabled alternative would
    // correctly keep this alert eligible and must not be asserted cancelled.
    await owner`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'ELECTRICAL',false)`;
    await enqueue(); let entered!: () => void; const observed = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const url = await endpoint((req, res) => { req.resume(); entered(); void held.then(() => { res.writeHead(204); res.end(); }); });
    const attempt = runNotificationAttempt(factory(), new AbortController().signal, url); await observed;
    let finished = false;
    const pause = owner.begin(async tx => {
      await tx`select set_config('app.user_id','notification_worker_admin',true)`;
      await tx`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'ENERGY_CONSUMPTION',false)`;
      await tx`select app_apply_feature_transition(${building},'ENERGY_CONSUMPTION',false)`;
    }).then(() => { finished = true; });
    const deadline = Date.now() + 5_000; let blocked = false;
    while (Date.now() < deadline) {
      if ((await owner`select count(*)::integer as n from pg_stat_activity where datname=${database} and wait_event_type='Lock'`)[0]!.n > 0) { blocked = true; break; }
      await delay(20);
    }
    assert.equal(blocked, true, "Pause must actually wait on the session barrier");
    assert.equal(finished, false); release(); assert.equal(await attempt, "delivered"); await pause;
    await enqueue(); assert.equal((await owner`select status from event_deliveries order by created_at desc limit 1`)[0]!.status, "cancelled");
    assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), "empty");
  });

  it("backend termination during pending HTTP aborts and never confirms via a replacement connection", async () => {
    await enqueue(); let checked: Promise<void> | undefined;
    const url = await endpoint((req, res) => { req.resume(); checked = (async () => {
      const backend = await workerBackend(); await owner`select pg_terminate_backend(${backend.pid})`;
      // Keep HTTP pending. Closing its socket here races the DB close event and
      // tests a separate network error instead of database-triggered cancellation.
    })(); });
    const result = await runNotificationAttempt(factory(), new AbortController().signal, url);
    await checked; assert.equal(result, "aborted"); assert.equal((await state()).status, "inflight");
    assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, undefined), "empty");
  });

  it("residual stacked session lock makes end fail, destroys the client and releases all locks", async () => {
    await enqueue(); let pid = 0;
    await owner`create function notification_worker_stack() returns trigger language plpgsql as $$ begin
      if new.status='delivered' then perform pg_advisory_lock_shared(814772,1); end if; return new; end $$`;
    await owner`create trigger notification_worker_stack after update on event_deliveries for each row execute function notification_worker_stack()`;
    try {
      const url = await endpoint((req, res) => { req.resume(); void (async () => { pid = (await workerBackend()).pid; res.writeHead(204); res.end(); })(); });
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), "database_error");
      assert.ok(pid > 0); assert.equal((await owner`select count(*)::integer as n from pg_locks where pid=${pid}`)[0]!.n, 0);
      assert.equal((await state()).status, "delivered");
      // A new backend cleans the dead attempt, but never sends the delivered event again.
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, undefined), "empty");
      assert.equal((await owner`select count(*)::integer as n from notification_attempts`)[0]!.n, 0);
    } finally { await owner`drop trigger notification_worker_stack on event_deliveries`; await owner`drop function notification_worker_stack()`; }
  });

  it("unconfirmed end DELETE destroys the connection instead of returning its reserve", async () => {
    await enqueue(); let pid = 0;
    await owner`create function notification_worker_skip() returns trigger language plpgsql as $$ begin return null; end $$`;
    await owner`create trigger notification_worker_skip before delete on notification_attempts for each row execute function notification_worker_skip()`;
    try {
      const url = await endpoint((req, res) => { req.resume(); void (async () => { pid = (await workerBackend()).pid; res.writeHead(204); res.end(); })(); });
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), "database_error");
      assert.equal((await owner`select count(*)::integer as n from pg_locks where pid=${pid}`)[0]!.n, 0);
    } finally { await owner`drop trigger notification_worker_skip on notification_attempts`; await owner`drop function notification_worker_skip()`; }
  });

  it("malformed real SQL helper rows never authorize an HTTP send", async () => {
    await enqueue(); let posts = 0;
    const request: typeof fetch = async () => { posts++; return new Response(null, { status: 204 }); };
    await helper("notification_claim(integer)", `create or replace function notification_claim(batch_limit integer default 1)
      returns table(delivery_id uuid,event_id uuid,claim_token uuid,lease_until timestamptz)
      language sql security definer set search_path=public,pg_temp as $$ select null::uuid,null::uuid,null::uuid,clock_timestamp() $$`, async () => {
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, "https://fixture.invalid", request), "database_error");
    });
    assert.equal(posts, 0); assert.equal((await state()).status, "pending");
  });

  it("forged owner connection is rejected before any barrier, claim or HTTP", async () => {
    await enqueue(); let posts = 0;
    const wrong = notificationAttemptFactory(onclose => {
      const url = new URL(adminUrl!); url.pathname = `/${database}`;
      const client = postgres(url.toString(), { max: 1, onclose, onnotice: () => {} }); clients.push(client); return client;
    });
    assert.equal(await runNotificationAttempt(wrong, new AbortController().signal, "https://fixture.invalid", async () => { posts++; return new Response(null, { status: 204 }); }), "database_error");
    assert.equal(posts, 0); assert.equal((await state()).status, "pending");
    assert.equal((await owner`select count(*)::integer as n from notification_attempts`)[0]!.n, 0);
  });

  it("a killed real worker recovers persisted work after lease expiry using the same idempotency key", async () => {
    await enqueue(); const keys: string[] = []; let effect!: () => void; const observed = new Promise<void>(resolve => { effect = resolve; });
    let child: ChildProcess;
    const url = await endpoint((req, res) => {
      req.resume(); keys.push(req.headers["idempotency-key"] as string);
      if (keys.length === 1) { child.kill("SIGKILL"); effect(); }
      else { res.writeHead(204); res.end(); }
    });
    const directory = await mkdtemp(join(tmpdir(), "predioon-worker-crash-"));
    const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    child = spawn(process.execPath, ["--import", "tsx", entry], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL_NOTIFICATIONS: workerUrl, ALERT_WEBHOOK_URL: url,
        NOTIFICATION_HEALTH_FILE: join(directory, "health.json") }, stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child); const exited = once(child, "exit"); let output = "";
    child.stdout!.on("data", chunk => { output += chunk.toString(); }); child.stderr!.on("data", chunk => { output += chunk.toString(); });
    try {
      await Promise.race([observed, exited.then(() => { throw new Error("Worker exited before its HTTP attempt"); }), delay(10_000).then(() => { throw new Error("Worker did not reach HTTP"); })]);
      await exited;
      assert.equal((await state()).status, "inflight");
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), "empty");
      // This is real database time and the real 20s lease, without editing lease rows.
      await delay(20_500);
      assert.equal(await runNotificationAttempt(factory(), new AbortController().signal, url), "delivered");
      assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal((await state()).attempts, 2);
      assert.equal(output.includes(password), false); assert.equal(output.includes("private synthetic alert"), false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
      assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("predioon-worker-crash-"));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
