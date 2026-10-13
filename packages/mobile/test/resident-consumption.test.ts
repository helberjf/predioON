import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, type ApiClient } from "@predioon/api-client";

import * as consumption from "../src/resident-consumption.ts";
import type { Scope } from "../src/scope.ts";
function reader(value: unknown, paths: string[] = []): Pick<ApiClient, "get"> {
  return { async get<T>(path: string): Promise<T> { paths.push(path); if (value instanceof Error) throw value; return value as T; } };
}
const published = () => ({
  buildingId: "one", day: "2024-03-02", privateCost: 999,
  items: [{ kind: "ENERGY" as const, unit: "kWh" as const, today: 0, meterId: "secret-meter",
    history: [{ day: "2024-02-29", quantity: 1.25, incomplete: true, tariff: 33 }, { day: "2024-03-02", quantity: 0, incomplete: false }] }],
});

test("reads only the authenticated public route and copies only the public DTO fields", async () => {
  assert.equal(typeof consumption?.readResidentConsumption, "function", "a resident public consumption reader must exist");
  const paths: string[] = [];
  const value = published(); value.buildingId = "one /?&";
  const result = await consumption.readResidentConsumption(reader(value, paths), value.buildingId);
  assert.deepEqual(paths, ["/monitoring/published?buildingId=one%20%2F%3F%26"]);
  assert.deepEqual(result, { buildingId: value.buildingId, day: value.day, items: [{ kind: "ENERGY", unit: "kWh", today: 0,
    history: [{ day: "2024-02-29", quantity: 1.25, incomplete: true }, { day: "2024-03-02", quantity: 0, incomplete: false }] }] });
  assert.ok(result);
  assert.notEqual(result.items[0]!.history, value.items[0]!.history);
});

test("empty publication and enabled modules without measurements are distinct valid responses", async () => {
  assert.ok(consumption, "the public reader contract must exist");
  assert.deepEqual(await consumption.readResidentConsumption(reader({ buildingId: "one", day: "2024-03-02", items: [] }), "one"), { buildingId: "one", day: "2024-03-02", items: [] });
  const body = { buildingId: "one", day: "2024-03-02", items: [{ kind: "WATER", unit: "m³", today: null, history: [] }] };
  assert.deepEqual(await consumption.readResidentConsumption(reader(body), "one"), body);
});

test("only typed HTTP 403 is denial; all failures preserve status with a fixed public message", async () => {
  assert.ok(consumption, "the public reader contract must exist");
  assert.equal(await consumption.readResidentConsumption(reader(new ApiError(403, "secret denied")), "one"), null);
  for (const error of [new ApiError(401, "secret session"), new ApiError(500, "secret cost tariff"), new ApiError(0, "secret network", "NETWORK_ERROR"), new ApiError(200, "secret JSON", "INVALID_RESPONSE"), new ApiError(0, "secret session", "SESSION_CHANGED"), Object.assign(new Error("secret transport"), { status: 403 })]) {
    await assert.rejects(consumption.readResidentConsumption(reader(error), "one"), (actual: unknown) => {
      assert.ok(actual instanceof ApiError);
      assert.equal(actual.status, error instanceof ApiError ? error.status : 0);
      assert.equal(actual.code, error instanceof ApiError ? error.code : "NETWORK_ERROR");
      assert.equal(actual.message, "Não foi possível carregar o consumo do condomínio.");
      assert.equal(JSON.stringify(actual).includes("secret"), false); return true;
    });
  }
});

test("rejects scope, civil dates, units, duplicates, window bounds and malformed quantities", async () => {
  assert.ok(consumption, "the public reader contract must exist");
  const base = published(); const item = base.items[0]!; const row = item.history[0]!;
  const bodies: unknown[] = [null, {}, { ...base, buildingId: "other" }, { ...base, day: "2023-02-29" }, { ...base, day: "2024-04-31" }, { ...base, day: "2024-3-02" }, { ...base, day: "0000-03-02" }, { ...base, items: {} }, { ...base, items: [item, item] }];
  for (const patch of [{ kind: "PUMP" }, { kind: "WATER_TANK" }, { kind: "WATER", unit: "kWh" }, { unit: "kwh" }, { today: undefined }, { today: "1" }, { today: -1 }, { today: Infinity }, { today: NaN }, { history: null }, { history: Array(8).fill(row) }, { history: [row, row] }, { history: [{ ...row, day: "2024-02-24" }] }, { history: [{ ...row, day: "2024-03-03" }] }, { history: [{ ...row, day: "2024-02-30" }] }, { history: [{ ...row, quantity: -1 }] }, { history: [{ ...row, quantity: Infinity }] }, { history: [{ ...row, quantity: "1" }] }, { history: [{ ...row, incomplete: "true" }] }]) bodies.push({ ...base, items: [{ ...item, ...patch }] });
  for (const body of bodies) await assert.rejects(consumption.readResidentConsumption(reader(body), "one"), (error: unknown) => error instanceof ApiError && error.status === 200 && error.code === "INVALID_RESPONSE" && error.message === "Não foi possível carregar o consumo do condomínio.");
});

