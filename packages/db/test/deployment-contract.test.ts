import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it } from "node:test";

const execute = promisify(execFile);
const script = new URL("../../../infrastructure/setup-prod.sh", import.meta.url);
const skip = process.platform === "win32";

/** Runs only a copied script against a fake docker executable and fake secrets.
 * No container, database, network, production file or service is touched. */
const servicePasswords = ["NOTIFICATIONS_DB_PASSWORD", "INGEST_DB_PASSWORD", "ACCESS_SERVICE_DB_PASSWORD"] as const;
async function rollout(options: { stopFails?: boolean; stillRunning?: boolean; buildFails?: boolean; preflightFails?: boolean; missingPassword?: typeof servicePasswords[number] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "predioon-rollout-"));
  try {
    await mkdir(join(root, "infrastructure"));
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "infrastructure/setup-prod.sh"),
      (await readFile(process.env.TEST_SETUP_BASELINE_FILE || script, "utf8")).replaceAll("\r\n", "\n"));
    await writeFile(join(root, "infrastructure/.env.prod"), "POSTGRES_PASSWORD=fixture_only\nDOMAIN=fixture.invalid\n" +
      servicePasswords.filter(name => name !== options.missingPassword).map(name => `${name}=fixture_only_${name.toLowerCase()}\n`).join(""));
    const log = join(root, "docker-calls.log");
    const docker = join(root, "bin/docker");
    await writeFile(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
case "$*" in
  *" config --quiet"*) if test "$TEST_MISSING_PASSWORD" = 1; then exit 1; fi ;;
  *" build api "*) if test "$TEST_BUILD_FAIL" = 1; then exit 1; fi ;;
  *"deploy-preflight.mjs "*) if test "$TEST_PREFLIGHT_FAIL" = 1; then exit 1; fi ;;
  *" stop "*) if test "$TEST_STOP_FAIL" = 1; then exit 1; fi ;;
  *" ps --status running "*) if test "$TEST_STILL_RUNNING" = 1; then printf 'fixture-container\\n'; fi ;;
