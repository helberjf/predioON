import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { it, type TestContext } from "node:test";
import Aedes from "aedes";
import type { MqttClient } from "mqtt";

// These transport tests use a real local MQTT broker, but never connect to SQL.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:5436/unused";
const { config } = await import("../src/config.js");
const { connectIngest } = await import("../src/mqtt.js");

const topic = "predio/test/device/sensor/telemetry";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await pause(10);
  }
}
async function fixture(t: TestContext) {
  const broker = new Aedes();
  const server = createServer(broker.handle);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const previous = { url: config.MQTT_URL, clientId: config.MQTT_CLIENT_ID };
  config.MQTT_URL = `mqtt://127.0.0.1:${address.port}`;
  config.MQTT_CLIENT_ID = `ingest-test-${randomUUID()}`;
  const clients: MqttClient[] = [];
  const acknowledged: string[] = [];
  broker.on("ack", packet => { if (packet.topic === topic) acknowledged.push(packet.payload.toString()); });
  t.mock.method(console, "log", () => undefined);
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);
  t.after(async () => {
    await Promise.all(clients.map(client => client.endAsync(true)));
    await new Promise<void>(resolve => broker.close(resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    config.MQTT_URL = previous.url; config.MQTT_CLIENT_ID = previous.clientId;
  });
  return {
    broker, acknowledged, url: config.MQTT_URL, clientId: config.MQTT_CLIENT_ID,
    async connect(handler: (topic: string, payload: Buffer) => Promise<void>) {
      const client = connectIngest(handler);
      clients.push(client);
      client.options.reconnectPeriod = 30;
      let subscribed = false;
      client.on("packetreceive", packet => { if (packet.cmd === "suback") subscribed = true; });
      await until(() => subscribed, "subscription");
      return client;
    },
    publish(payload: string, target = topic) {
      return new Promise<void>((resolve, reject) => broker.publish({ cmd: "publish", qos: 1, retain: false, topic: target, payload: Buffer.from(payload) }, error => error ? reject(error) : resolve()));
    },
  };
}

it("delays QoS1 PUBACK until processing completes and applies backpressure", { timeout: 10_000 }, async t => {
  const f = await fixture(t), first = deferred();
  const started: string[] = [], persisted: string[] = [];
  const client = await f.connect(async (_topic, payload) => {
    const value = payload.toString(); started.push(value);
    if (value === "first") await first.promise;
    persisted.push(value);
  });
  t.after(() => first.resolve());
  assert.equal(client.options.clean, false);
  assert.equal(client.options.queueQoSZero, false, "outbound physical commands remain unqueued");
  await f.publish("first"); await f.publish("second");
  await until(() => started.length > 0, "first processing");
  await pause(60);
  assert.deepEqual(f.acknowledged, [], "broker must retain both packets while persistence is pending");
  assert.deepEqual(started, ["first"], "second message must not process concurrently");
  first.resolve();
  await until(() => f.acknowledged.length === 2, "both acknowledgements");
  assert.deepEqual(persisted, ["first", "second"]);
  assert.deepEqual(f.acknowledged, ["first", "second"]);
});

it("redelivers after a processing failure without acknowledging the failed attempt", { timeout: 10_000 }, async t => {
  const f = await fixture(t), persisted = deferred();
  let attempts = 0;
  await f.connect(async () => {
    attempts++;
    if (attempts === 1) throw new Error("Database transaction failed");
    await persisted.promise;
  });
  t.after(() => persisted.resolve());
  await f.publish("retry-after-failure");
  await until(() => attempts === 2, "broker redelivery after reconnect");
  assert.deepEqual(f.acknowledged, []);
  persisted.resolve();
  await until(() => f.acknowledged.length === 1, "acknowledgement after recovery");
  assert.equal(attempts, 2);
});

it("does not let a late completion acknowledge a packet on a replacement connection", { timeout: 10_000 }, async t => {
  const f = await fixture(t), old = deferred(), replacement = deferred();
  let attempts = 0, reconnects = 0;
  const client = await f.connect(async () => {
    attempts++;
    await (attempts === 1 ? old.promise : replacement.promise);
  });
  t.after(() => { old.resolve(); replacement.resolve(); });
  client.on("connect", () => { reconnects++; });
  await f.publish("same-message-id");
  await until(() => attempts === 1, "pending old connection");
  client.stream.destroy();
  await until(() => reconnects === 1, "replacement connection");
  old.resolve();
  await until(() => attempts === 2, "replacement processing");
  await pause(60);
  assert.deepEqual(f.acknowledged, [], "the old callback must never ACK on the new stream");
  replacement.resolve();
  await until(() => f.acknowledged.length === 1, "replacement acknowledgement");
});

it("drops and acknowledges malformed gateway JSON while continuing with the next message", async t => {
  const { handleGatewayStatus } = await import("../src/pipeline/gateway-status.js");
  await assert.doesNotReject(handleGatewayStatus("predio/test/gateway/gw/status", Buffer.from("{broken-json")));
  const f = await fixture(t), statusTopic = "predio/test/gateway/gw/status";
  let malformedAcknowledged = 0, subsequentProcessed = false;
  f.broker.on("ack", packet => { if (packet.topic === statusTopic) malformedAcknowledged++; });
  await f.connect(async (incomingTopic, payload) => {
    if (incomingTopic === statusTopic) await handleGatewayStatus(incomingTopic, payload);
    else subsequentProcessed = true;
  });
  await f.publish("{broken-json", statusTopic);
  await f.publish("next-message");
  await until(() => f.acknowledged.length === 1, "message after malformed status");
  assert.equal(malformedAcknowledged, 1);
  assert.equal(subsequentProcessed, true);
});

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

for (const crashPoint of ["before-persist", "after-persist"] as const) {
  it(`redelivers after receiver process termination ${crashPoint} without duplicating a durable receipt`, { timeout: 15_000 }, async t => {
    const f = await fixture(t);
    const work = fileURLToPath(new URL("../../../../work/", import.meta.url));
    await mkdir(work, { recursive: true });
    const directory = await mkdtemp(join(work, "mqtt-crash-"));
    const ledger = join(directory, "receipts.txt");
    const children: ChildProcess[] = [];
    t.after(async () => {
      await Promise.all(children.map(stopChild));
      await rm(ledger, { force: true });
      await rmdir(directory);
    });
    function launch(mode: string) {
      const messages: Array<{ kind: string }> = [];
      const child = fork(new URL("./fixtures/mqtt-crash-receiver.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { ...process.env, MQTT_URL: f.url, MQTT_CLIENT_ID: f.clientId, MQTT_TEST_LEDGER: ledger, MQTT_TEST_CRASH_POINT: mode },
      });
      children.push(child);
      child.on("message", message => messages.push(message as { kind: string }));
      return { child, messages };
    }
    const original = launch(crashPoint);
    await until(() => original.messages.some(message => message.kind === "ready"), "child subscription");
    await f.publish("durable-event");
    const reached = crashPoint === "before-persist" ? "received" : "persisted";
    await until(() => original.messages.some(message => message.kind === reached), "crash boundary");
    await pause(60);
    assert.deepEqual(f.acknowledged, [], "incomplete callback must leave the broker receipt outstanding");
    await stopChild(original.child);
    const recovered = launch("complete");
    await until(() => f.acknowledged.length === 1, "redelivery to replacement process");
    assert.ok(recovered.messages.some(message => message.kind === "received"));
    assert.deepEqual((await readFile(ledger, "utf8")).trim().split("\n"), ["durable-event"]);
    await stopChild(recovered.child);
  });
}
