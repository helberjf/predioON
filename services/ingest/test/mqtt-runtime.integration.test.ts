import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { describe, it, type TestContext } from "node:test";
import Aedes from "aedes";
import { telemetryTopic } from "@predioon/shared";
import { adminSession, sqlClient as owner } from "./fixtures/observation-admin.js";

// QoS1 delivery against real PostgreSQL: the broker receipt (PUBACK) is released
// only after the source transaction commits, a receiver killed before the commit
// leaves nothing behind, and one killed after it is redelivered without duplicates.
// The receiver is a separate process holding only the two restricted logins.
const BUILDING = "bld_001", DEVICE = "water_01";
const topic = telemetryTopic(BUILDING, DEVICE);

async function until(check: () => boolean | Promise<boolean>, label: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await pause(25);
  }
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

async function scenario(t: TestContext) {
  const broker = new Aedes();
  const server = createServer(broker.handle);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `mqtt://127.0.0.1:${address.port}`, clientId = `ingest-runtime-${randomUUID()}`;
  const acknowledged: string[] = [];
  broker.on("ack", packet => { if (packet && "topic" in packet && packet.topic === topic) acknowledged.push(packet.payload.toString()); });
  const children: ChildProcess[] = [];
  const [rule] = await owner`insert into alert_rules(building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template)
    values(${BUILDING},${DEVICE},${`mqtt-runtime-${randomUUID()}`},'water_level_percent','LT',20,'HIGH','LOW_WATER_LEVEL','Nível {value}%') returning id`;
  t.after(async () => {
    await Promise.all(children.map(stopChild));
    await new Promise<void>(resolve => broker.close(resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await owner`delete from alert_rules where id=${rule!.id}`;
  });
  return {
    acknowledged,
    launch(mode: "complete" | "after-commit") {
      const messages: string[] = [];
      let stderr = "";
      // Only what the runtime needs: no owner URL, no administrative fixture variable.
      const env: Record<string, string> = { MQTT_URL: url, MQTT_CLIENT_ID: clientId, MQTT_TEST_CRASH_POINT: mode,
        DATABASE_URL_INGEST: process.env.DATABASE_URL_INGEST!, DATABASE_URL_ACCESS_SERVICE: process.env.DATABASE_URL_ACCESS_SERVICE! };
      for (const key of ["PATH", "HOME", "TZ", "SystemRoot", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key]!;
      const child = fork(new URL("./fixtures/mqtt-runtime-receiver.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"], env,
      });
      child.stderr?.on("data", chunk => { stderr += chunk; });
      child.on("message", message => messages.push((message as { kind: string }).kind));
      children.push(child);
      return { child, messages, stderr: () => stderr };
    },
    publish(eventId: string, value: number) {
      const payload = { schemaVersion: 1, eventId, buildingId: BUILDING, deviceId: DEVICE, metric: "water_level_percent",
        value, unit: "%", quality: "GOOD", timestamp: new Date().toISOString() };
      return new Promise<void>((resolve, reject) => broker.publish({ cmd: "publish", qos: 1, retain: false, dup: false, topic,
        payload: Buffer.from(JSON.stringify(payload)) }, error => error ? reject(error) : resolve()));
    },
    async counts(eventId: string) {
      const [row] = await owner`select
        (select count(*)::int from telemetry where event_id=${eventId} and building_id=${BUILDING}) as readings,
        (select count(*)::int from ingest_events where event_id=${eventId} and building_id=${BUILDING}) as receipts,
        (select count(*)::int from alerts where rule_id=${rule!.id}) as alerts,
        (select count(*)::int from outbox_events e join alerts a on a.id=e.alert_id where a.rule_id=${rule!.id}) as events`;
      return { ...row };
    },
  };
}

describe("MQTT QoS1 durability with the restricted ingestion login", { concurrency: false }, () => {
  it("withholds PUBACK until commit and rolls everything back when the receiver dies before it", { timeout: 60_000 }, async t => {
    const f = await scenario(t);
    const eventId = randomUUID(), lockKey = randomInt(1, 2 ** 31 - 1), name = `mqtt_runtime_hold_${randomUUID().replaceAll("-", "")}`;
    // A trigger parks the receiver's transaction after its receipt write, before commit.
    await owner.unsafe(`create function public.${name}() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
      begin if new.event_id::text = '${eventId}' then perform pg_advisory_xact_lock(${lockKey}); end if; return new; end $$`);
    await owner.unsafe(`create trigger ${name} after insert on public.ingest_events for each row execute function public.${name}()`);
    const locker = adminSession();
    t.after(async () => {
      await locker.end({ timeout: 0 });
      await owner.unsafe(`drop trigger if exists ${name} on public.ingest_events`);
      await owner.unsafe(`drop function if exists public.${name}()`);
    });
    await locker`select pg_advisory_lock(${lockKey})`;
    const original = f.launch("complete");
    await until(() => original.messages.includes("ready"), `receiver subscription ${original.stderr()}`, 20_000);
    await f.publish(eventId, 10);
    let pid = 0;
    await until(async () => {
      const [row] = await owner`select pid from pg_stat_activity where usename='predioon_ingest' and wait_event_type='Lock' and wait_event='advisory' limit 1`;
      pid = row?.pid ?? 0; return pid > 0;
    }, "receiver transaction parked before commit");
    await pause(100);
    assert.deepEqual(f.acknowledged, [], "no PUBACK while the source transaction is uncommitted");
    assert.deepEqual(await f.counts(eventId), { readings: 0, receipts: 0, alerts: 0, events: 0 }, "uncommitted writes are invisible");
    await stopChild(original.child);
    await locker`select pg_advisory_unlock(${lockKey})`;
    // The orphaned backend finishes the statement, finds its client gone and rolls back.
    await until(async () => (await owner`select count(*)::int as n from pg_stat_activity where pid=${pid}`)[0]!.n === 0, "orphaned backend rollback");
    assert.deepEqual(await f.counts(eventId), { readings: 0, receipts: 0, alerts: 0, events: 0 }, "the killed attempt left nothing behind");
    const recovered = f.launch("complete");
    await until(() => f.acknowledged.length === 1, `broker redelivery to the replacement ${recovered.stderr()}`, 20_000);
    assert.ok(recovered.messages.includes("committed"));
    assert.deepEqual(await f.counts(eventId), { readings: 1, receipts: 1, alerts: 1, events: 1 });
  });

  it("redelivers a committed reading whose PUBACK was lost without duplicating any durable effect", { timeout: 60_000 }, async t => {
    const f = await scenario(t);
    const eventId = randomUUID();
    const original = f.launch("after-commit");
    await until(() => original.messages.includes("ready"), `receiver subscription ${original.stderr()}`, 20_000);
    await f.publish(eventId, 10);
    await until(() => original.messages.includes("committed"), "source transaction commit");
    await pause(100);
    assert.deepEqual(f.acknowledged, [], "the callback never returned, so the broker still owns the message");
    assert.deepEqual(await f.counts(eventId), { readings: 1, receipts: 1, alerts: 1, events: 1 });
    await stopChild(original.child);
    const recovered = f.launch("complete");
    await until(() => f.acknowledged.length === 1, `broker redelivery to the replacement ${recovered.stderr()}`, 20_000);
    assert.ok(recovered.messages.includes("received"), "the replacement received the redelivered reading");
    assert.deepEqual(await f.counts(eventId), { readings: 1, receipts: 1, alerts: 1, events: 1 }, "deduplicated by the receipt, no second alert or outbox event");
  });
});
