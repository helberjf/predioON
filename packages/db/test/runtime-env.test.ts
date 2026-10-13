import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type RuntimeModule = {
  file: string;
  variable?: string;
  role?: string;
  max?: number;
};

const modules: RuntimeModule[] = [
  { file: "context", variable: "DATABASE_URL_APP", role: "predioon_app", max: 10 },
  { file: "identity", variable: "DATABASE_URL_IDENTITY", role: "predioon_identity", max: 10 },
  { file: "broker-auth", variable: "DATABASE_URL_BROKER_AUTH", role: "predioon_broker_auth", max: 5 },
  { file: "notifications", variable: "DATABASE_URL_NOTIFICATIONS", role: "predioon_notifications", max: 1 },
];

function runInFreshProcess(runtime: RuntimeModule, mode: "loader" | "injected" | "errors"): void {
  const target = new URL(`../src/${runtime.file}.ts`, import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { mock } from "node:test";

    const runtime = ${JSON.stringify(runtime)};
    const mode = ${JSON.stringify(mode)};
    const roles = {
      DATABASE_URL_APP: "predioon_app",
      DATABASE_URL_IDENTITY: "predioon_identity",
      DATABASE_URL_BROKER_AUTH: "predioon_broker_auth",
      DATABASE_URL_NOTIFICATIONS: "predioon_notifications",
    };
    const configured = Object.fromEntries(Object.entries(roles).map(([variable, role]) =>
      [variable, "postgres://" + role + ":loader-test-secret@localhost:5436/predioon"]));
    const injected = Object.fromEntries(Object.entries(roles).map(([variable, role]) =>
      [variable, "postgresql://" + role + ":injected-test-secret@localhost:5437/predioon"]));
    const expected = mode === "injected" ? injected : configured;
    let loads = 0;
    const pools = [];
    let failDriver = false;

    delete process.env.DATABASE_URL;
    for (const variable of Object.keys(roles)) delete process.env[variable];
    if (mode === "injected") Object.assign(process.env, injected);
    else assert.ok(Object.keys(roles).every(variable => process.env[variable] === undefined),
      "runtime URLs must be absent before the environment loader runs");
    assert.equal(process.env.NODE_ENV, "production");

    mock.module("dotenv", { namedExports: { config: () => {
      loads++;
      for (const [variable, value] of Object.entries(configured)) {
        if (process.env[variable] === undefined) process.env[variable] = value;
      }
      return { parsed: configured };
    } } });
    mock.module("postgres", { defaultExport: (url, options) => {
      if (runtime.variable) assert.equal(loads, 1, "environment must load before client construction");
      const client = { end: async () => {} };
      pools.push({ url, options, client });
      if (failDriver) throw new Error("driver-test-secret in " + url);
      return client;
    } });
    mock.module("drizzle-orm/postgres-js", { namedExports: { drizzle: () => ({}) } });

    const imported = await import(${JSON.stringify(target)});
    if (mode === "errors") {
      const variable = "DATABASE_URL_APP";
      const role = "predioon_app";
      const sanitized = expectedMessage => error => {
        assert.ok(error instanceof Error);
        assert.ok(error.message === expectedMessage, "runtime errors must retain their sanitized message");
        assert.ok(!error.message.includes("test-secret"), "runtime errors must not expose a credential");
        assert.ok(!error.message.includes("postgres://"), "runtime errors must not expose a DSN");
        assert.equal(error.cause, undefined);
        return true;
      };
      delete process.env[variable];
      assert.throws(() => imported.runtimeDatabaseUrl(variable, role),
        sanitized(variable + " é obrigatória para este runtime"));
      assert.throws(() => imported.createRuntimeSqlClient(variable, role, 10),
        sanitized(variable + ": configuração de banco restrita inválida"));
      for (const invalid of [
        "postgres://owner:invalid-test-secret@localhost:5436/predioon",
        "postgres://predioon_app:invalid-test-secret%ZZ@localhost:5436/predioon",
        "postgres://predioon_app:invalid-test-secret@localhost:5436/predioon?options=-c%20role%3Downer",
      ]) {
        process.env[variable] = invalid;
        assert.throws(() => imported.runtimeDatabaseUrl(variable, role),
          sanitized(variable + " contém uma URL de banco inválida"));
        assert.throws(() => imported.createRuntimeSqlClient(variable, role, 10),
          sanitized(variable + ": configuração de banco restrita inválida"));
      }
      assert.equal(pools.length, 0, "invalid URLs must be rejected before constructing a client");
      process.env[variable] = configured[variable];
      failDriver = true;
      assert.throws(() => imported.createRuntimeSqlClient(variable, role, 10),
        sanitized(variable + ": configuração de banco restrita inválida"));
    } else if (!runtime.variable) {
      assert.equal(loads, 0, "importing the constructor must not load environment configuration");
      assert.equal(pools.length, 0, "importing the constructor must not construct a client");
    } else {
      assert.equal(loads, 1, "each runtime entrypoint must load environment configuration once");
      assert.ok(Object.keys(roles).every(variable => process.env[variable] === expected[variable]),
        "the loader must supply missing URLs and preserve injected URLs");
      assert.equal(pools.length, runtime.file === "notifications" ? 0 : 1,
        "runtime import must preserve its client construction behavior");
      let onclose;
      if (runtime.file === "notifications") {
        onclose = () => {};
        const client = imported.createNotificationSqlClient(onclose);
        assert.equal(pools.length, 1, "the notification factory must construct exactly one client");
        assert.ok(client === pools[0].client, "the factory must return its constructed client");
      }
      const pool = pools[0];
      assert.ok(pool.url === expected[runtime.variable], "the expected runtime URL must reach the driver unchanged");
      assert.equal(new URL(pool.url).username, runtime.role);
      if (runtime.file === "notifications") {
        const { onclose: actualOnclose, onnotice, ...options } = pool.options;
        assert.deepEqual(options, { max: 1, connect_timeout: 5, idle_timeout: 0 });
        assert.ok(actualOnclose === onclose, "the notification close callback must reach the driver unchanged");
        assert.equal(typeof onnotice, "function");
        assert.equal(onnotice(), undefined);
      } else {
        assert.deepEqual(pool.options, { max: runtime.max, connect_timeout: 5 });
      }
    }
  `;
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const variable of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[variable] !== undefined) environment[variable] = process.env[variable];
  }
  const result = spawnSync(process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", "--input-type=module", "--eval", script], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
  assert.equal(result.error, undefined, "the isolated runtime subprocess must start and finish within its timeout");
  assert.equal(result.status, 0, result.stderr || result.stdout || "isolated runtime subprocess failed");
}

test("runtime-connection import loads no environment and constructs no client", () => {
  runInFreshProcess({ file: "runtime-connection" }, "loader");
});

for (const runtime of modules) {
  test(`${runtime.file} loads production configuration before constructing its client`, () => {
    runInFreshProcess(runtime, "loader");
  });
  test(`${runtime.file} preserves injected configuration when its loader runs`, () => {
    runInFreshProcess(runtime, "injected");
  });
}

test("runtime URL and driver errors remain sanitized without opening a connection", () => {
  runInFreshProcess({ file: "runtime-connection" }, "errors");
});
