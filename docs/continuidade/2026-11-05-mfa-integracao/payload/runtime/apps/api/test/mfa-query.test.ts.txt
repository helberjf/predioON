import assert from "node:assert/strict";
import { it } from "node:test";
import { asc, getTableColumns, sql, type DriverValueDecoder, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
// Schema only: do not import @predioon/db/runtime or construct a SQL client.
import { devices, gateways, organizations } from "../../../packages/db/src/schema.js";
import { mfaQueryProjection } from "../src/auth/mfa-query.js";

// mock() creates only the query builder. No query is awaited or executed.
const db = drizzle.mock();
const buildingId = "synthetic-building-with-'quote";
const scenarios = [
  {
    label: "organizations",
    table: organizations,
    from: sql`public.app_list_mfa_organizations() AS organizations`,
    order: [organizations.name, organizations.id],
    expectedSql: 'select "id", "name", "slug", "active", "metadata", "created_at", "updated_at" from public.app_list_mfa_organizations() AS organizations order by "organizations"."name", "organizations"."id"',
    params: [],
    keys: ["id", "name", "slug", "active", "metadata", "createdAt", "updatedAt"],
  },
  {
    label: "devices",
    table: devices,
    from: sql`public.app_list_mfa_devices(${buildingId}) AS devices`,
    order: [asc(devices.name)],
    expectedSql: 'select "id", "building_id", "gateway_id", "name", "type", "hardware_address", "status", "enabled", "last_seen_at", "metadata", "created_at", "updated_at" from public.app_list_mfa_devices($1) AS devices order by "devices"."name" asc',
    params: [buildingId],
    keys: ["id", "buildingId", "gatewayId", "name", "type", "hardwareAddress", "status", "enabled", "lastSeenAt", "metadata", "createdAt", "updatedAt"],
  },
  {
    label: "gateways",
    table: gateways,
    from: sql`public.app_list_mfa_gateways() AS gateways`,
    order: [asc(gateways.name)],
    expectedSql: 'select "id", "building_id", "name", "serial_number", "model", "firmware_version", "protocol_version", "status", "enabled", "last_seen_at", "metadata", "created_at", "updated_at" from public.app_list_mfa_gateways() AS gateways order by "gateways"."name" asc',
    params: [],
    keys: ["id", "buildingId", "name", "serialNumber", "model", "firmwareVersion", "protocolVersion", "status", "enabled", "lastSeenAt", "metadata", "createdAt", "updatedAt"],
  },
] as const;

// SQL's decoder is intentionally inspected through this narrow test-only adapter:
// it is runtime-internal in Drizzle0.44, not part of the public SQL<T> declaration.
// This verifies the real mapWith decoder, without simulating a database response.
function decoder(expression: SQL<unknown>): DriverValueDecoder<unknown, unknown> {
  const inspected = expression as unknown as { decoder: DriverValueDecoder<unknown, unknown> };
  assert.equal(typeof inspected.decoder?.mapFromDriverValue, "function");
  return inspected.decoder;
}

for (const scenario of scenarios) {
  it(`compiles ${scenario.label} MFA envelope with the original fields, aliases and parameters`, () => {
    const projection = mfaQueryProjection(scenario.table);
    const compiled = db.select(projection).from(scenario.from).orderBy(...scenario.order).toSQL();
    assert.equal(compiled.sql, scenario.expectedSql);
    assert.deepEqual(compiled.params, [...scenario.params]);
    assert.deepEqual(Object.keys(projection), [...scenario.keys]);
    assert.equal(compiled.sql.includes(buildingId), false, "a caller value must remain a bound parameter");
  });

  it(`preserves actual ${scenario.label} column decoders, Date and JSON DTO values`, () => {
    const projection = mfaQueryProjection(scenario.table);
    const columns = getTableColumns(scenario.table);
    for (const [key, column] of Object.entries(columns)) {
      assert.equal(decoder(projection[key as keyof typeof projection]), column);
    }
    const instant = "2026-11-05 03:04:05.678+00";
    const created = decoder(projection.createdAt).mapFromDriverValue(instant);
    assert.ok(created instanceof Date);
    assert.equal(created.toISOString(), "2026-11-05T03:04:05.678Z");
    const metadata = { fixture: "synthetic", enabled: true };
    assert.deepEqual(decoder(projection.metadata).mapFromDriverValue(JSON.stringify(metadata)), metadata);
    assert.equal(decoder(projection.metadata).mapFromDriverValue(metadata), metadata);
  });
}

it("keeps NULL device scope bound and nullable timestamp typing", () => {
  const projection = mfaQueryProjection(devices);
  const nullableTimestamp: SQL<Date | null> = projection.lastSeenAt;
  assert.equal(decoder(nullableTimestamp), devices.lastSeenAt);
  const compiled = db.select(projection)
    .from(sql`public.app_list_mfa_devices(${null}) AS devices`)
    .orderBy(asc(devices.name)).toSQL();
  assert.deepEqual(compiled.params, [null]);
  assert.match(compiled.sql, /from public\.app_list_mfa_devices\(\$1\) AS devices/);
});
