import {
  alertRules,
  buildings,
  db,
  deviceMetrics,
  devices,
  gateways,
  memberships,
  organizations,
  users,
} from "./index.js";

await db.insert(users).values([
  { id: "platform_admin", email: "admin@predioon.local", name: "Administrador Prédio ON", isPlatformAdmin: true },
  { id: "building_admin", email: "sindico@predioon.local", name: "Síndico Demo" },
  { id: "resident_demo", email: "morador@predioon.local", name: "Morador Demo" },
]).onConflictDoNothing();

await db.insert(organizations).values({
  id: "org_001",
  name: "Cliente Piloto",
  slug: "cliente-piloto",
}).onConflictDoNothing();

await db.insert(buildings).values({
  id: "bld_001",
  organizationId: "org_001",
  name: "Condomínio Piloto",
  code: "PILOTO",
}).onConflictDoNothing();

await db.insert(memberships).values([
  { userId: "building_admin", buildingId: "bld_001", role: "BUILDING_ADMIN" },
  { userId: "resident_demo", buildingId: "bld_001", role: "RESIDENT", unit: "101" },
]).onConflictDoNothing();

await db.insert(gateways).values({
  id: "gw_001",
  buildingId: "bld_001",
  name: "Gateway principal",
  serialNumber: "GW-PILOTO-001",
  model: "ZLAN5107 / gateway industrial",
  status: "ONLINE",
  metadata: { transport: "RS485", fieldProtocol: "Modbus RTU", cloudProtocol: "MQTT" },
}).onConflictDoNothing();

await db.insert(devices).values([
  {
    id: "water_01",
    buildingId: "bld_001",
    gatewayId: "gw_001",
    name: "Caixa d'água",
    type: "WATER_LEVEL_SENSOR",
    hardwareAddress: "modbus:1",
    status: "ONLINE",
  },
  {
    id: "phase_01",
    buildingId: "bld_001",
    gatewayId: "gw_001",
    name: "Monitor de fases",
    type: "PHASE_MONITOR",
    hardwareAddress: "modbus:2",
    status: "ONLINE",
  },
  {
    id: "leak_01",
    buildingId: "bld_001",
    gatewayId: "gw_001",
    name: "Sensor de vazamento",
    type: "LEAK_SENSOR",
    hardwareAddress: "di:1",
    status: "ONLINE",
  },
  {
    id: "temp_01",
    buildingId: "bld_001",
    gatewayId: "gw_001",
    name: "Sensor de temperatura",
    type: "TEMPERATURE_SENSOR",
    hardwareAddress: "modbus:3",
    status: "ONLINE",
  },
]).onConflictDoNothing();

await db.insert(deviceMetrics).values([
  { buildingId: "bld_001", deviceId: "water_01", key: "water_level_percent", label: "Nível da caixa", unit: "%", minExpected: 0, maxExpected: 100, decimals: 1 },
  { buildingId: "bld_001", deviceId: "water_01", key: "volume_liters", label: "Volume", unit: "L", minExpected: 0, decimals: 0 },
  { buildingId: "bld_001", deviceId: "phase_01", key: "voltage_l1", label: "Tensão L1", unit: "V", minExpected: 180, maxExpected: 260, decimals: 1 },
  { buildingId: "bld_001", deviceId: "leak_01", key: "leak_detected", label: "Vazamento detectado", dataType: "boolean", decimals: 0 },
  { buildingId: "bld_001", deviceId: "temp_01", key: "temperature_c", label: "Temperatura", unit: "°C", minExpected: -10, maxExpected: 80, decimals: 1 },
]).onConflictDoNothing();

await db.insert(alertRules).values([
  {
    buildingId: "bld_001",
    deviceId: "water_01",
    name: "Nível baixo da caixa d'água",
    metric: "water_level_percent",
    operator: "LT",
    threshold: 20,
    severity: "HIGH",
    alertType: "LOW_WATER_LEVEL",
    messageTemplate: "Nível baixo da caixa d'água: {value}%",
    cooldownSeconds: 900,
    createdBy: "building_admin",
  },
  {
    buildingId: "bld_001",
    deviceId: "phase_01",
    name: "Subtensão na fase L1",
    metric: "voltage_l1",
    operator: "LT",
    threshold: 180,
    severity: "CRITICAL",
    alertType: "LOW_VOLTAGE_L1",
    messageTemplate: "Tensão L1 fora do parâmetro: {value} V",
    cooldownSeconds: 300,
    createdBy: "building_admin",
  },
]).onConflictDoNothing();


console.log("Seed concluído: plataforma, prédio, usuários, gateway, dispositivos, métricas e regras.");
process.exit(0);
