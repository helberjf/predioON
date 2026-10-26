// Demonstration field: plays the gateways of the listed demo condominiums over MQTT,
// exactly as real gateways would. Sensors, parking counters and gate controllers
// publish through the broker, the real ingestion stores them, and gate commands get
// an EXECUTED ACK from a protocol-only controller (no relay, GPIO or Modbus exists here).
//
//   DEMO_FIELD=on DEMO_FIELD_BUILDINGS=<id,id> DATABASE_URL_INGEST=... MQTT_URL=... \
//     node --import tsx src/demo-field.ts
//
// It reads its inventory and the presenter's scenario (062) with the restricted
// ingestion login, and never writes to the database. Never run it against a
// condominium with real equipment.
import "./env.js";
import mqtt, { type MqttClient } from "mqtt";
import { and, eq, inArray } from "drizzle-orm";
import { devices, gateways, gates, ingestDb, ingestSqlClient, parkingLots } from "@predioon/db/ingest";
import { accessTopic, DEMO_SCENARIOS, gatewayStatusTopic, type DemoScenario, type GatewayStatus } from "@predioon/shared";
import { createGateSimulator } from "./access/simulation.js";
import { DEMO_FULL_EVERY, demoCycleMessages, nextParking, type DemoParkingLot } from "./simulator/demo-field-plan.js";
import { initialState, nextState, type FieldState } from "./simulator/state.js";

