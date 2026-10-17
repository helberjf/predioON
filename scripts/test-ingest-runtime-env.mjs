// node --test scripts/test-ingest-runtime-env.mjs
// Exercises the administrative CLI in a temporary directory with fixture values only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { projectIngestRuntimeEnvironment } from "./write-ingest-runtime-env.mjs";

const cli = fileURLToPath(new URL("./write-ingest-runtime-env.mjs", import.meta.url));
const sentinel = "OWNER_SENTINEL_never_copy";
const admin = {
  DATABASE_URL: `postgres://predioon:${sentinel}@localhost:5434/predioon`,
  DATABASE_URL_APP: `postgres://predioon_app:${sentinel}app@localhost:5434/predioon`,
  DATABASE_URL_NOTIFICATIONS: `postgres://predioon_notifications:${sentinel}worker@localhost:5434/predioon`,
  DATABASE_URL_INGEST: "postgres://predioon_ingest:ingest-fixture@localhost:5434/predioon",
  DATABASE_URL_ACCESS_SERVICE: "postgres://predioon_access_service:access-fixture@localhost:5434/predioon",
  JWT_PRIVATE_KEY: sentinel,
  MQTT_URL: "mqtt://localhost:1883", MQTT_USERNAME: "predioon_ingest", MQTT_PASSWORD: "mqtt-fixture",
  GATEWAY_OFFLINE_TIMEOUT_SECONDS: "120",
};
const serialize = values => Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";

function sandbox(values) {
  const root = mkdtempSync(join(tmpdir(), "predioon-ingest-env-"));
  const source = join(root, "admin.env"), target = join(root, ".env.runtime");
  writeFileSync(source, serialize(values));
  const run = () => spawnSync(process.execPath, [cli, "--source", source, "--target", target], { encoding: "utf8" });
  return { root, source, target, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("projects only the allowlisted runtime keys and never the owner or another workload", () => {
  const box = sandbox(admin);
  try {
    const result = box.run();
    assert.equal(result.status, 0, result.stderr);
    const written = readFileSync(box.target, "utf8");
    assert.ok(!written.includes(sentinel), "runtime file must not contain owner/other credentials");
    assert.deepEqual(Object.keys(parseEnv(written)).sort(), ["DATABASE_URL_ACCESS_SERVICE", "DATABASE_URL_INGEST",
      "GATEWAY_OFFLINE_TIMEOUT_SECONDS", "MQTT_PASSWORD", "MQTT_URL", "MQTT_USERNAME"]);
    assert.equal(parseEnv(written).DATABASE_URL_INGEST, admin.DATABASE_URL_INGEST);
    for (const output of [result.stdout, result.stderr]) assert.ok(!/fixture|postgres:\/\/|SENTINEL/.test(output), output);
    assert.deepEqual(readdirSync(box.root).filter(name => name.endsWith(".tmp")), [], "no temporary file left behind");
    // Running again with the same configuration is a no-op.
    assert.equal(box.run().status, 0);
  } finally { box.cleanup(); }
});

test("refuses to overwrite a different existing runtime file and leaves it intact", () => {
  const box = sandbox(admin);
  try {
    writeFileSync(box.target, "DATABASE_URL_INGEST=custom\n");
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(box.target, "utf8"), "DATABASE_URL_INGEST=custom\n");
    assert.ok(!/fixture|postgres:\/\//.test(result.stderr + result.stdout));
  } finally { box.cleanup(); }
});

for (const [label, changes] of [
  ["missing access URL", { DATABASE_URL_ACCESS_SERVICE: "" }],
  ["owner as ingest", { DATABASE_URL_INGEST: admin.DATABASE_URL }],
  ["crossed service roles", { DATABASE_URL_INGEST: admin.DATABASE_URL_ACCESS_SERVICE }],
  ["different databases", { DATABASE_URL_ACCESS_SERVICE: admin.DATABASE_URL_ACCESS_SERVICE.replace("/predioon", "/other") }],
  ["role-changing startup parameter", { DATABASE_URL_INGEST: `${admin.DATABASE_URL_INGEST}?options=-c%20role%3Dpredioon` }],
  ["missing password", { DATABASE_URL_INGEST: "postgres://predioon_ingest@localhost:5434/predioon" }],
]) test(`rejects ${label} without creating any file`, () => {
  const box = sandbox({ ...admin, ...changes });
  try {
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(box.target), false);
    assert.ok(!/fixture|SENTINEL|postgres:\/\//.test(result.stderr + result.stdout), result.stderr);
  } finally { box.cleanup(); }
});

test("the pure projection rejects values that would break the file format", () => {
  assert.throws(() => projectIngestRuntimeEnvironment({ ...admin, MQTT_PASSWORD: "a\nDATABASE_URL=x" }), /MQTT_PASSWORD/);
});
