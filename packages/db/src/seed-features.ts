import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, devices, gates, monitoringProfiles, parkingLots, sqlClient } from "./index.js";
import { seedSensors } from "./seed-sensors.js";

/** Demo records only; no controller is enabled and no physical command is sent. */
export async function seedFeatures() {
  await seedSensors();
  await db.insert(monitoringProfiles).values([
    { buildingId: "bld_001", deviceId: "energy_01", kind: "ENERGY", tariff: 1, dailyCostLimit: 20, dailyLimit: 20 },
    { buildingId: "bld_001", deviceId: "water_meter_01", kind: "WATER", tariff: null, dailyLimit: 20 },
    { buildingId: "bld_001", deviceId: "pump_01", kind: "PUMP", dailyLimit: 60, continuousLimitMinutes: 60 },
  ]).onConflictDoNothing();
  await db.insert(devices).values([
    { id: "gate_garage_01", name: "Controlador da garagem", type: "GATE_CONTROLLER" },
    { id: "gate_pedestrian_01", name: "Controlador do portão de pedestres", type: "GATE_CONTROLLER" },
    { id: "parking_car_01", name: "Contagem de carros", type: "PARKING_SENSOR" },
    { id: "parking_moto_01", name: "Contagem de motos", type: "PARKING_SENSOR" },
  ].map(d => ({ ...d, buildingId: "bld_001", gatewayId: "gw_001", metadata: { simulated: true } }))).onConflictDoNothing();
  await db.insert(gates).values([
    { buildingId: "bld_001", name: "Garagem", kind: "GARAGE", deviceId: "gate_garage_01", gatewayId: "gw_001", enabled: false, allowResidents: false },
    { buildingId: "bld_001", name: "Pedestres", kind: "PEDESTRIAN", deviceId: "gate_pedestrian_01", gatewayId: "gw_001", enabled: false, allowResidents: false },
  ]).onConflictDoNothing();
  await db.insert(parkingLots).values([
    { buildingId: "bld_001", vehicleType: "CAR", capacity: 20, sensorId: "parking_car_01" },
    { buildingId: "bld_001", vehicleType: "MOTORCYCLE", capacity: 10, sensorId: "parking_moto_01" },
  ]).onConflictDoNothing();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await seedFeatures(); console.log("Recursos de demonstração cadastrados. Tarifa de energia ilustrativa: R$ 1/kWh. Portões desativados."); }
  finally { await sqlClient.end(); }
}
