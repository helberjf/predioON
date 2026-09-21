import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import { gatewayStatusTopic, telemetryTopic, waterTelemetryTopic, type GatewayStatus, type Telemetry } from "@predioon/shared";
import { config } from "./config.js";
import { initialState, nextState, type FieldState, type Scenario } from "./simulator/state.js";

const SCENARIOS: Scenario[] = ["normal", "low-water", "power-loss", "leak", "stuck-sensor", "gateway-drop"];

const arg = process.argv.find((value) => value.startsWith("--scenario="))?.split("=")[1] ?? "normal";
const scenario = (SCENARIOS as string[]).includes(arg) ? (arg as Scenario) : "normal";

const buildingId = process.env.SIM_BUILDING_ID ?? "bld_001";
const gatewayId = process.env.SIM_GATEWAY_ID ?? "gw_001";
const intervalMs = Number(process.env.SIM_INTERVAL_MS ?? 5000);

const client = mqtt.connect(config.MQTT_URL, {
  username: process.env.SIM_MQTT_USERNAME ?? config.MQTT_USERNAME,
  password: process.env.SIM_MQTT_PASSWORD ?? config.MQTT_PASSWORD,
  clientId: process.env.SIM_MQTT_CLIENT_ID ?? gatewayId,
  rejectUnauthorized: true,
  ...(config.MQTT_CA_FILE ? { ca: readFileSync(config.MQTT_CA_FILE) } : {}),
  // Last will: if this process dies, the broker publishes OFFLINE for us.
  will: {
    topic: gatewayStatusTopic(buildingId, gatewayId),
    qos: 1,
    retain: true,
    payload: JSON.stringify({
      schemaVersion: 1,
      buildingId,
      gatewayId,
      state: "OFFLINE",
      timestamp: new Date().toISOString(),
    } satisfies GatewayStatus),
  },
});

function publishTelemetry(deviceId: string, metric: string, value: number | boolean, unit?: string): void {
  const payload: Telemetry = {
    schemaVersion: 1,
    eventId: randomUUID(),
    buildingId,
    deviceId,
    metric,
    value,
    ...(unit ? { unit } : {}),
    quality: "GOOD",
    timestamp: new Date().toISOString(),
  };
  client.publish(telemetryTopic(buildingId, deviceId), JSON.stringify(payload), { qos: 1 });
}

function publishGatewayState(state: "ONLINE" | "OFFLINE"): void {
  const payload: GatewayStatus = {
    schemaVersion: 1,
    buildingId,
    gatewayId,
    state,
    firmwareVersion: "sim-1.0.0",
    timestamp: new Date().toISOString(),
  };
  client.publish(gatewayStatusTopic(buildingId, gatewayId), JSON.stringify(payload), { qos: 1, retain: true });
}

function publishCycle(state: FieldState): void {
  if (!state.gatewayOnline) return; // gateway-drop: nothing reaches the platform

  client.publish(waterTelemetryTopic(buildingId, "water_01"), JSON.stringify({
    device_id: "water_01", type: "nivel_caixa_agua", nivel_percentual: state.waterLevelPercent,
    volume_litros: state.waterVolumeLiters,
    // Synthetic 2 m tank, only for the demonstration; never a hardware register mapping.
    distancia_mm: Math.round((1 - state.waterLevelPercent / 100) * 2000),
    timestamp: new Date().toISOString(),
  }), { qos: 1 });
  publishTelemetry("pump_01", "pump_running", state.pumpRunning);
  publishTelemetry("phase_01", "voltage_l1", state.voltageL1, "V");
  publishTelemetry("phase_01", "voltage_l2", state.voltageL2, "V");
  publishTelemetry("phase_01", "voltage_l3", state.voltageL3, "V");
  publishTelemetry("leak_01", "leak_detected", state.leakDetected);
  publishTelemetry("temp_01", "temperature_c", state.temperatureC, "°C");
}

let state = initialState();
let tick = 0;
let interval: NodeJS.Timeout | undefined;

client.on("connect", () => {
  console.log(`[simulador] cenário "${scenario}" · prédio ${buildingId} · a cada ${intervalMs}ms`);
  publishGatewayState(state.gatewayOnline ? "ONLINE" : "OFFLINE");

  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    tick += 1;
    const previous = state;
    state = nextState(state, tick, scenario);

    if (previous.gatewayOnline !== state.gatewayOnline) {
      publishGatewayState(state.gatewayOnline ? "ONLINE" : "OFFLINE");
    }

    publishCycle(state);
    console.log(
      `[simulador] água=${state.waterLevelPercent.toFixed(1)}% (${state.waterVolumeLiters} L) ` +
        `bomba=${state.pumpRunning ? "ON" : "OFF"} L1=${state.voltageL1}V L3=${state.voltageL3}V ` +
        `vazamento=${state.leakDetected} temp=${state.temperatureC}°C`,
    );
  }, intervalMs);
});

client.on("error", (error) => console.error("[simulador] erro MQTT:", error.message));
