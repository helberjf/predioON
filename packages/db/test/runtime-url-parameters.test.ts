import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runtimeDatabaseUrl } from "../src/runtime-connection.js";
import { runtimeRoleCredentials, runtimeRoles } from "../src/runtime-role-credentials.js";

const urls = Object.fromEntries(Object.entries(runtimeRoles).map(([variable, role]) =>
  [variable, `postgres://${role}:PARAMETER_SECRET@localhost:5436/predioon`]));
const environment = { ...urls, DATABASE_URL: "postgres://owner:PARAMETER_SECRET@localhost:5436/predioon" };
const safe = (variable: string) => (error: unknown) => {
  assert.ok(error instanceof Error && error.message.includes(variable));
  assert.ok(!/PARAMETER_SECRET|postgres:\/\//.test(error.message));
  assert.equal(error.cause, undefined);
  return true;
};

const forbiddenParameters = ["user=owner", "database=other", "client_encoding=SQL_ASCII", "USER=owner",
  "Database=other", "CLIENT_ENCODING=SQL_ASCII", "%75ser=owner",
  "application_name=fixture%00user%00owner", "application_name%00fixture%00user=owner"];
for (const parameter of forbiddenParameters) {
  for (const [variable, role] of Object.entries(runtimeRoles)) {
    test(`${variable} rejects startup identity override ${parameter.split("=")[0]}`, () => {
      const previous = process.env[variable];
      try {
        process.env[variable] = urls[variable] + "?" + parameter;
        assert.throws(() => runtimeDatabaseUrl(variable as keyof typeof runtimeRoles, role), safe(variable));
      } finally {
        if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
      }
    });
  }
  for (const variable of Object.keys(environment)) {
    test(`provisioning rejects ${parameter.split("=")[0]} in ${variable} before exposing credentials`, () => {
      assert.throws(() => runtimeRoleCredentials({ ...environment, [variable]: environment[variable as keyof typeof environment] + "?" + parameter }), safe(variable));
    });
  }
}

test("rejects driver startup identity overrides before constructing a client", () => {
  const target = new URL("../src/runtime-connection.ts", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { mock } from "node:test";
    let constructions = 0;
    mock.module("postgres", { defaultExport: () => { constructions++; return {}; } });
    const { createRuntimeSqlClient } = await import(${JSON.stringify(target)});
    for (const parameter of ${JSON.stringify(forbiddenParameters)}) {
      process.env.DATABASE_URL_INGEST = "postgres://predioon_ingest:PARAMETER_SECRET@localhost:5436/predioon?" + parameter;
      assert.throws(() => createRuntimeSqlClient("DATABASE_URL_INGEST", "predioon_ingest", 10), error => {
        assert.equal(error.message, "DATABASE_URL_INGEST: configuração de banco restrita inválida");
        assert.equal(error.cause, undefined);
        return true;
      });
    }
    assert.equal(constructions, 0);
  `;
  const childEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const variable of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[variable] !== undefined) childEnvironment[variable] = process.env[variable];
  }
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env: childEnvironment, encoding: "utf8", windowsHide: true, timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("preserves SSL and application_name options for the real lazy driver without connecting", async () => {
  const variable = "DATABASE_URL_INGEST";
  const previous = process.env[variable];
  const configured = urls[variable] + "?sslmode=require&application_name=ingest-worker";
  let client: postgres.Sql | undefined;
  try {
    process.env[variable] = configured;
    assert.equal(runtimeDatabaseUrl(variable, "predioon_ingest"), configured);
    assert.equal(runtimeRoleCredentials({ ...environment, [variable]: configured }).length, 6);
    client = postgres(configured, { max: 1 });
    assert.equal(client.options.user, "predioon_ingest");
    assert.equal(client.options.database, "predioon");
    assert.equal(client.options.ssl, "require");
    assert.equal(client.options.connection.application_name, "ingest-worker");
    assert.equal(client.options.connection.user, undefined);
  } finally {
    await client?.end({ timeout: 0 });
    if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
  }
});

test("decodes application_name once so a literal percent escape remains safe and unchanged", async () => {
  const variable = "DATABASE_URL_INGEST";
  const previous = process.env[variable];
  const configured = urls[variable] + "?application_name=fixture%2500suffix";
  let client: postgres.Sql | undefined;
  try {
    process.env[variable] = configured;
    assert.equal(runtimeDatabaseUrl(variable, "predioon_ingest"), configured);
    assert.equal(runtimeRoleCredentials({ ...environment, [variable]: configured }).length, 6);
    client = postgres(configured, { max: 1 });
    assert.equal(client.options.connection.application_name, "fixture%00suffix");
  } finally {
    await client?.end({ timeout: 0 });
    if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
  }
});
