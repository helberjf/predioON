import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { alertRules, alerts, db, devices, sqlClient, telemetry } from "@predioon/db";
import { telemetryTopic } from "@predioon/shared";
import { handleTelemetry } from "../src/pipeline/telemetry.js";

const buildingId = "bld_001";
const prefix = `test_sensor_${randomUUID().slice(0, 8)}`;
const detectors = [
  { metric: "gas_detected", type: "GAS_SENSOR" },
  { metric: "smoke_detected", type: "SMOKE_PANEL_RELAY" },
  { metric: "water_leak_detected", type: "LEAK_SENSOR" },
  { metric: "sewage_leak_detected", type: "SEWAGE_LEAK_SENSOR" },
  { metric: "leak_detected", type: "LEAK_SENSOR" },
].map((sensor, index) => ({ ...sensor, id: `${prefix}_${index}` }));

function message(deviceId: string, metric: string, value: unknown, quality = "GOOD") {
  return Buffer.from(JSON.stringify({ schemaVersion: 1, eventId: randomUUID(), buildingId, deviceId, metric,
    value, quality, timestamp: new Date().toISOString() }));
}

/** Requires the seeded local database, like pipeline.test.ts and water.test.ts. */
describe("ingestão dos detectores de segurança", () => {
  before(async () => {
    await db.insert(devices).values(detectors.map((sensor) => ({ id: sensor.id, buildingId, type: sensor.type, name: sensor.metric })));
    await db.insert(alertRules).values(detectors.map((sensor) => ({ buildingId, deviceId: sensor.id, name: sensor.id,
      metric: sensor.metric, operator: "EQ" as const, threshold: 1, severity: "CRITICAL" as const,
      alertType: sensor.metric.toUpperCase(), messageTemplate: "Detecção de teste: {value}", cooldownSeconds: 300 })));
  });
  after(async () => {
    for (const sensor of detectors) await db.delete(devices).where(eq(devices.id, sensor.id));
    await sqlClient.end();
  });

  for (const sensor of detectors) it(`${sensor.metric}: não alarma com false/qualidade ruim; persiste true e alerta uma vez`, async () => {
    const topic = telemetryTopic(buildingId, sensor.id);
    await handleTelemetry(topic, message(sensor.id, sensor.metric, "false"));
    assert.equal((await db.select().from(telemetry).where(eq(telemetry.deviceId, sensor.id))).length, 0, "booleano textual rejeitado antes de gravar");
    await handleTelemetry(topic, message(sensor.id, sensor.metric, false));
    await handleTelemetry(topic, message(sensor.id, sensor.metric, true, "BAD"));
    assert.equal((await db.select().from(alerts).where(eq(alerts.deviceId, sensor.id))).length, 0);
    const active = message(sensor.id, sensor.metric, true);
    await handleTelemetry(topic, active);
    await handleTelemetry(topic, active);
    const rows = await db.select().from(telemetry).where(eq(telemetry.deviceId, sensor.id));
    assert.equal(rows.length, 3, "reenvio não duplica a amostra");
    const activeReading = rows.find((row) => row.value === true && row.quality === "GOOD");
    assert.equal(activeReading?.numericValue, 1, "booleano é convertido somente para a avaliação numérica");
    const found = await db.select().from(alerts).where(and(eq(alerts.deviceId, sensor.id), eq(alerts.type, sensor.metric.toUpperCase())));
    assert.equal(found.length, 1, "reenvio não duplica o alerta");
  });
});
