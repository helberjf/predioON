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
async function rollout(options: { stopFails?: boolean; stillRunning?: boolean; missingPassword?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "predioon-rollout-"));
  try {
    await mkdir(join(root, "infrastructure"));
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "infrastructure/setup-prod.sh"),
      (await readFile(process.env.TEST_SETUP_BASELINE_FILE || script, "utf8")).replaceAll("\r\n", "\n"));
    await writeFile(join(root, "infrastructure/.env.prod"), "POSTGRES_PASSWORD=fixture_only\nDOMAIN=fixture.invalid\n" +
      (options.missingPassword ? "" : "NOTIFICATIONS_DB_PASSWORD=fixture_only_notifications\n"));
    const log = join(root, "docker-calls.log");
    const docker = join(root, "bin/docker");
    await writeFile(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
case "$*" in
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
          TEST_STOP_FAIL: options.stopFails ? "1" : "0", TEST_STILL_RUNNING: options.stillRunning ? "1" : "0" } });
    } catch (error) {
      const status = (error as { code: unknown }).code;
      if (typeof status !== "number") throw new Error("The copied rollout fixture failed outside its expected exit boundary");
      code = status;
    }
    const calls = await readFile(log, "utf8").catch(() => "");
    return { code, calls: calls.trim().split("\n").filter(Boolean) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

it("stops old producers before migration and supplies the fourth DSN only to provisioning", { skip }, async () => {
  const result = await rollout();
  assert.equal(result.code, 0);
  const stop = result.calls.findIndex(value => value.includes(" stop --timeout 30 ingest notifications"));
  const stopped = result.calls.findIndex(value => value.includes(" ps --status running --quiet ingest notifications"));
  const migration = result.calls.findIndex(value => value.includes(" db:infra"));
  assert.ok(stop >= 0 && stopped > stop && migration > stopped);
  const configured = result.calls.filter(value => value.includes("DATABASE_URL_NOTIFICATIONS="));
  assert.equal(configured.length, 1);
  assert.ok(configured[0]!.includes("db:provision-runtime"));
  assert.ok(result.calls.at(-1)!.includes(" up -d --build"));
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

it("refuses a missing notification password before stopping or mutating anything", { skip }, async () => {
  const result = await rollout({ missingPassword: true });
  assert.notEqual(result.code, 0);
  assert.deepEqual(result.calls, []);
});
