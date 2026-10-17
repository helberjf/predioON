import assert from "node:assert/strict";
import { after, before } from "node:test";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../../../packages/db/src/schema.js";
import type postgresType from "postgres";

// The caller owns the isolated, migrated and provisioned lab. Never read project .env.
const adminUrl = process.env.TEST_INGEST_DATABASE_URL;
assert.ok(adminUrl, "TEST_INGEST_DATABASE_URL is required for administrative fixture operations");
assert.equal(process.env.TEST_INGEST_DISPOSABLE_DB, "1", "An explicitly disposable test database is required");
const adminTarget = new URL(adminUrl);
// Same loopback/lab-service allowlist as the shared runtime-services fixture.
assert.ok(["localhost", "127.0.0.1", "[::1]", "db"].includes(adminTarget.hostname), "administrative fixture must target the isolated lab");
for (const [testVariable, runtimeVariable, role] of [
  ["TEST_INGEST_RUNTIME_DATABASE_URL", "DATABASE_URL_INGEST", "predioon_ingest"],
  ["TEST_ACCESS_RUNTIME_DATABASE_URL", "DATABASE_URL_ACCESS_SERVICE", "predioon_access_service"],
] as const) {
  const value = process.env[testVariable];
  assert.ok(value, `${testVariable} is required`);
  const target = new URL(value);
  assert.equal(decodeURIComponent(target.username), role);
  assert.equal(`${target.hostname}:${target.port || "5432"}${target.pathname}`, `${adminTarget.hostname}:${adminTarget.port || "5432"}${adminTarget.pathname}`);
  process.env[runtimeVariable] = value;
}
delete process.env.DATABASE_URL;
const postgres = createRequire(new URL("../../../../packages/db/package.json", import.meta.url))("postgres") as typeof postgresType;
export const sqlClient = postgres(adminUrl, { max: 2, onnotice: () => {} });
/** A separate administrative session, e.g. to hold a row lock while the service waits. */
export const adminSession = () => postgres(adminUrl!, { max: 1, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export * from "../../../../packages/db/src/schema.js";
// Every suite importing this fixture first proves the handler runs as the restricted
// login: a green result must not come from an owner connection.
before(async () => {
  const { ingestSqlClient, verifyRestrictedDatabaseRole } = await import("@predioon/db/ingest");
  const { accessServiceSqlClient } = await import("@predioon/db/access-service");
  await verifyRestrictedDatabaseRole(ingestSqlClient, "predioon_ingest");
  await verifyRestrictedDatabaseRole(accessServiceSqlClient, "predioon_access_service");
  const denied = (error: { code?: string }) => error?.code === "42501";
  await assert.rejects(ingestSqlClient`select metadata from gateways limit 1`, denied);
  await assert.rejects(accessServiceSqlClient`select id from gate_commands limit 1`, denied);
});
after(async () => {
  const { closeIngestDb } = await import("@predioon/db/ingest");
  const { closeAccessServiceDb } = await import("@predioon/db/access-service");
  await Promise.all([closeIngestDb(), closeAccessServiceDb()]);
  await sqlClient.end({ timeout: 0 });
});
