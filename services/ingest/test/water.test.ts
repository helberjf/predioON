import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { db, sqlClient, devices, telemetry, alerts, alertRules } from "@predioon/db";
import { handleTelemetry } from "../src/pipeline/telemetry.js";

const deviceId = `test_water_${randomUUID().slice(0, 8)}`;
const buildingId = "bld_001";
const topic = `predio/${buildingId}/caixa_agua/${deviceId}/telemetria`;
const data = (extra: Record<string, unknown> = {}) => ({
  device_id: deviceId, type: "nivel_caixa_agua", nivel_percentual: 78,
  distancia_mm: 650, volume_litros: 3900, timestamp: new Date().toISOString(), ...extra,
});
const raw = (value: unknown) => Buffer.from(JSON.stringify(value));
const rows = () => db.select().from(telemetry).where(eq(telemetry.deviceId, deviceId));

describe("contrato da caixa d'água", () => {
  before(async () => {
    await db.insert(devices).values({ id: deviceId, buildingId, name: "Sensor de teste", type: "WATER_LEVEL_SENSOR" });
    await db.insert(alertRules).values({ buildingId, deviceId, name: deviceId, metric: "water_level_percent", operator: "LT", threshold: 20,
      severity: "HIGH", alertType: "LOW_WATER_LEVEL", messageTemplate: "Nível baixo: {value}%", cooldownSeconds: 300 });
  });
  after(async () => {
    await db.delete(devices).where(eq(devices.id, deviceId));
    await sqlClient.end();
  });

  it("persiste nível, distância e volume uma única vez no reenvio QoS 1", async () => {
    const message = raw(data());
    await handleTelemetry(topic, message);
    await handleTelemetry(topic, message);
    const saved = await rows();
    assert.equal(saved.length, 3);
    assert.deepEqual(Object.fromEntries(saved.map(r => [r.metric, r.numericValue])), {
      water_level_percent: 78, distance_mm: 650, volume_liters: 3900,
    });
  });

  it("aceita somente nível quando os outros campos não foram medidos", async () => {
    const timestamp = new Date(Date.now() - 1000).toISOString();
    await handleTelemetry(topic, raw(data({ distancia_mm: undefined, volume_litros: undefined, timestamp })));
    assert.equal((await rows()).filter(r => r.time.toISOString() === timestamp).length, 1);
  });

  it("descarta valores inválidos, tópico divergente e JSON quebrado sem gravar parcialmente", async () => {
    const count = (await rows()).length;
    for (const extra of [{ nivel_percentual: 101 }, { nivel_percentual: -1 }, { nivel_percentual: "78" },
      { distancia_mm: -1 }, { volume_litros: -10 }, { timestamp: "ontem" }, { device_id: "outro" }]) {
      await handleTelemetry(topic, raw(data(extra)));
    }
    await handleTelemetry(topic, Buffer.from("{json inválido"));
    await handleTelemetry(`predio/outro/caixa_agua/${deviceId}/telemetria`, raw(data()));
    assert.equal((await rows()).length, count);
  });

  it("gera um alerta quando 18% fica abaixo do limite de 20%, sem duplicá-lo", async () => {
    const message = raw(data({ nivel_percentual: 18, volume_litros: 900 }));
    await handleTelemetry(topic, message);
    await handleTelemetry(topic, message);
    const found = await db.select().from(alerts).where(and(eq(alerts.deviceId, deviceId), eq(alerts.type, "LOW_WATER_LEVEL")));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.triggeredValue, 18);
  });

  it("ignora equipamento desativado", async () => {
    await db.update(devices).set({ enabled: false, status: "DISABLED" }).where(eq(devices.id, deviceId));
    const count = (await rows()).length;
    await handleTelemetry(topic, raw(data({ nivel_percentual: 50 })));
    assert.equal((await rows()).length, count);
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
    assert.equal(device!.status, "DISABLED");
  });
});