if (process.env.DEMO_FIELD !== "on") throw new Error("Defina DEMO_FIELD=on: este processo simula equipamentos e só pode rodar numa demonstração");
if (process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL (conexão dona) não pode estar no ambiente do campo de demonstração");
const buildingIds = (process.env.DEMO_FIELD_BUILDINGS ?? "").split(",").map(value => value.trim()).filter(Boolean);
if (!buildingIds.length) throw new Error("Defina DEMO_FIELD_BUILDINGS com os condomínios de demonstração");
const intervalMs = Number(process.env.DEMO_FIELD_INTERVAL_MS ?? 15_000);
// Gate controllers report every cycle and must have been seen within 60 s.
if (!Number.isFinite(intervalMs) || intervalMs < 5_000 || intervalMs > 30_000) throw new Error("DEMO_FIELD_INTERVAL_MS deve estar entre 5000 e 30000");
const mqttUrl = process.env.MQTT_URL ?? "mqtt://localhost:1883";
// Rediscover equipment so a gate enabled or a sensor added during the demo starts playing.
const DISCOVERY_MS = 60_000, STATUS_EVERY = 3;

type GateIdentity = { buildingId: string; gatewayId: string; gateId: string; deviceId: string };
type GatewayPlayer = { client: MqttClient; connectedSince: Date; subscribed: Map<string, (value: unknown, now: Date, retained: boolean) => unknown> };
type BuildingField = { state: FieldState; tick: number; parking: Map<string, number>; sent: Map<string, string> };

const players = new Map<string, GatewayPlayer>();
const fields = new Map<string, BuildingField>(buildingIds.map(id => [id, { state: initialState(), tick: 0, parking: new Map(), sent: new Map() }]));
let inventory: Awaited<ReturnType<typeof discover>> = { gateways: [], devices: [], gates: [], lots: [] };

async function discover() {
  const gatewayRows = await ingestDb.select({ id: gateways.id, buildingId: gateways.buildingId }).from(gateways)
    .where(and(inArray(gateways.buildingId, buildingIds), eq(gateways.enabled, true)));
  const deviceRows = await ingestDb.select({ id: devices.id, buildingId: devices.buildingId, gatewayId: devices.gatewayId, type: devices.type })
    .from(devices).where(and(inArray(devices.buildingId, buildingIds), eq(devices.enabled, true)));
  const gateRows = await ingestDb.select({ id: gates.id, buildingId: gates.buildingId, deviceId: gates.deviceId }).from(gates)
    .where(inArray(gates.buildingId, buildingIds));
  const lots = await ingestDb.select({ buildingId: parkingLots.buildingId, sensorId: parkingLots.sensorId, capacity: parkingLots.capacity })
    .from(parkingLots).where(inArray(parkingLots.buildingId, buildingIds));
  return { gateways: gatewayRows, devices: deviceRows, gates: gateRows,
    lots: lots.filter((lot): lot is typeof lot & { sensorId: string } => lot.sensorId !== null) };
}

async function scenarios(): Promise<Map<string, DemoScenario>> {
  const rows = await ingestSqlClient<{ building_id: string; scenario: string }[]>`
    select building_id, scenario from demo_scenarios where building_id = any(${buildingIds})`;
  return new Map(rows.filter(row => (DEMO_SCENARIOS as readonly string[]).includes(row.scenario))
    .map(row => [row.building_id, row.scenario as DemoScenario]));
}

const statusPayload = (buildingId: string, gatewayId: string, state: "ONLINE" | "OFFLINE") => JSON.stringify({
  schemaVersion: 1, buildingId, gatewayId, state, firmwareVersion: "demo-field-1", timestamp: new Date().toISOString(),
} satisfies GatewayStatus);

function player(buildingId: string, gatewayId: string): GatewayPlayer {
  const existing = players.get(gatewayId);
  if (existing) return existing;
  // The same identity a real gateway uses: one session per gateway id.
  const client = mqtt.connect(mqttUrl, {
    protocolVersion: 5, clean: true, properties: { sessionExpiryInterval: 0 }, queueQoSZero: false,
    // The demo broker is reachable only inside its own network and accepts these sessions.
    clientId: gatewayId, username: `gw_${gatewayId}`, reconnectPeriod: 5_000,
    will: { topic: gatewayStatusTopic(buildingId, gatewayId), payload: Buffer.from(statusPayload(buildingId, gatewayId, "OFFLINE")), qos: 1, retain: true },
  });
  const created: GatewayPlayer = { client, connectedSince: new Date(), subscribed: new Map() };
  client.on("connect", () => {
    created.connectedSince = new Date();
    // A reconnect starts a clean session: subscribe again with fresh duplicate guards.
    const topics = [...created.subscribed.keys()];
    created.subscribed.clear();
    for (const topic of topics) subscribeGate(created, JSON.parse(topicIdentity.get(topic)!) as GateIdentity);
    client.publish(gatewayStatusTopic(buildingId, gatewayId), statusPayload(buildingId, gatewayId, "ONLINE"), { qos: 1, retain: true });
    console.log(`[demo] gateway ${gatewayId} conectado (${buildingId})`);
  });
  client.on("message", (topic, payload, packet) => {
    const simulate = created.subscribed.get(topic);
    if (!simulate || payload.length > 2048) return;
    try {
      const ack = simulate(JSON.parse(payload.toString("utf8")), new Date(), packet.retain);
      const identity = JSON.parse(topicIdentity.get(topic)!) as GateIdentity;
      if (ack && client.connected) {
        client.publish(accessTopic(identity.buildingId, identity.gatewayId, identity.gateId, "ack"), JSON.stringify(ack), { qos: 0, retain: false });
        console.log(`[demo] portão ${identity.gateId} executou o comando simulado`);
      }
    } catch { /* malformed commands have no side effects */ }
  });
  client.on("error", error => console.error(`[demo] gateway ${gatewayId}:`, error.message));
  players.set(gatewayId, created);
  return created;
}

const topicIdentity = new Map<string, string>();
function subscribeGate(target: GatewayPlayer, identity: GateIdentity) {
  const topic = accessTopic(identity.buildingId, identity.gatewayId, identity.gateId, "command");
  if (target.subscribed.has(topic)) return;
  topicIdentity.set(topic, JSON.stringify(identity));
  target.subscribed.set(topic, createGateSimulator(identity, target.connectedSince));
  if (target.client.connected) target.client.subscribe(topic, { qos: 0 }, error => {
    if (error) console.error(`[demo] assinatura do portão ${identity.gateId} recusada:`, error.message);
  });
}

async function refreshInventory() {
  inventory = await discover();
  for (const gateway of inventory.gateways) player(gateway.buildingId, gateway.id);
  for (const gate of inventory.gates) {
    const device = inventory.devices.find(item => item.id === gate.deviceId);
    const gatewayId = device?.gatewayId;
    if (!gatewayId || !players.has(gatewayId)) continue;
    subscribeGate(players.get(gatewayId)!, { buildingId: gate.buildingId, gatewayId, gateId: gate.id, deviceId: gate.deviceId });
  }
  console.log(`[demo] ${inventory.gateways.length} gateways, ${inventory.devices.length} equipamentos, ${inventory.gates.length} portões, ${inventory.lots.length} vagas`);
}

let cycle = 0;
async function tick() {
  cycle++;
  const chosen = await scenarios();
  const at = new Date();
  for (const [buildingId, field] of fields) {
    const scenario = chosen.get(buildingId) ?? "normal";
    field.tick++;
    field.state = nextState(field.state, field.tick, scenario, intervalMs / 1000);
    const lots: DemoParkingLot[] = inventory.lots.filter(lot => lot.buildingId === buildingId);
    field.parking = nextParking(lots, field.parking, at);
    for (const gateway of inventory.gateways.filter(item => item.buildingId === buildingId)) {
      const target = players.get(gateway.id);
      if (!target?.client.connected) continue;
      // gateway-drop: the gateway goes silent and the platform must notice on its own.
      if (!field.state.gatewayOnline) continue;
      if (cycle % STATUS_EVERY === 1) target.client.publish(gatewayStatusTopic(buildingId, gateway.id), statusPayload(buildingId, gateway.id, "ONLINE"), { qos: 1, retain: true });
      const owned = inventory.devices.filter(device => device.buildingId === buildingId && device.gatewayId === gateway.id);
      for (const message of demoCycleMessages(buildingId, owned, field.state, field.parking, at, field.tick % DEMO_FULL_EVERY === 1, field.sent))
        target.client.publish(message.topic, message.payload, { qos: 1 });
    }
  }
}

await refreshInventory();
setInterval(() => void refreshInventory().catch(error => console.error("[demo] inventário:", error.message)), DISCOVERY_MS);
setInterval(() => void tick().catch(error => console.error("[demo] ciclo:", error.message)), intervalMs);
console.log(`[demo] campo de demonstração ligado para ${buildingIds.join(", ")} a cada ${intervalMs} ms. Nenhum equipamento real é acionado.`);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  for (const [gatewayId, target] of players) {
    const gateway = inventory.gateways.find(item => item.id === gatewayId);
    if (gateway && target.client.connected) target.client.publish(gatewayStatusTopic(gateway.buildingId, gatewayId), statusPayload(gateway.buildingId, gatewayId, "OFFLINE"), { qos: 1, retain: true });
    target.client.end(false);
  }
  void ingestSqlClient.end({ timeout: 5 }).finally(() => process.exit(0));
});
