/** Isolated local acceptance test. Broker must use the HTTP authorizer and a trusted test certificate. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import mqtt from "mqtt";
import { eq } from "drizzle-orm";
import { db, devices, gateways, alertRules, alerts, telemetry, sqlClient } from "@predioon/db";
import { handleTelemetry } from "../src/pipeline/telemetry.js";

const root = process.env.MQTT_VERIFY_ROOT ?? "../..";
const ingestPassword = process.env.MQTT_VERIFY_INGEST_PASSWORD;
if (!ingestPassword) throw new Error("Defina MQTT_VERIFY_INGEST_PASSWORD com a senha da ingestão do broker de teste.");
const ca = readFileSync(process.env.MQTT_VERIFY_CA_FILE ?? resolve(root, ".local/mqtt-certs/fullchain.pem"));
const url = process.env.MQTT_VERIFY_URL ?? "mqtts://localhost:9883";
const apiUrl = process.env.MQTT_VERIFY_API ?? "http://localhost:3300";
const options = { protocolVersion: 5 as const, ca, rejectUnauthorized: true, reconnectPeriod: 0, connectTimeout: 5000 };
const gatewayId = `gw_verify_${randomUUID().slice(0,8)}`;
const deviceId = `water_verify_${randomUUID().slice(0,8)}`;
const clients: mqtt.MqttClient[] = [];
let ingestionError: unknown;
try {
  await db.insert(gateways).values({ id: gatewayId, buildingId: "bld_001", name: "Verificação temporária", serialNumber: gatewayId });
  await db.insert(devices).values({ id: deviceId, gatewayId, buildingId: "bld_001", name: "Sensor de verificação", type: "WATER_LEVEL_SENSOR" });
  await db.insert(alertRules).values({ buildingId: "bld_001", deviceId, name: deviceId, metric: "water_level_percent", operator: "LT", threshold: 20,
    severity: "HIGH", alertType: "LOW_WATER_LEVEL", messageTemplate: "Verificação: {value}%", cooldownSeconds: 300 });
  const login = await fetch(`${apiUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@predioon.local", password: "predioon123" }) });
  assert.equal(login.status, 200);
  const { accessToken } = await login.json() as { accessToken: string };
  const issued = await fetch(`${apiUrl}/gateways/${gatewayId}/credentials`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(issued.status, 201);
  const credential = await issued.json() as { mqttUsername: string; mqttPassword: string; mqttClientId: string };
  const ingest = await mqtt.connectAsync(url, { ...options, clientId: "verification-ingest", username: "predioon_ingest", password: ingestPassword });
  clients.push(ingest);
  await ingest.subscribeAsync("predio/+/caixa_agua/+/telemetria", { qos: 1 });
  ingest.on("message", (topic, payload) => { void handleTelemetry(topic, payload).catch(error => { ingestionError = error; }); });
  const gateway = await mqtt.connectAsync(url, { ...options, clientId: credential.mqttClientId, username: credential.mqttUsername, password: credential.mqttPassword });
  clients.push(gateway);
  const message = JSON.stringify({ device_id: deviceId, type: "nivel_caixa_agua", nivel_percentual: 18, distancia_mm: 650, volume_litros: 900, timestamp: new Date().toISOString() });
  const topic = `predio/bld_001/caixa_agua/${deviceId}/telemetria`;
  await gateway.publishAsync(topic, message, { qos: 1 });
  await gateway.publishAsync(topic, message, { qos: 1 });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (ingestionError) throw ingestionError;
    const stored = await db.select().from(telemetry).where(eq(telemetry.deviceId, deviceId));
    if (stored.length === 3) break;
    await pause(100);
  }
  assert.equal((await db.select().from(telemetry).where(eq(telemetry.deviceId, deviceId))).length, 3);
  assert.equal((await db.select().from(alerts).where(eq(alerts.deviceId, deviceId))).length, 1);
  const latest = await fetch(`${apiUrl}/telemetry/latest?buildingId=bld_001`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(latest.status, 200);
  const body = await latest.json() as { items: {device_id:string}[] };
  assert.equal(body.items.filter(item => item.device_id === deviceId).length, 3);
  console.log("PASS: certificado validado, credencial emitida pela API, MQTT → banco → alerta → API, reenvio sem duplicação.");
  await assert.rejects(mqtt.connectAsync(url, { ...options, clientId: gatewayId + "-wrong", username: credential.mqttUsername, password: "errada" }));
  let denied = false;
  try { await gateway.publishAsync("predio/bld_001/device/water_01/telemetry", "{}", { qos: 1 }); } catch { denied = true; }
  assert.equal(denied, true, "broker deve negar publicação em sensor de outro gateway");
  console.log("PASS: broker rejeita credenciais incorretas e publicação no sensor de outro gateway.");
} finally {
  for (const client of clients) await client.endAsync(true);
  await db.delete(devices).where(eq(devices.id, deviceId));
  await db.delete(gateways).where(eq(gateways.id, gatewayId));
  await sqlClient.end();
}