esac
exit 0
`);
    await chmod(docker, 0o755);
    let code = 0;
    try {
      await execute("bash", [join(root, "infrastructure/setup-prod.sh")], { timeout: 10_000,
        env: { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH, TEST_DOCKER_LOG: log,
          TEST_STOP_FAIL: options.stopFails ? "1" : "0", TEST_STILL_RUNNING: options.stillRunning ? "1" : "0",
          TEST_BUILD_FAIL: options.buildFails ? "1" : "0", TEST_PREFLIGHT_FAIL: options.preflightFails ? "1" : "0",
          TEST_MISSING_PASSWORD: options.missingPassword ? "1" : "0" } });
    } catch (error) {
      const status = (error as { code: unknown }).code;
      if (typeof status !== "number") throw new Error("The copied rollout fixture failed outside its expected exit boundary");
      code = status;
    }
    const calls = await readFile(log, "utf8").catch(() => "");
    return { code, calls: calls.trim().split("\n").filter(Boolean) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

it("builds and validates before stopping writers; runs migrations only in transient admin containers", { skip }, async () => {
  const result = await rollout();
  assert.equal(result.code, 0);
  const stop = result.calls.findIndex(value => value.includes(" stop --timeout 30 ingest notifications"));
  const stopped = result.calls.findIndex(value => value.includes(" ps --status running --quiet ingest notifications"));
  const migration = result.calls.findIndex(value => value.includes(" db:infra"));
  const build = result.calls.findIndex(value => value.includes(" build api "));
  const preflight = result.calls.findIndex(value => value.includes("deploy-preflight.mjs database"));
  assert.ok(build >= 0 && preflight > build && stop > preflight);
  assert.ok(stop >= 0 && stopped > stop && migration > stopped);
  for (const command of ["db:bootstrap", "db:infra", "db:provision-runtime"]) {
    const call = result.calls.find(value => value.endsWith(command));
    assert.ok(call?.includes(" run --rm --no-deps db-admin pnpm "), command);
  }
  assert.ok(result.calls.some(value => value.includes(" up -d --no-build --wait --wait-timeout 240 ")));
  assert.ok(result.calls.every(value => !value.includes("postgres://")), "secrets never enter command arguments");
});

for (const [label, options] of [["stop fails", { stopFails: true }], ["a producer remains active", { stillRunning: true }]] as const) {
  it(`refuses migration and application launch when ${label}`, { skip }, async () => {
    const result = await rollout(options);
    assert.notEqual(result.code, 0);
    assert.ok(result.calls.some(value => value.includes(" stop --timeout 30 ingest notifications")));
    if ("stillRunning" in options && options.stillRunning) assert.ok(result.calls.some(value => value.includes(" ps --status running --quiet ingest notifications")));
    assert.ok(result.calls.every(value => !/db:bootstrap|db:infra|db:provision-runtime|up -d --build/.test(value)));
  });
}

for (const missingPassword of servicePasswords) it(`refuses a missing ${missingPassword} before stopping or mutating anything`, { skip }, async () => {
  const result = await rollout({ missingPassword });
  assert.notEqual(result.code, 0);
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls[0]!.endsWith(" config --quiet"));
});

for (const [label, options] of [["image build", { buildFails: true }], ["configuration preflight", { preflightFails: true }]] as const) {
  it(`leaves old services running when ${label} fails`, { skip }, async () => {
    const result = await rollout(options);
    assert.notEqual(result.code, 0);
    assert.ok(result.calls.every(value => !/ stop |db:bootstrap|db:infra|db:provision-runtime/.test(value)));
  });
}

/** Environment keys of one Compose service, read as text: values are never resolved. */
async function composeEnvironment(service: string): Promise<string[]> {
  const lines = (await readFile(new URL("../../../infrastructure/docker-compose.prod.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n").split("\n");
  const start = lines.indexOf(`  ${service}:`);
  assert.ok(start >= 0, `service ${service} exists`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z]/.test(line));
  const block = lines.slice(start, end < 0 ? undefined : end);
  const environment = block.findIndex(line => /^    environment:(?:\s+&[\w-]+)?$/.test(line));
  assert.ok(environment >= 0, `service ${service} declares environment`);
  const keys: string[] = [];
  for (const line of block.slice(environment + 1)) {
    if (/^      (#|<<:)/.test(line)) continue;
    const match = /^      ([A-Z0-9_]+):/.exec(line);
    if (!match) break;
    keys.push(match[1]!);
  }
  return keys;
}

it("never copies a locally generated ingestion runtime file into an image or Git", async () => {
  const lines = async (file: string) => (await readFile(new URL(`../../../${file}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n").split("\n");
  assert.ok((await lines(".dockerignore")).includes("services/ingest/.env.runtime"));
  assert.ok((await lines(".gitignore")).includes("services/ingest/.env.runtime"));
});

it("passes the ingest container only its two restricted logins and operational keys", async () => {
  const keys = await composeEnvironment("ingest");
  assert.deepEqual(keys.filter(key => key.startsWith("DATABASE_URL")).sort(), ["DATABASE_URL_ACCESS_SERVICE", "DATABASE_URL_INGEST"]);
  assert.ok(keys.includes("NODE_ENV"));
  assert.ok(keys.every(key => /^(NODE_ENV|DATABASE_URL_(INGEST|ACCESS_SERVICE)|MQTT_[A-Z_]+|(GATEWAY|DEVICE)_OFFLINE_TIMEOUT_SECONDS|OFFLINE_SWEEP_INTERVAL_SECONDS|ALERT_WEBHOOK_URL)$/.test(key)), keys.join(","));
  // No other workload receives the ingestion credentials.
  for (const service of ["api", "notifications"]) {
    assert.ok((await composeEnvironment(service)).every(key => !/^DATABASE_URL_(INGEST|ACCESS_SERVICE)$/.test(key)), service);
  }
});

it("keeps owner credentials exclusively in the profiled administrative service", async () => {
  for (const service of ["api", "ingest", "notifications"]) {
    assert.ok(!(await composeEnvironment(service)).includes("DATABASE_URL"), service);
  }
  const admin = await composeEnvironment("db-admin");
  assert.equal(admin.filter(key => key.startsWith("DATABASE_URL")).length, 7);
  const source = await readFile(new URL("../../../infrastructure/docker-compose.prod.yml", import.meta.url), "utf8");
  assert.match(source, /db-admin:\s+profiles: \[maintenance\]/);
  const setup = await readFile(script, "utf8");
  assert.doesNotMatch(setup, /^\s*\.\s+"?\$ENV_FILE/m, "dotenv must never be executed as shell");
  assert.doesNotMatch(setup, /SEED_PASSWORD:-predioon123/);
});
