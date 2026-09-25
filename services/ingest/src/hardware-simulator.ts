import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import { gatewayStatusTopic, telemetryTopic, waterTelemetryTopic, type GatewayStatus, type Telemetry } from "@predioon/shared";
import { config } from "./config.js";
import { initialState, nextState, SCENARIOS, type FieldState, type Scenario } from "./simulator/state.js";

const arg = process.argv.find((value) => value.startsWith("--scenario="))?.split("=")[1] ?? "normal";
if (!(SCENARIOS as readonly string[]).includes(arg)) throw new Error(`Cenário desconhecido: ${arg}. Opções: ${SCENARIOS.join(", ")}`);
const scenario = arg as Scenario;

const buildingId = process.env.SIM_BUILDING_ID ?? "bld_001";
const gatewayId = process.env.SIM_GATEWAY_ID ?? "gw_001";
const intervalMs = Number(process.env.SIM_INTERVAL_MS ?? 5000);
const timeScale = Number(process.env.SIM_TIME_SCALE ?? 1);
if (!Number.isFinite(intervalMs) || intervalMs < 500 || intervalMs > 300_000) throw new Error("SIM_INTERVAL_MS deve estar entre 500 e 300000");
if (!Number.isFinite(timeScale) || timeScale < 1 || timeScale > 3600) throw new Error("SIM_TIME_SCALE deve estar entre 1 e 3600");

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
    firmwareVersion: "sim-2.0.0",
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
  publishTelemetry("phase_01", "current_l1", state.currentL1, "A");
  publishTelemetry("phase_01", "current_l2", state.currentL2, "A");
  publishTelemetry("phase_01", "current_l3", state.currentL3, "A");
  publishTelemetry("phase_01", "frequency_hz", state.frequencyHz, "Hz");
  publishTelemetry("energy_01", "energy_total_kwh", Math.round(state.energyTotalKwh * 1e6) / 1e6, "kWh");
  publishTelemetry("water_meter_01", "water_total_m3", Math.round(state.waterTotalM3 * 1e6) / 1e6, "m³");
  publishTelemetry("leak_01", "water_leak_detected", state.leakDetected);
  publishTelemetry("sewage_01", "sewage_leak_detected", state.sewageLeakDetected);
  publishTelemetry("gas_01", "gas_detected", state.gasDetected);
  publishTelemetry("gas_01", "gas_ppm", state.gasPpm, "ppm");
  publishTelemetry("smoke_01", "smoke_detected", state.smokeDetected);
  publishTelemetry("temp_01", "temperature_c", state.temperatureC, "°C");
}

let state = initialState();
let tick = 0;
let interval: NodeJS.Timeout | undefined;

client.on("connect", () => {
  console.log(`[SIMULAÇÃO] cenário "${scenario}" · prédio ${buildingId} · a cada ${intervalMs}ms · avanço físico ${timeScale}x`);
  if (timeScale !== 1) console.log("[SIMULAÇÃO] acumuladores acelerados; horários reais. Taxas calculadas também serão amplificadas. Duração de bomba e cooldowns usam tempo real.");
  publishGatewayState(state.gatewayOnline ? "ONLINE" : "OFFLINE");

  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    tick += 1;
    const previous = state;
    state = nextState(state, tick, scenario, intervalMs / 1000 * timeScale);

    if (previous.gatewayOnline !== state.gatewayOnline) {
      publishGatewayState(state.gatewayOnline ? "ONLINE" : "OFFLINE");
    }

    publishCycle(state);
    console.log(
      `[simulador] água=${state.waterLevelPercent.toFixed(1)}% (${state.waterVolumeLiters} L) ` +
        `bomba=${state.pumpRunning ? "ON" : "OFF"} L1=${state.voltageL1}V L3=${state.voltageL3}V ` +
        `água=${state.waterTotalM3.toFixed(3)}m³ energia=${state.energyTotalKwh.toFixed(3)}kWh ` +
        `vazamento=${state.leakDetected} esgoto=${state.sewageLeakDetected} gás=${state.gasDetected} fumaça=${state.smokeDetected} temp=${state.temperatureC}°C`,
    );
  }, intervalMs);
});

client.on("error", (error) => console.error("[simulador] erro MQTT:", error.message));
