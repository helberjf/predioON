import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { accessTopic, gatewayStatusTopic, telemetryTopic } from "@predioon/shared";
import { createGateSimulator } from "./simulation.js";

// This entry point is deliberately separate from the regular sensor simulator.
// Local broker only: cannot be pointed at a production controller by accident.
const url = process.env.ACCESS_SIM_MQTT_URL ?? "mqtt://127.0.0.1:1883";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("O simulador de acesso aceita somente um broker local");
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Defina ${key}`); return value; };
const identity = { buildingId: required("ACCESS_SIM_BUILDING_ID"), gatewayId: required("ACCESS_SIM_GATEWAY_ID"), gateId: required("ACCESS_SIM_GATE_ID"), deviceId: required("ACCESS_SIM_DEVICE_ID") };
const commandTopic = accessTopic(identity.buildingId, identity.gatewayId, identity.gateId, "command");
const ackTopic = accessTopic(identity.buildingId, identity.gatewayId, identity.gateId, "ack");
let simulate = createGateSimulator(identity, new Date());
let timer: ReturnType<typeof setInterval> | undefined;
const status = (state: "ONLINE" | "OFFLINE") => JSON.stringify({ schemaVersion: 1, buildingId: identity.buildingId, gatewayId: identity.gatewayId, state, firmwareVersion: "access-simulator-1", timestamp: new Date().toISOString() });
const client = mqtt.connect(url, { protocolVersion: 5, clean: true, properties: { sessionExpiryInterval: 0 }, queueQoSZero: false,
  username: process.env.ACCESS_SIM_MQTT_USERNAME ?? `gw_${identity.gatewayId}`, password: process.env.ACCESS_SIM_MQTT_PASSWORD, clientId: identity.gatewayId,
  will: { topic: gatewayStatusTopic(identity.buildingId, identity.gatewayId), payload: status("OFFLINE"), qos: 1, retain: true },
});
function heartbeat() {
  if (!client.connected) return;
  client.publish(gatewayStatusTopic(identity.buildingId, identity.gatewayId), status("ONLINE"), { qos: 0, retain: true });
  client.publish(telemetryTopic(identity.buildingId, identity.deviceId), JSON.stringify({ schemaVersion: 1, eventId: randomUUID(), buildingId: identity.buildingId, deviceId: identity.deviceId, metric: "gate_open", value: false, quality: "GOOD", timestamp: new Date().toISOString() }), { qos: 0, retain: false });
}
client.on("connect", () => {
  simulate = createGateSimulator(identity, new Date());
  client.subscribe(commandTopic, { qos: 0 }, error => { if (error) console.error("Assinatura de acesso recusada:", error.message); });
  if (timer) clearInterval(timer);
  heartbeat(); timer = setInterval(heartbeat, 5000);
  console.log("[SIMULAÇÃO] Controlador local de acesso conectado. Nenhum atuador físico é utilizado.");
});
client.on("message", (topic, payload, packet) => {
  if (topic !== commandTopic || payload.length > 2048) return;
  try {
    const ack = simulate(JSON.parse(payload.toString("utf8")), new Date(), packet.retain);
    if (ack && client.connected) client.publish(ackTopic, JSON.stringify(ack), { qos: 0, retain: false });
  } catch { /* malformed commands have no side effects */ }
});
client.on("error", error => console.error("Simulador de acesso:", error.message));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  if (timer) clearInterval(timer);
  if (client.connected) client.publish(gatewayStatusTopic(identity.buildingId, identity.gatewayId), status("OFFLINE"), { qos: 0, retain: true });
  client.end(false, () => process.exit(0));
});
