// Runs the ingestion service's integration suites, each against a fresh database
// of the disposable cluster pinned by TEST_INGEST_* (see packages/db/test/fixtures/
// runtime-services.ts): the administrative fixture migrates, provisions the six
// roles and seeds; the suite's handlers receive only the two restricted logins.
//
//   node --import tsx scripts/test-ingest-restricted-suites.mjs [suite ...]
// Run from packages/db so `tsx` and the fixture resolve. These suites change
// cluster-wide role passwords: never point them at a shared cluster.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRuntimeServicesFixture, parseRuntimeServicesEnvironment, verifyOwnerPositiveControl } from "../packages/db/test/fixtures/runtime-services.ts";

const suites = ["receipt-policy", "pipeline", "water", "sensors.integration", "parking", "feature-pause", "usage",
  "outbox-producers.integration", "access.integration", "access-capabilities.integration"];
const requested = process.argv.slice(2);
for (const suite of requested) assert.ok(suites.includes(suite), `Suíte desconhecida: ${suite}`);
const databaseDirectory = fileURLToPath(new URL("../packages/db/", import.meta.url));
const ingestDirectory = fileURLToPath(new URL("../services/ingest/", import.meta.url));
const configuration = parseRuntimeServicesEnvironment(process.env);
assert.ok(configuration, "Defina as variáveis TEST_INGEST_* do cluster descartável");
// Children get a minimal environment: no owner DATABASE_URL, no project .env.
const base = Object.fromEntries(["PATH", "HOME", "NODE_ENV", "TZ", "SystemRoot", "TEMP", "TMP"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const redact = value => String(value ?? "").replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[redacted-url]").replace(/SCRAM-SHA-256\$[^\s'"<>]+/g, "[redacted-credential]");

let failed = false;
for (const suite of requested.length ? requested : suites) {
  let fixture;
  try {
    fixture = await createRuntimeServicesFixture(configuration);
    await verifyOwnerPositiveControl(fixture);
    await fixture.provisionRuntime();
    const owner = new URL(configuration.adminUrl); owner.pathname = `/${fixture.databaseName}`;
    const seed = spawnSync(process.execPath, ["--import", "tsx", "src/seed.ts"], { cwd: databaseDirectory, encoding: "utf8", timeout: 60_000,
      env: { ...base, DATABASE_URL: owner.toString(), SEED_PASSWORD: randomBytes(24).toString("hex"), SEED_PHYSICAL_FEATURES: "enabled" } });
    assert.equal(seed.status, 0, "Seed administrativo falhou (saída omitida)");
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", `test/${suite}.test.ts`], {
      cwd: ingestDirectory, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...base, RUN_ACCESS_DB_TESTS: "1", TEST_INGEST_DISPOSABLE_DB: "1", TEST_INGEST_DATABASE_URL: owner.toString(),
        TEST_INGEST_RUNTIME_DATABASE_URL: fixture.urls.ingest, TEST_ACCESS_RUNTIME_DATABASE_URL: fixture.urls.access } });
    process.stdout.write(redact(result.stdout)); process.stderr.write(redact(result.stderr));
    if (result.status !== 0 || result.signal || result.error) { failed = true; console.error(`✖ ${suite}`); }
  } catch (error) {
    failed = true;
    const code = error?.code;
    console.error(`✖ ${suite}: preparação recusada${typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? ` (${code})` : ""}`);
  } finally {
    try { await fixture?.cleanup(); } catch { failed = true; console.error(`✖ ${suite}: limpeza do banco descartável falhou`); }
  }
}
process.exitCode = failed ? 1 : 0;