test("rejects a today aggregate inconsistent with the public daily history", async () => {
  const base = published();
  for (const item of [{ ...base.items[0]!, today: 5 }, { ...base.items[0]!, today: null }, { ...base.items[0]!, history: [] }]) {
    await assert.rejects(consumption.readResidentConsumption(reader({ ...base, items: [item] }), "one"), (error: unknown) => error instanceof ApiError && error.status === 200 && error.code === "INVALID_RESPONSE");
  }
});

test("civil window is chronological across leap day and year boundaries, with null gaps and zero intact", () => {
  assert.ok(consumption, "the public projection contract must exist");
  const days = consumption.consumptionDays("2024-03-02");
  assert.deepEqual(days, ["2024-02-25", "2024-02-26", "2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02"]);
  assert.deepEqual(consumption.consumptionDays("2025-01-02"), ["2024-12-27", "2024-12-28", "2024-12-29", "2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02"]);
  const rows = consumption.consumptionRows(published().day, published().items[0]);
  assert.equal(rows.length, 7); assert.deepEqual(rows[0], { day: days[0], quantity: null, incomplete: false });
  assert.deepEqual(rows[4], { day: "2024-02-29", quantity: 1.25, incomplete: true });
  assert.deepEqual(rows[6], { day: "2024-03-02", quantity: 0, incomplete: false });
  assert.equal(consumption.consumptionDayLabel("2024-02-29"), "29/02");
});

test("Portuguese quantities have one decimal and deterministic fallback without replacing null by zero", () => {
  assert.ok(consumption, "the public formatter contract must exist");
  assert.equal(consumption.consumptionQuantity(null, "kWh"), "Sem medição");
  assert.equal(consumption.consumptionQuantity(0, "kWh"), "0,0 kWh");
  assert.equal(consumption.consumptionQuantity(0, "m³"), "0,0 m³");
  assert.equal(consumption.consumptionQuantity(1.25, "kWh"), "1,3 kWh");
  const original = Intl.NumberFormat;
  try { Intl.NumberFormat = (() => { throw new Error("unsupported"); }) as unknown as typeof Intl.NumberFormat;
    assert.equal(consumption.consumptionQuantity(1.25, "m³"), "1,3 m³");
  } finally { Intl.NumberFormat = original; }
});

test("the public resource key requires current resident authority and tracks both real feature revisions", () => {
  assert.equal(typeof consumption.residentConsumptionKey, "function", "the shared resource must have an authority and revision key");
  const scope: Scope = { buildingId: "one", capabilities: ["monitoring:read-published"], features: [{ key: "ENERGY_CONSUMPTION", enabled: true, version: 1 }, { key: "WATER_CONSUMPTION", enabled: false }] };
  const key = consumption.residentConsumptionKey("resident", "user", scope);
  assert.equal(typeof key, "string");
  assert.equal(consumption.residentConsumptionKey("operations", "user", scope), null);
  assert.equal(consumption.residentConsumptionKey("resident", "user", { ...scope, capabilities: ["telemetry:read", "buildings:manage"] }), null);
  assert.equal(consumption.residentConsumptionKey("resident", "user", { ...scope, features: [{ key: "PUMP", enabled: true }, { key: "WATER_TANK", enabled: true }] }), null);
  assert.notEqual(consumption.residentConsumptionKey("resident", "other", scope), key);
  assert.notEqual(consumption.residentConsumptionKey("resident", "user", { ...scope, buildingId: "two" }), key);
  assert.equal(consumption.residentConsumptionKey("resident", "user", { ...scope, features: [...scope.features].reverse() }), key);
  for (const name of ["ENERGY_CONSUMPTION", "WATER_CONSUMPTION"]) for (const patch of [{ version: 2 }, { globalVersion: 2 }, { resumedAt: "2024-03-02T00:00:00Z" }]) assert.notEqual(consumption.residentConsumptionKey("resident", "user", { ...scope, features: scope.features.map(feature => feature.key === name ? { ...feature, ...patch } : feature) }), key);
});
