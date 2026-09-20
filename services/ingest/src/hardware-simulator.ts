import "./env.js";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";

const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `predioon-hardware-simulator-${process.pid}`,
});

let cycle = 0;

function publish(topic: string, payload: unknown) {
  client.publish(topic, JSON.stringify(payload), { qos: 1 });
}

function telemetry(deviceId: string, metric: string, value: number | boolean | string, unit?: string) {
  publish(`predio/bld_001/device/${deviceId}/telemetry`, {
    schemaVersion: 1,
    eventId: randomUUID(),
    buildingId: "bld_001",
    deviceId,
    metric,
    value,
    ...(unit ? { unit } : {}),
    quality: "GOOD",
    timestamp: new Date().toISOString(),
  });
}

function sendCycle() {
  cycle += 1;
  const water = cycle % 6 === 1 ? 18 : Math.max(25, 82 - (cycle % 10) * 3);
  const voltage = cycle % 9 === 0 ? 176 : 220 + Math.round(Math.sin(cycle) * 4);
  const temperature = 28 + Math.round(Math.sin(cycle / 2) * 3);
  telemetry("water_01", "water_level_percent", water, "%");
  telemetry("water_01", "volume_liters", water * 50, "L");
  telemetry("phase_01", "voltage_l1", voltage, "V");
  telemetry("leak_01", "leak_detected", false);
  telemetry("temp_01", "temperature_c", temperature, "°C");
  console.log(`[simulador] telemetria enviada: água=${water}% tensão=${voltage}V temp=${temperature}°C`);
}

client.on("connect", () => {
  console.log(`[simulador] conectado em ${url}`);
  sendCycle();
  setInterval(sendCycle, 5000);
});
