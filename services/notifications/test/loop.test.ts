import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { test } from "node:test";
import { NotificationWakeup, notificationLoop } from "../src/loop.js";
import { healthyHeartbeat, removeHeartbeat, writeHeartbeat } from "../src/heartbeat.js";

test("lost NOTIFY is recovered by a timed poll", async () => {
  const wake = new NotificationWakeup();
  const start = performance.now();
  await wake.wait(new AbortController().signal, 20);
  assert.ok(performance.now() - start >= 10);
});

test("NOTIFY wakes idle workers and bursts coalesce instead of creating a send queue", async () => {
  const wake = new NotificationWakeup();
  const idle = wake.wait(new AbortController().signal, 5_000);
  wake.notify(); await idle;
  for (let i = 0; i < 100; i++) wake.notify();
  await wake.wait(new AbortController().signal, 5_000);
  // The entire burst was consumed as one hint. The next wait must time out.
  const start = performance.now(); await wake.wait(new AbortController().signal, 20);
  assert.ok(performance.now() - start >= 10);
});

test("shutdown interrupts an idle wait promptly", async () => {
  const wake = new NotificationWakeup(); const stop = new AbortController();
  const idle = wake.wait(stop.signal, 5_000); stop.abort(); await idle;
});

test("loop never overlaps attempts and stops after an in-progress attempt closes", async () => {
  const stop = new AbortController(); const wake = new NotificationWakeup();
  let active = 0; let runs = 0; let records = 0;
  await notificationLoop(stop.signal, wake, async () => {
    assert.equal(active, 0); active++; runs++;
    await new Promise<void>(resolve => setImmediate(resolve));
    active--; if (runs === 3) stop.abort(); return "delivered";
  }, async () => { assert.equal(active, 0); records++; });
  assert.equal(runs, 3); assert.equal(records, 3);
});

test("database errors enter idle recovery instead of immediate repeated requests", async () => {
  const stop = new AbortController(); const wake = new NotificationWakeup(); let runs = 0;
  const loop = notificationLoop(stop.signal, wake, async () => { runs++; return "database_error"; }, async () => {});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(runs, 1); stop.abort(); await loop;
});

test("heartbeat accepts only a recent completed loop and an existing process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "predioon-worker-health-")); const path = join(directory, "health.json");
  try {
    assert.equal(await healthyHeartbeat(path), false);
    await writeHeartbeat(path, "empty"); assert.equal(await healthyHeartbeat(path), true);
    const state = JSON.parse(await readFile(path, "utf8"));
    assert.equal(await healthyHeartbeat(path, Date.parse(state.completedAt) + 30_001), false);
    assert.equal(await healthyHeartbeat(path, Date.parse(state.completedAt) - 1_001), false);
    await writeHeartbeat(path, "database_error"); assert.equal(await healthyHeartbeat(path), false);
    for (const data of ["invalid", JSON.stringify({ ...state, pid: -1 }), JSON.stringify({ ...state, outcome: "private" }), JSON.stringify({ ...state, secret: "private" })]) {
      await writeFile(path, data); assert.equal(await healthyHeartbeat(path), false);
    }
    await writeHeartbeat(path, "retry"); await removeHeartbeat(path); assert.equal(await healthyHeartbeat(path), false);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("predioon-worker-health-"));
    await rm(directory, { recursive: true, force: true });
  }
});
