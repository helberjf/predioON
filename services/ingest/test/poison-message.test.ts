import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayStatusSchema, telemetryTopic } from "@predioon/shared";
import { normalizeTelemetry } from "../src/pipeline/normalize.js";
import { permanentDataErrorCode } from "../src/permanent-error.js";

// PON-01: one envelope PostgreSQL can never store must not stall the single
// ordered MQTT session that every condominium shares.
const reading = {
  schemaVersion: 1, eventId: "poison-event-0001", buildingId: "bld_poison", deviceId: "dev_poison",
  metric: "vendor_note", value: "Leitura", unit: "txt", quality: "GOOD", timestamp: "2026-11-13T12:00:00Z",
};
const topic = telemetryTopic(reading.buildingId, reading.deviceId);

for (const field of ["eventId", "metric", "unit", "value"] as const) {
  test(`rejects U+0000 in ${field} before any database write`, () => {
    const body = { ...reading, [field]: `${reading[field]}\u0000x` };
    assert.deepEqual(normalizeTelemetry(topic, Buffer.from(JSON.stringify(body))), []);
  });
}

test("still accepts other control characters, which PostgreSQL stores", () => {
  const body = { ...reading, value: "linha 1\nlinha 2\u0001" };
  assert.deepEqual(normalizeTelemetry(topic, Buffer.from(JSON.stringify(body))), [body]);
});

test("rejects U+0000 in a gateway firmware version", () => {
  const status = { schemaVersion: 1, buildingId: "bld_poison", gatewayId: "gw_poison", state: "ONLINE", timestamp: "2026-11-13T12:00:00Z" };
  assert.equal(GatewayStatusSchema.safeParse({ ...status, firmwareVersion: "1.2.3" }).success, true);
  assert.equal(GatewayStatusSchema.safeParse({ ...status, firmwareVersion: "1.2\u00003" }).success, false);
});

test("classifies only SQLSTATE class 22 as a permanent content refusal", () => {
  for (const code of ["22P02", "22P05", "22021", "22003", "22001"]) {
    assert.equal(permanentDataErrorCode(Object.assign(new Error("refused"), { code })), code);
  }
  // Drizzle wraps the driver error; the SQLSTATE is on the cause.
  const wrapped = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("invalid input syntax for type json"), { code: "22P02" }) });
  assert.equal(permanentDataErrorCode(wrapped), "22P02");
  // Retryable failures must keep being redelivered.
  for (const code of ["40001", "40P01", "08006", "57P01", "53300", "42501", "23505", "ECONNREFUSED", "ETIMEDOUT", "CONNECTION_CLOSED", 22021]) {
    assert.equal(permanentDataErrorCode(Object.assign(new Error("transient"), { code })), null, String(code));
  }
  assert.equal(permanentDataErrorCode(new Error("Telemetry receipt write was not persisted")), null);
  assert.equal(permanentDataErrorCode(undefined), null);
  assert.equal(permanentDataErrorCode("22P02"), null);
});

test("stops walking a cyclic cause chain", () => {
  const first: Error & { cause?: unknown } = new Error("a");
  const second: Error & { cause?: unknown } = new Error("b");
  first.cause = second; second.cause = first;
  assert.equal(permanentDataErrorCode(first), null);
});
