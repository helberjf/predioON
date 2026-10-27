import { sql } from "drizzle-orm";
import { SENSOR_METRICS, type SensorMetric } from "@predioon/shared";
import { db } from "./index.js";
import { deviceMetrics, devices } from "./schema.js";

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

  await database.execute(sql`select seed_default_alert_rules(${buildingId})`);
}
