import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test, type TestContext } from "node:test";
import type { MqttClient } from "mqtt";
import type { StartupDependencies } from "../src/startup.js";

async function startup() {
  assert.ok(existsSync(new URL("../src/startup.ts", import.meta.url)), "pure startup module must exist");
  return (await import("../src/startup.js")).startIngestRuntime;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const secretFailure = () => new Error("postgres://owner:STARTUP_SECRET@fixture/predioon");
const sanitized = (message: string) => (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.equal(error.message, message);
  assert.equal(error.cause, undefined);
  assert.ok(!/STARTUP_SECRET|postgres:\/\//.test(error.message));
  return true;
};
const startupError = "Não foi possível iniciar o runtime de ingestão";
const shutdownError = "Não foi possível encerrar o runtime de ingestão";

function fixture(t: TestContext) {
  const events: string[] = [];
  let offlineTicks = 0;
  let timer: NodeJS.Timeout | undefined;
  let finishMqtt: ((error?: Error) => void) | undefined;
  const client = {
    end: (force: boolean, callback: (error?: Error) => void) => {
      assert.equal(force, false, "MQTT shutdown must remain graceful");
      events.push("mqtt-end");
      finishMqtt = callback;
      return client;
    },
  } as unknown as MqttClient;
  const dependencies: StartupDependencies = {
    verifyIngest: async () => { events.push("verify-ingest"); },
    verifyAccess: async () => { events.push("verify-access"); },
    connect: () => { events.push("connect"); return client; },
    startOffline: () => {
      events.push("offline-start");
      timer = setInterval(() => { offlineTicks++; }, 10);
      return timer;
    },
    startAccess: actual => {
      assert.equal(actual, client);
      events.push("access-start");
      return () => { events.push("access-stop"); };
    },
    closeDatabases: async () => { events.push("databases-close"); },
  };
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => { if (timer) clearInterval(timer); });
  return { events, dependencies, client, finishMqtt: (error?: Error) => {
    assert.ok(finishMqtt, "MQTT must have been asked to close");
    finishMqtt(error);
  }, offlineTicks: () => offlineTicks };
}

for (const failing of ["verifyIngest", "verifyAccess"] as const) {
  test(`closes pools when ${failing} fails without starting MQTT or timers`, async t => {
    const start = await startup();
    const f = fixture(t);
    f.dependencies[failing] = async () => { f.events.push(failing); throw secretFailure(); };
    await assert.rejects(start(f.dependencies), sanitized(startupError));
    assert.equal(f.events.filter(event => event === "databases-close").length, 1);
    assert.ok(!f.events.some(event => ["connect", "offline-start", "access-start"].includes(event)));
  });
}

test("waits for the other verifier to settle before closing pools after a partial failure", async t => {
  const start = await startup();
  const f = fixture(t);
  const ingest = deferred();
  const access = deferred();
  f.dependencies.verifyIngest = () => ingest.promise;
  f.dependencies.verifyAccess = () => access.promise;
  const running = start(f.dependencies);
  const rejected = assert.rejects(running, sanitized(startupError));
  ingest.reject(secretFailure());
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(f.events, [], "pending identity query must keep its pools open and effects stopped");
  access.resolve();
  await rejected;
  assert.deepEqual(f.events, ["databases-close"]);
});

test("starts effects only after both identities pass and fully shuts them down", async t => {
  const start = await startup();
  const f = fixture(t);
  const ingest = deferred();
  const access = deferred();
  f.dependencies.verifyIngest = () => ingest.promise;
  f.dependencies.verifyAccess = () => access.promise;
  const running = start(f.dependencies);
  ingest.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(f.events, []);
  access.resolve();
  const shutdown = await running;
  assert.deepEqual(f.events, ["connect", "offline-start", "access-start"]);
  t.mock.timers.tick(10);
  assert.equal(f.offlineTicks(), 1);
  const closing = shutdown();
  assert.ok(f.events.includes("access-stop"));
  assert.ok(f.events.includes("mqtt-end"));
  assert.ok(!f.events.includes("databases-close"), "pools remain available until graceful MQTT completion");
  t.mock.timers.tick(100);
  assert.equal(f.offlineTicks(), 1, "offline sweeper must stop before MQTT completion");
  f.finishMqtt();
  await closing;
  assert.equal(f.events.at(-1), "databases-close");
});

test("sanitizes pool close failures on identity failure", async t => {
  const start = await startup();
  const f = fixture(t);
  f.dependencies.verifyIngest = async () => { throw secretFailure(); };
  f.dependencies.closeDatabases = async () => { f.events.push("databases-close"); throw secretFailure(); };
  await assert.rejects(start(f.dependencies), sanitized(startupError));
  assert.deepEqual(f.events, ["verify-access", "databases-close"]);
});

test("runs the other verifier even if one throws synchronously", async t => {
  const start = await startup();
  const f = fixture(t);
  f.dependencies.verifyIngest = () => { throw secretFailure(); };
  await assert.rejects(start(f.dependencies), sanitized(startupError));
  assert.deepEqual(f.events, ["verify-access", "databases-close"]);
});

for (const failing of ["connect", "startOffline", "startAccess"] as const) {
  test(`cleans up created resources if ${failing} throws`, async t => {
    const start = await startup();
    const f = fixture(t);
    f.dependencies[failing] = () => { f.events.push(failing + "-failure"); throw secretFailure(); };
    const running = start(f.dependencies);
    const rejected = assert.rejects(running, sanitized(startupError));
    await new Promise<void>(resolve => setImmediate(resolve));
    if (failing !== "connect") f.finishMqtt();
    await rejected;
    assert.equal(f.events.at(-1), "databases-close");
    assert.equal(f.events.filter(event => event === "databases-close").length, 1);
    t.mock.timers.tick(100);
    assert.equal(f.offlineTicks(), 0);
  });
}

for (const failing of ["MQTT callback", "MQTT throw", "dispatcher", "databases"] as const) {
  test(`finishes cleanup and sanitizes a ${failing} shutdown error`, async t => {
    const start = await startup();
    const f = fixture(t);
    if (failing === "MQTT throw") f.client.end = (() => { f.events.push("mqtt-end"); throw secretFailure(); }) as MqttClient["end"];
    if (failing === "dispatcher") f.dependencies.startAccess = () => () => { f.events.push("access-stop"); throw secretFailure(); };
    if (failing === "databases") f.dependencies.closeDatabases = async () => { f.events.push("databases-close"); throw secretFailure(); };
    const shutdown = await start(f.dependencies);
    const closing = shutdown();
    const rejected = assert.rejects(closing, sanitized(shutdownError));
    if (failing !== "MQTT throw") f.finishMqtt(failing === "MQTT callback" ? secretFailure() : undefined);
    await rejected;
    assert.equal(f.events.at(-1), "databases-close");
    assert.ok(f.events.includes("access-stop"));
    t.mock.timers.tick(100);
    assert.equal(f.offlineTicks(), 0);
  });
}

test("duplicate shutdown calls share one cleanup without repeating effects", async t => {
  const start = await startup();
  const f = fixture(t);
  const shutdown = await start(f.dependencies);
  const first = shutdown();
  const second = shutdown();
  assert.equal(first, second);
  f.finishMqtt();
  await Promise.all([first, second]);
  await shutdown();
  for (const event of ["access-stop", "mqtt-end", "databases-close"]) {
    assert.equal(f.events.filter(value => value === event).length, 1, event);
  }
});

test("keeps the pools until an in-flight access dispatch finishes during shutdown", async t => {
  const start = await startup();
  const f = fixture(t);
  const dispatch = deferred();
  f.dependencies.startAccess = () => { f.events.push("access-start"); return () => { f.events.push("access-stop"); return dispatch.promise; }; };
  const shutdown = await start(f.dependencies);
  const closing = shutdown();
  assert.ok(f.events.includes("mqtt-end"), "MQTT shutdown still begins at once");
  f.finishMqtt();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(!f.events.includes("databases-close"), "a dispatch may still record its publish failure");
  dispatch.resolve();
  await closing;
  assert.equal(f.events.at(-1), "databases-close");
});

test("stops the liveness heartbeat before closing the pools it pings", async t => {
  const start = await startup();
  const f = fixture(t);
  let finishBeat!: () => void;
  f.dependencies.startHeartbeat = actual => {
    assert.equal(actual, f.client);
    f.events.push("heartbeat-start");
    return () => { f.events.push("heartbeat-stop"); return new Promise<void>(resolve => { finishBeat = resolve; }); };
  };
  const shutdown = await start(f.dependencies);
  assert.deepEqual(f.events, ["verify-ingest", "verify-access", "connect", "offline-start", "access-start", "heartbeat-start"]);
  const closing = shutdown();
  assert.equal(f.events[6], "heartbeat-stop", "stopped first");
  f.finishMqtt();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(!f.events.includes("databases-close"), "a check still running keeps the pools open");
  finishBeat();
  await closing;
  assert.equal(f.events.at(-1), "databases-close");
});

