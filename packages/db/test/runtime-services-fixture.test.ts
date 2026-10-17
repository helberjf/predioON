import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixtureDatabaseNameIsSafe,
  codeIs,
  parseRuntimeServicesEnvironment,
  provisionChildEnvironment,
  safeDatabaseOperation,
  baselineRuntimeServicesMigrations,
  rememberFixtureRoleOids,
  candidateRunnerSqlState,
  mutateVerifiedServiceRoles,
} from "./fixtures/runtime-services.js";

const environment = {
  TEST_INGEST_DISPOSABLE_DB: "1",
  TEST_INGEST_DATABASE_URL: "postgres://fixture_admin:synthetic-sensitive-value@localhost:5436/postgres",
  TEST_INGEST_EXPECTED_SYSTEM_IDENTIFIER: "7421000000000000001",
  TEST_INGEST_CONTAINER_ID: "a".repeat(64),
  TEST_INGEST_EXPECTED_CONTAINER_ID: "a".repeat(64),
};

function safePreflightFailure(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.match(error.message, /^Runtime services fixture preflight:/);
  assert.ok(!/postgres(?:ql)?:\/\/|synthetic-sensitive-value|7421000000000000001/.test(error.message),
    "preflight diagnostics contain no connection, password or private cluster identifier");
  return true;
}

test("ordinary runs skip only when no TEST_INGEST_* variable was supplied", () => {
  assert.equal(parseRuntimeServicesEnvironment({ DATABASE_URL: "unrelated" }), undefined);
  assert.throws(() => parseRuntimeServicesEnvironment({ TEST_INGEST_UNKNOWN: "1" }), safePreflightFailure);
});

test("partial opt-in fails closed before a client can be constructed", () => {
  for (const key of Object.keys(environment)) {
    const partial: Record<string, string | undefined> = { ...environment };
    delete partial[key];
    assert.throws(() => parseRuntimeServicesEnvironment(partial), safePreflightFailure);
    assert.throws(() => parseRuntimeServicesEnvironment({ ...environment, [key]: "" }), safePreflightFailure);
  }
});

test("complete opt-in accepts only local hosts and the root-attested Docker alias", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "db"]) {
    const configured = parseRuntimeServicesEnvironment({ ...environment,
      TEST_INGEST_DATABASE_URL: environment.TEST_INGEST_DATABASE_URL.replace("localhost", host) });
    assert.ok(configured, "the complete opt-in is available to the guarded fixture");
    assert.ok(configured.adminUrl.includes(host));
  }
});

test("unsafe opt-in values and startup parameters are rejected without echoing values", () => {
  const invalid: Array<Record<string, string>> = [
    { TEST_INGEST_DISPOSABLE_DB: "true" },
    { TEST_INGEST_EXPECTED_SYSTEM_IDENTIFIER: "not-an-identifier" },
    { TEST_INGEST_CONTAINER_ID: "a".repeat(12) },
    { TEST_INGEST_EXPECTED_CONTAINER_ID: "b".repeat(64) },
    ...[
      "https://fixture_admin:synthetic-sensitive-value@localhost/postgres",
      "postgres://fixture_admin:synthetic-sensitive-value@remote.example/postgres",
      "postgres://predioon_ingest:synthetic-sensitive-value@localhost/postgres",
      "postgres://fixture_admin@localhost/postgres",
      "postgres://fixture_admin:synthetic-sensitive-value@localhost/",
      "postgres://fixture_admin:synthetic-sensitive-value%GG@localhost/postgres",
      `${environment.TEST_INGEST_DATABASE_URL}?options=-c%20role%3Downer`,
      `${environment.TEST_INGEST_DATABASE_URL}?sslmode=disable`,
      `${environment.TEST_INGEST_DATABASE_URL}#fragment`,
    ].map(TEST_INGEST_DATABASE_URL => ({ TEST_INGEST_DATABASE_URL })),
  ];
  for (const replacement of invalid) {
    assert.throws(() => parseRuntimeServicesEnvironment({ ...environment, ...replacement }), safePreflightFailure);
  }
});

