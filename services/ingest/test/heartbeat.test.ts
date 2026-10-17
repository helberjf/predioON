import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { HEARTBEAT_MAX_AGE_MS, healthyHeartbeat, startHeartbeat, writeHeartbeat } from "../src/heartbeat.js";

let directory: string;
before(async () => { directory = await mkdtemp(join(tmpdir(), "ingest-heartbeat-")); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("healthy only with MQTT connected, the database answering and a recent record", async () => {
  const path = join(directory, "a.json");
  await writeHeartbeat(path, { mqtt: true, database: true });
  assert.equal(await healthyHeartbeat(path), true);
  assert.equal(await healthyHeartbeat(path, Date.now() + HEARTBEAT_MAX_AGE_MS + 1_000), false, "stale");
  await writeHeartbeat(path, { mqtt: false, database: true });
  assert.equal(await healthyHeartbeat(path), false, "MQTT disconnected");
  await writeHeartbeat(path, { mqtt: true, database: false });
  assert.equal(await healthyHeartbeat(path), false, "database unreachable");
});

test("rejects missing, malformed, extended or foreign-process records", async () => {
  const path = join(directory, "b.json");
  assert.equal(await healthyHeartbeat(path), false);
  for (const content of ["not json", JSON.stringify({ version: 1, pid: process.pid, checkedAt: new Date().toISOString(), mqtt: true, database: true, extra: 1 }),
    JSON.stringify({ version: 1, pid: 2 ** 22 + 12345, checkedAt: new Date().toISOString(), mqtt: true, database: true }), "x".repeat(2_000)]) {
    await writeFile(path, content);
    assert.equal(await healthyHeartbeat(path), false, content.slice(0, 40));
  }
});

test("the running heartbeat records each check and removes its own file on stop", async () => {
  const path = join(directory, "c.json");
  let connected = true, pings = 0;
  const stop = startHeartbeat(() => connected, async () => { pings++; }, path, 20);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(await healthyHeartbeat(path), true);
  connected = false;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(JSON.parse(await readFile(path, "utf8")).mqtt, false);
  assert.ok(pings >= 3);
  await stop();
  await assert.rejects(stat(path), { code: "ENOENT" });
});

test("a failing database check is recorded, not thrown", async () => {
  const path = join(directory, "d.json");
  const stop = startHeartbeat(() => true, async () => { throw new Error("down"); }, path, 1_000);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(JSON.parse(await readFile(path, "utf8")).database, false);
  await stop();
});
