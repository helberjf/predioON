import { hash } from "@node-rs/argon2";
import { seedFeatures } from "./seed-features.js";
import {
  alertRules,
  buildings,
  commonAreas,
  db,
  deviceMetrics,
  devices,
  gateways,
  memberships,
  notices,
  organizations,
  users,
} from "./index.js";

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "predioon123";
const passwordHash = await hash(DEMO_PASSWORD);

// ---------------------------------------------------------------- pessoas
await db
  .insert(users)
  .values([
    { id: "platform_admin", email: "admin@predioon.local", name: "Administrador Prédio ON", isPlatformAdmin: true, passwordHash },
    { id: "building_admin", email: "sindico@predioon.local", name: "Síndico Demo", passwordHash },
    { id: "resident_demo", email: "morador@predioon.local", name: "Morador Demo", passwordHash },
  ])
  .onConflictDoUpdate({ target: users.id, set: { passwordHash } });

await db
  .insert(organizations)
  .values({ id: "org_001", name: "Cliente Piloto", slug: "cliente-piloto" })
  .onConflictDoNothing();

await db
  .insert(buildings)
  .values({ id: "bld_001", organizationId: "org_001", name: "Condomínio Piloto", code: "PILOTO" })
  .onConflictDoNothing();

await db
  .insert(memberships)
  .values([
    { userId: "building_admin", buildingId: "bld_001", role: "BUILDING_ADMIN" },
    { userId: "resident_demo", buildingId: "bld_001", role: "RESIDENT", unit: "101" },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------- campo
await db
  .insert(gateways)
  .values({
    id: "gw_001",
    buildingId: "bld_001",
    name: "Gateway principal",
    serialNumber: "GW-PILOTO-001",
    model: "ZLAN5107 / gateway industrial",
    status: "ONLINE",
    lastSeenAt: new Date(),
    metadata: { transport: "RS485", fieldProtocol: "Modbus RTU", cloudProtocol: "MQTT" },
  })
  .onConflictDoNothing();

// `metadata` carrega o mapa Modbus de cada modelo de sensor: trocar de sensor vira cadastro.
await db
  .insert(devices)
  .values([
    {
      id: "water_01",
      buildingId: "bld_001",
      gatewayId: "gw_001",
      name: "Caixa d'água",
      type: "WATER_LEVEL_SENSOR",
      hardwareAddress: "modbus:1",
      status: "ONLINE",
      metadata: { slaveId: 1, register: 0, scale: 0.001, capacityLiters: 10000 },
    },
    {
      id: "pump_01",
      buildingId: "bld_001",
      gatewayId: "gw_001",
      name: "Bomba de recalque",
      type: "PUMP_MONITOR",
      hardwareAddress: "di:2",
      status: "ONLINE",
      metadata: { input: "DI2", note: "contato auxiliar do contator" },
    },
    {
      id: "phase_01",
      buildingId: "bld_001",
      gatewayId: "gw_001",
      name: "Monitor de fases",
      type: "PHASE_MONITOR",
      hardwareAddress: "modbus:2",
      status: "ONLINE",
      metadata: { slaveId: 2 },
    },
    {
      id: "leak_01",
      buildingId: "bld_001",
      gatewayId: "gw_001",
      name: "Sensor de vazamento",
      type: "LEAK_SENSOR",
      hardwareAddress: "di:1",
      status: "ONLINE",
      metadata: { input: "DI1", location: "casa de bombas" },
    },
    {
      id: "temp_01",
      buildingId: "bld_001",
      gatewayId: "gw_001",
      name: "Temperatura da sala técnica",
      type: "TEMPERATURE_SENSOR",
      hardwareAddress: "modbus:3",
      status: "ONLINE",
      metadata: { slaveId: 3 },
    },
  ])
  .onConflictDoNothing();

await db
  .insert(deviceMetrics)
  .values([
    { buildingId: "bld_001", deviceId: "water_01", key: "water_level_percent", label: "Nível da caixa", unit: "%", minExpected: 0, maxExpected: 100, decimals: 1 },
    { buildingId: "bld_001", deviceId: "water_01", key: "volume_liters", label: "Volume", unit: "L", minExpected: 0, decimals: 0 },
    { buildingId: "bld_001", deviceId: "pump_01", key: "pump_running", label: "Bomba ligada", dataType: "boolean", decimals: 0 },
    { buildingId: "bld_001", deviceId: "phase_01", key: "voltage_l1", label: "Tensão L1", unit: "V", minExpected: 180, maxExpected: 260, decimals: 1 },
    { buildingId: "bld_001", deviceId: "phase_01", key: "voltage_l2", label: "Tensão L2", unit: "V", minExpected: 180, maxExpected: 260, decimals: 1 },
    { buildingId: "bld_001", deviceId: "phase_01", key: "voltage_l3", label: "Tensão L3", unit: "V", minExpected: 180, maxExpected: 260, decimals: 1 },
    { buildingId: "bld_001", deviceId: "leak_01", key: "leak_detected", label: "Vazamento detectado", dataType: "boolean", decimals: 0 },
    { buildingId: "bld_001", deviceId: "temp_01", key: "temperature_c", label: "Temperatura", unit: "°C", minExpected: -10, maxExpected: 80, decimals: 1 },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------- regras de alerta
await db
  .insert(alertRules)
  .values([
    { buildingId: "bld_001", deviceId: "water_01", name: "Nível baixo da caixa", metric: "water_level_percent", operator: "LT", threshold: 20, severity: "HIGH", alertType: "LOW_WATER_LEVEL", messageTemplate: "Nível baixo da caixa d'água: {value}%", cooldownSeconds: 900, createdBy: "building_admin" },
    { buildingId: "bld_001", deviceId: "water_01", name: "Nível crítico da caixa", metric: "water_level_percent", operator: "LT", threshold: 10, severity: "CRITICAL", alertType: "CRITICAL_WATER_LEVEL", messageTemplate: "Nível crítico da caixa d'água: {value}%", cooldownSeconds: 600, createdBy: "building_admin" },
    { buildingId: "bld_001", deviceId: "phase_01", name: "Subtensão na fase L1", metric: "voltage_l1", operator: "LT", threshold: 180, severity: "CRITICAL", alertType: "LOW_VOLTAGE_L1", messageTemplate: "Tensão L1 fora do parâmetro: {value} V", cooldownSeconds: 300, createdBy: "building_admin" },
    { buildingId: "bld_001", deviceId: "phase_01", name: "Falta de fase L3", metric: "voltage_l3", operator: "LT", threshold: 100, severity: "CRITICAL", alertType: "PHASE_LOSS_L3", messageTemplate: "Possível falta de fase em L3: {value} V", cooldownSeconds: 300, createdBy: "building_admin" },
    { buildingId: "bld_001", deviceId: "temp_01", name: "Temperatura alta na sala técnica", metric: "temperature_c", operator: "GT", threshold: 45, severity: "MEDIUM", alertType: "HIGH_TEMPERATURE", messageTemplate: "Temperatura da sala técnica em {value} °C", cooldownSeconds: 1800, createdBy: "building_admin" },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------- convivência
await db
  .insert(notices)
  .values([
    { buildingId: "bld_001", category: "WASTE_COLLECTION", title: "Coleta de lixo", body: "Coleta hoje a partir das 19:00. Deixe os sacos no compartimento até as 18:30.", createdBy: "building_admin" },
    { buildingId: "bld_001", category: "MAINTENANCE", title: "Manutenção da bomba", body: "Manutenção preventiva da bomba de recalque amanhã, das 9:00 às 11:00. Pode haver oscilação no abastecimento.", createdBy: "building_admin" },
    { buildingId: "bld_001", category: "EVENT", title: "Reunião de condomínio", body: "Assembleia ordinária no salão de festas, às 19:00. Pauta: orçamento e obras.", pinned: true, createdBy: "building_admin" },
  ])
  .onConflictDoNothing();

await db
  .insert(commonAreas)
  .values([
    { buildingId: "bld_001", name: "Salão de festas", capacity: 50, opensAt: "10:00", closesAt: "23:00", requiresApproval: true, rules: "Devolver limpo. Som até 22h." },
    { buildingId: "bld_001", name: "Churrasqueira", capacity: 20, opensAt: "10:00", closesAt: "22:00", requiresApproval: true },
    { buildingId: "bld_001", name: "Espaço gourmet", capacity: 30, opensAt: "10:00", closesAt: "22:00", requiresApproval: false },
    { buildingId: "bld_001", name: "Quadra esportiva", capacity: 20, opensAt: "07:00", closesAt: "22:00", requiresApproval: false, maxHoursPerBooking: 2 },
  ])
  .onConflictDoNothing();

await seedFeatures();
console.log("Seed concluído. Usuários de demonstração (senha definida por SEED_PASSWORD ou padrão local):");
console.log("  admin@predioon.local    (administrador da plataforma)");
console.log("  sindico@predioon.local  (administrador do prédio)");
console.log("  morador@predioon.local  (morador)");
process.exit(0);