test("administrative child receives only OS essentials and the seven explicit database variables", () => {
  const urls = {
    DATABASE_URL_APP: "app", DATABASE_URL_IDENTITY: "identity", DATABASE_URL_BROKER_AUTH: "broker",
    DATABASE_URL_NOTIFICATIONS: "notifications", DATABASE_URL_INGEST: "ingest", DATABASE_URL_ACCESS_SERVICE: "access",
  };
  const child = provisionChildEnvironment({
    PATH: "synthetic-path", SystemRoot: "synthetic-windows", TEMP: "synthetic-temp",
    NODE_OPTIONS: "--import malicious", DATABASE_URL: "untrusted-owner", DATABASE_URL_APP: "untrusted-app",
    DOTENV_CONFIG_PATH: "developer-secret-file", PGPASSWORD: "untrusted-password", SECRET_TOKEN: "hidden",
  }, "explicit-owner", urls);
  assert.deepEqual(Object.keys(child).sort(), ["PATH", "SystemRoot", "TEMP", "NODE_ENV", "TSX_DISABLE_CACHE", "DATABASE_URL", ...Object.keys(urls)].sort());
  assert.equal(child.DATABASE_URL, "explicit-owner");
  assert.equal(child.DATABASE_URL_APP, "app");
  assert.equal(child.PATH, "synthetic-path");
  assert.equal(child.NODE_ENV, "test");
  assert.equal(child.TSX_DISABLE_CACHE, "1");
});

test("cleanup accepts only the exact fixture UUID database namespace", () => {
  assert.equal(fixtureDatabaseNameIsSafe(`ingest_runtime_${"a".repeat(32)}`), true);
  for (const name of ["postgres", "predioon", "ingest_runtime_", `ingest_runtime_${"a".repeat(31)}`,
    `ingest_runtime_${"a".repeat(32)}_other`, `ingest_runtime_${"g".repeat(32)}`, 'ingest_runtime_";drop database postgres']) {
    assert.equal(fixtureDatabaseNameIsSafe(name), false);
  }
});

test("permission predicates accept only the exact SQLSTATE and reject an aborted transaction", () => {
  assert.equal(codeIs("42501")({ code: "42501" }), true);
  for (const error of [undefined, null, new Error("42501"), { code: "25P02" }, { code: 42501 }]) {
    assert.equal(codeIs("42501")(error), false);
  }
});

test("query and child failure boundaries discard original errors, parameters, causes and streams", async () => {
  for (const code of ["42501", "25P02", "ECONNREFUSED", 1]) {
    const original = Object.assign(new Error("postgres://fixture_admin:synthetic-sensitive-value@localhost/postgres"), {
      code, query: "synthetic-sensitive-value", parameters: ["synthetic-sensitive-value"],
      stderr: "synthetic-sensitive-value", stdout: "synthetic-sensitive-value", cause: "synthetic-sensitive-value",
    });
    await assert.rejects(safeDatabaseOperation("pure sanitization control", () => Promise.reject(original)), error => {
      assert.ok(error instanceof Error);
      assert.ok(!JSON.stringify(error).includes("synthetic-sensitive-value"));
      assert.ok(!error.message.includes("synthetic-sensitive-value"));
      assert.ok(!("cause" in error) && !("query" in error) && !("parameters" in error) && !("stderr" in error));
      assert.equal((error as { code?: unknown }).code, code === "42501" || code === "25P02" ? code : undefined);
      return true;
    });
  }
});

test("the optional 051 baseline preserves canonical sources and the default current release", () => {
  const migrations = Array.from({ length: 52 }, (_, index) => ({
    id: `${String(index + 1).padStart(3, "0")}-fixture`, source: `select ${index + 1};`,
  }));
  assert.equal(baselineRuntimeServicesMigrations(migrations).length, 52);
  const baseline = baselineRuntimeServicesMigrations(migrations, { baselineRelease: 51 });
  assert.equal(baseline.length, 51);
  baseline.forEach((migration, index) => assert.equal(migration, migrations[index]));
  assert.equal(migrations.length, 52, "the reviewed chain is never mutated");
  assert.throws(() => baselineRuntimeServicesMigrations(migrations.slice(0, 50)), safePreflightFailure);
  // A later release (053) joins the full chain without moving the 051 baseline.
  const later = [...migrations, { id: "053-later", source: "select 53;" }];
  assert.equal(baselineRuntimeServicesMigrations(later).length, 53);
  assert.deepEqual(baselineRuntimeServicesMigrations(later, { baselineRelease: 51 }), migrations.slice(0, 51));
  assert.throws(() => baselineRuntimeServicesMigrations(migrations, { baselineRelease: 52 } as never), safePreflightFailure);
});

