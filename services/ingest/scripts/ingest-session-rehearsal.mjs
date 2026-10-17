// Rehearsal, not a unit test: the real ingestion service (src/index.ts, with only
// the two restricted database URLs) keeps a QoS 1 reading published while it was
// offline, across a restart of a disposable EMQX broker with durable sessions.
//
//   REHEARSAL_ADMIN_DATABASE_URL=... DATABASE_URL_INGEST=... DATABASE_URL_ACCESS_SERVICE=... \
//   node --import tsx scripts/ingest-session-rehearsal.mjs <mqtt-url> <emqx-container>
//
// The admin URL is used only here, for assertions; the service never receives it.
// Use a disposable broker (the script restarts it) and a disposable seeded database.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import mqtt from "mqtt";
import { telemetryTopic } from "@predioon/shared";

const [url, container] = process.argv.slice(2);
const adminUrl = process.env.REHEARSAL_ADMIN_DATABASE_URL;
if (!url || !container || !adminUrl || !process.env.DATABASE_URL_INGEST || !process.env.DATABASE_URL_ACCESS_SERVICE) {
  console.error("usage: REHEARSAL_ADMIN_DATABASE_URL, DATABASE_URL_INGEST and DATABASE_URL_ACCESS_SERVICE set; ingest-session-rehearsal.mjs <mqtt-url> <emqx-container>");
  process.exit(2);
}
const postgres = createRequire(new URL("../../../packages/db/package.json", import.meta.url))("postgres");
const owner = postgres(adminUrl, { max: 1, onnotice: () => {} });
const clientId = `ingest-rehearsal-${randomUUID()}`, BUILDING = "bld_001", DEVICE = "water_01";

function startService() {
  const env = { MQTT_URL: url, MQTT_CLIENT_ID: clientId, NODE_ENV: "production",
    DATABASE_URL_INGEST: process.env.DATABASE_URL_INGEST, DATABASE_URL_ACCESS_SERVICE: process.env.DATABASE_URL_ACCESS_SERVICE };
  for (const key of ["PATH", "HOME", "TZ", "SystemRoot", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: new URL("../", import.meta.url), env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const exited = new Promise(resolve => child.on("exit", code => resolve(code)));
  return { child, exited, output: () => output };
}
async function until(check, label, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`timeout: ${label}`); await delay(200); }
}
async function publish(eventId) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const client = await mqtt.connectAsync(url, { clientId: `rehearsal-publisher-${randomUUID()}`, clean: true, reconnectPeriod: 0, connectTimeout: 3000 });
      await client.publishAsync(telemetryTopic(BUILDING, DEVICE), JSON.stringify({ schemaVersion: 1, eventId, buildingId: BUILDING, deviceId: DEVICE,
        metric: "water_level_percent", value: 55, unit: "%", quality: "GOOD", timestamp: new Date().toISOString() }), { qos: 1 });
      await client.endAsync();
      return;
    } catch { await delay(1000); }
  }
  throw new Error("broker did not accept the publication");
}
const stored = async eventId => (await owner`select count(*)::int as n from telemetry where event_id=${eventId} and building_id=${BUILDING}`)[0].n;
const subscribed = service => () => service.output().includes("Assinando");

const result = {};
let service;
try {
  service = startService();
  await until(subscribed(service), "first subscription");
  const live = randomUUID();
  await publish(live);
  await until(async () => (await stored(live)) === 1, "live reading");
  result.liveReading = true;

  service.child.kill("SIGTERM");
  const stopCode = await service.exited;
  // Windows has no POSIX SIGTERM: kill() terminates the process, so only Linux proves a graceful stop.
  result.gracefulStop = process.platform === "win32" ? "not-applicable-on-windows" : stopCode === 0;
  const offline = randomUUID();
  await publish(offline);
  await delay(500);
  result.notStoredWhileOffline = (await stored(offline)) === 0;
  execFileSync("docker", ["restart", container], { stdio: "ignore" });

  service = startService();
  await until(subscribed(service), "subscription after broker restart", 120_000);
  await until(async () => (await stored(offline)) >= 1, "offline reading after broker restart", 30_000).catch(() => undefined);
  await delay(2000);
  result.offlineReadingAcrossBrokerRestart = await stored(offline);
  const sessions = await owner`select distinct usename from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid()`;
  result.serviceDatabaseLogins = sessions.map(row => row.usename).sort();
  assert.equal(result.offlineReadingAcrossBrokerRestart, 1, "offline QoS1 reading persisted exactly once");
  assert.deepEqual(result.serviceDatabaseLogins, ["predioon_access_service", "predioon_ingest"]);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify(result));
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (service && service.child.exitCode === null) { service.child.kill("SIGTERM"); await service.exited; }
  await owner.end({ timeout: 1 });
}
