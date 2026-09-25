import { eq } from "drizzle-orm";
import { SENSOR_METRICS, type SensorMetric } from "@predioon/shared";
import { db } from "./index.js";
import { alertRules, deviceMetrics, devices } from "./schema.js";

const buildingId = "bld_001";
const gatewayId = "gw_001";
const mappings: Record<string, SensorMetric[]> = {
  water_01: ["water_level_percent", "volume_liters", "distance_mm"],
  water_meter_01: ["water_total_m3"],
  energy_01: ["energy_total_kwh"],
  pump_01: ["pump_running"],
  phase_01: ["voltage_l1", "voltage_l2", "voltage_l3", "current_l1", "current_l2", "current_l3", "frequency_hz"],
  leak_01: ["water_leak_detected", "leak_detected"],
  sewage_01: ["sewage_leak_detected"],
  gas_01: ["gas_detected", "gas_ppm"],
  smoke_01: ["smoke_detected"],
  temp_01: ["temperature_c"],
};

/** Additive and repeatable. Run after the base demo building/users/devices exist. */
export async function seedSensors(database = db): Promise<void> {
  await database.insert(devices).values([
    { id: "energy_01", name: "Medidor de energia das áreas comuns", type: "ENERGY_METER" },
    { id: "water_meter_01", name: "Hidrômetro geral", type: "WATER_METER" },
    { id: "gas_01", name: "Detector de gás da central de gás", type: "GAS_SENSOR" },
    { id: "smoke_01", name: "Relé da central de incêndio", type: "SMOKE_PANEL_RELAY" },
    { id: "sewage_01", name: "Vazamento de esgoto no subsolo", type: "SEWAGE_LEAK_SENSOR" },
  ].map((device) => ({ ...device, buildingId, gatewayId,
    metadata: { simulated: true, note: "Demonstração. Definir endereço, calibração e mapa de campo antes da instalação." } }))).onConflictDoNothing();

  await database.insert(deviceMetrics).values(Object.entries(mappings).flatMap(([deviceId, metrics]) => metrics.map((key) => {
    const definition = SENSOR_METRICS[key];
    return { buildingId, deviceId, key, label: definition.label, dataType: definition.dataType, decimals: definition.decimals,
      unit: "unit" in definition ? definition.unit : null,
      minExpected: "min" in definition ? definition.min : null,
      maxExpected: "max" in definition ? definition.max : null };
  }))).onConflictDoNothing();

  const defaults: Array<typeof alertRules.$inferInsert> = [];
  for (const phase of ["l1", "l2", "l3"] as const) {
    defaults.push(
      { buildingId, deviceId: "phase_01", name: `Subtensão na fase ${phase.toUpperCase()}`, metric: `voltage_${phase}`, operator: "LT", threshold: 180,
        severity: "CRITICAL", alertType: `LOW_VOLTAGE_${phase.toUpperCase()}`, messageTemplate: `Tensão ${phase.toUpperCase()} abaixo do limite: {value} V`, cooldownSeconds: 300 },
      { buildingId, deviceId: "phase_01", name: `Sobretensão na fase ${phase.toUpperCase()}`, metric: `voltage_${phase}`, operator: "GT", threshold: 260,
        severity: "CRITICAL", alertType: `HIGH_VOLTAGE_${phase.toUpperCase()}`, messageTemplate: `Tensão ${phase.toUpperCase()} acima do limite: {value} V`, cooldownSeconds: 300 },
    );
  }
  const detections = [
    { deviceId: "gas_01", metric: "gas_detected", name: "Gás detectado", alertType: "GAS_DETECTED" },
    { deviceId: "smoke_01", metric: "smoke_detected", name: "Alarme da central de incêndio", alertType: "SMOKE_DETECTED" },
    { deviceId: "leak_01", metric: "water_leak_detected", name: "Vazamento de água detectado", alertType: "WATER_LEAK_DETECTED" },
    { deviceId: "leak_01", metric: "leak_detected", name: "Vazamento de água detectado (legado)", alertType: "WATER_LEAK_DETECTED" },
    { deviceId: "sewage_01", metric: "sewage_leak_detected", name: "Vazamento de esgoto detectado", alertType: "SEWAGE_LEAK_DETECTED" },
  ];
  defaults.push(...detections.map((detection) => ({ ...detection, buildingId, operator: "EQ" as const, threshold: 1,
    severity: detection.metric === "gas_detected" || detection.metric === "smoke_detected" ? "CRITICAL" as const : "HIGH" as const,
    messageTemplate: `${detection.name}. Verifique o local e siga o procedimento do condomínio.`, cooldownSeconds: 300 })));
  defaults.push({ buildingId, deviceId: "temp_01", name: "Temperatura alta na sala técnica", metric: "temperature_c", operator: "GT", threshold: 45,
    severity: "MEDIUM", alertType: "HIGH_TEMPERATURE", messageTemplate: "Temperatura da sala técnica em {value} °C", cooldownSeconds: 1800 });

  // Respect rules already configured by the operator, even when their name differs.
  const existing = await database.select().from(alertRules).where(eq(alertRules.buildingId, buildingId));
  const missing = defaults.filter((rule) => !existing.some((saved) => saved.deviceId === rule.deviceId
    && (saved.name === rule.name || (saved.metric === rule.metric && saved.operator === rule.operator && saved.threshold === rule.threshold))));
  if (missing.length) await database.insert(alertRules).values(missing.map((rule) => ({ ...rule, createdBy: "building_admin" }))).onConflictDoNothing();
}