test("candidate failures recover only the fixed runner SQLSTATE without retaining diagnostic text", () => {
  assert.equal(candidateRunnerSqlState(new Error("Migration 052-runtime não foi confirmada (42501); consulte schema_migrations antes de repetir")), "42501");
  assert.equal(candidateRunnerSqlState(new Error("Migration 052-runtime não foi confirmada (PZ052); consulte schema_migrations antes de repetir")), "PZ052");
  for (const error of [null, { code: "42501" }, new Error("synthetic-sensitive-value (42501)"),
    new Error("Migration 051-runtime não foi confirmada (42501); consulte schema_migrations antes de repetir"),
    new Error("Migration 052-runtime não foi confirmada (42501); consulte schema_migrations antes de repetir synthetic-sensitive-value")]) {
    assert.equal(candidateRunnerSqlState(error), undefined);
  }
});

test("created-role tracking captures late and contaminated roles but never adopts original or unrelated identities", () => {
  const initial = [{ rolname: "predioon_app", oid: 10 }];
  const tracked = new Map();
  rememberFixtureRoleOids(initial, [...initial, { rolname: "predioon_ingest", oid: 20 },
    { rolname: "unrelated", oid: 30 }], tracked);
  assert.deepEqual([...tracked], [["predioon_ingest", 20]]);
  rememberFixtureRoleOids(initial, [...initial, { rolname: "predioon_ingest", oid: 20 },
    { rolname: "predioon_access_service", oid: 21, has_memberships: true, owns_objects: true }], tracked);
  assert.deepEqual([...tracked], [["predioon_ingest", 20], ["predioon_access_service", 21]]);
  assert.throws(() => rememberFixtureRoleOids(initial, [{ rolname: "predioon_ingest", oid: 99 }], tracked), /identity changed/);
  assert.throws(() => rememberFixtureRoleOids(initial, [{ rolname: "predioon_app", oid: 99 }], tracked), /identity changed/);
});

test("both known service identities are validated before any role mutator can run", async () => {
  const ingest = { rolname: "predioon_ingest", oid: 20 };
  const access = { rolname: "predioon_access_service", oid: 21 };
  const replacedAccess = { ...access, oid: 99 };
  const cases = [
    { initial: [ingest, access], current: [ingest, replacedAccess], tracked: new Map() },
    { initial: [], current: [ingest, replacedAccess], tracked: new Map<"predioon_ingest" | "predioon_access_service", number>([["predioon_ingest", 20], ["predioon_access_service", 21]]) },
    { initial: [ingest, access], current: [ingest], tracked: new Map() },
    { initial: [], current: [access], tracked: new Map() },
  ];
  for (const scenario of cases) {
    let mutations = 0;
    let rejected = false;
    try {
      await mutateVerifiedServiceRoles(scenario.initial, scenario.current, scenario.tracked,
        async () => { mutations += 1; });
    } catch (error) {
      rejected = error instanceof Error && error.message === "fixture service role identity changed before mutation";
    }
    assert.equal(mutations, 0, "even a mismatch in the second role prevents all CREATE/ALTER callbacks");
    assert.equal(rejected, true, "missing, replaced and unrecorded service identities fail with a fixed diagnostic");
  }
  let plan: unknown;
  await mutateVerifiedServiceRoles([ingest], [ingest], new Map(), async roles => { plan = roles; });
  assert.deepEqual(plan, [{ rolname: "predioon_ingest", exists: true }, { rolname: "predioon_access_service", exists: false }],
    "a verified existing role and an initially absent role may proceed together");
  await mutateVerifiedServiceRoles([], [ingest, access], new Map([
    ["predioon_ingest", 20], ["predioon_access_service", 21],
  ]), async roles => { plan = roles; });
  assert.deepEqual(plan, [{ rolname: "predioon_ingest", exists: true }, { rolname: "predioon_access_service", exists: true }],
    "both exact late-created OIDs may be reset during scoped failure cleanup");
});
