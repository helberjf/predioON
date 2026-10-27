// What a demonstration gateway publishes in one cycle, from its inventory and the
// simulated field state. Pure: no MQTT, no database, so it is unit tested.
import { randomUUID } from "node:crypto";
import { telemetryTopic, waterTelemetryTopic } from "@predioon/shared";
import type { FieldState } from "./state.js";

export type DemoDevice = { id: string; type: string };
export type DemoParkingLot = { sensorId: string; capacity: number };
export type DemoMessage = { topic: string; payload: string };
// Meters feed consumption (gaps of at most 5 minutes) and gate controllers must have
// been seen within 60 s to open: those go every cycle. Everything else goes on a slower
// cadence, or at once when its value changes, like a gateway with report-on-change.
const EVERY_CYCLE = new Set(["WATER_METER", "ENERGY_METER", "PUMP_MONITOR", "GATE_CONTROLLER", "GARAGE_GATE", "PEDESTRIAN_GATE"]);
export const DEMO_FULL_EVERY = 3;

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * `sent` remembers the last value per device and metric across cycles; `full` marks
 * the slow cadence. A slow reading is sent when it is due or when it changed.
 */
export function demoCycleMessages(buildingId: string, devices: readonly DemoDevice[], state: FieldState,
  parking: ReadonlyMap<string, number>, at = new Date(), full = true, sent = new Map<string, string>()): DemoMessage[] {
  const timestamp = at.toISOString();
  const messages: DemoMessage[] = [];
  let fast = false;
  const due = (key: string, value: unknown) => {
    const encoded = JSON.stringify(value), changed = sent.get(key) !== encoded;
    if (!fast && !full && !changed) return false;
    sent.set(key, encoded);
    return true;
  };
  const reading = (deviceId: string, metric: string, value: number | boolean, unit?: string) => {
    if (!due(`${deviceId}:${metric}`, value)) return;
    messages.push({
      topic: telemetryTopic(buildingId, deviceId),
      payload: JSON.stringify({ schemaVersion: 1, eventId: randomUUID(), buildingId, deviceId, metric, value,
        ...(unit ? { unit } : {}), quality: "GOOD", timestamp }),
    });
  };
  for (const device of devices) {
    fast = EVERY_CYCLE.has(device.type);
    switch (device.type) {
      case "WATER_LEVEL_SENSOR":
        if (!due(`${device.id}:level`, Math.round(state.waterLevelPercent))) break;
        messages.push({ topic: waterTelemetryTopic(buildingId, device.id), payload: JSON.stringify({
          device_id: device.id, type: "nivel_caixa_agua", nivel_percentual: state.waterLevelPercent,
          volume_litros: state.waterVolumeLiters,
          // Synthetic 2 m tank, only for the demonstration; never a hardware register mapping.
          distancia_mm: Math.round((1 - state.waterLevelPercent / 100) * 2000), timestamp }) });
        break;
      case "WATER_METER": reading(device.id, "water_total_m3", round(state.waterTotalM3), "m³"); break;
      case "ENERGY_METER": reading(device.id, "energy_total_kwh", round(state.energyTotalKwh), "kWh"); break;
      case "PUMP_MONITOR": reading(device.id, "pump_running", state.pumpRunning); break;
      case "PHASE_MONITOR":
        for (const [metric, value, unit] of [["voltage_l1", state.voltageL1, "V"], ["voltage_l2", state.voltageL2, "V"],
          ["voltage_l3", state.voltageL3, "V"], ["current_l1", state.currentL1, "A"], ["current_l2", state.currentL2, "A"],
          ["current_l3", state.currentL3, "A"], ["frequency_hz", state.frequencyHz, "Hz"]] as const) reading(device.id, metric, value, unit);
        break;
      case "LEAK_SENSOR": reading(device.id, "water_leak_detected", state.leakDetected); break;
      case "SEWAGE_LEAK_SENSOR": reading(device.id, "sewage_leak_detected", state.sewageLeakDetected); break;
      case "GAS_SENSOR": reading(device.id, "gas_detected", state.gasDetected); reading(device.id, "gas_ppm", state.gasPpm, "ppm"); break;
      case "TEMPERATURE_SENSOR": reading(device.id, "temperature_c", state.temperatureC, "°C"); break;
      case "SMOKE_PANEL_RELAY": reading(device.id, "smoke_detected", state.smokeDetected); break;
      // Controllers report their own presence; the gate must have been seen within 60 s to open.
      case "GATE_CONTROLLER": case "GARAGE_GATE": case "PEDESTRIAN_GATE": reading(device.id, "gate_open", false); break;
      case "PARKING_SENSOR": {
        const occupied = parking.get(device.id);
        if (occupied !== undefined) reading(device.id, "parking_occupied", occupied);
        break;
      }
    }
  }
  return messages;
}

/** Cars come and go: a small random walk that stays inside the lot and favours the busy hours. */
export function nextParking(lots: readonly DemoParkingLot[], current: ReadonlyMap<string, number>, at = new Date(),
  random = Math.random): Map<string, number> {
  const hour = Number(at.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }));
  // Residents are home at night and leave in the morning.
  const target = hour >= 20 || hour < 7 ? 0.78 : hour >= 9 && hour < 17 ? 0.4 : 0.6;
  const next = new Map<string, number>();
  for (const lot of lots) {
    // A presentation must never show a full or an empty lot: keep a margin at both ends.
    const floor = Math.min(lot.capacity, Math.ceil(lot.capacity * 0.1)), ceiling = Math.max(floor, Math.floor(lot.capacity * 0.9));
    const previous = current.get(lot.sensorId) ?? Math.round(lot.capacity * target);
    const drift = previous < lot.capacity * target ? 0.65 : 0.35;
    const step = random() < 0.4 ? 0 : random() < drift ? 1 : -1;
    next.set(lot.sensorId, Math.max(floor, Math.min(ceiling, previous + step)));
  }
  return next;
}

export type LastReading = { deviceId: string; metric: string; value: number };
/** Metrics whose last stored value lets a restarted field continue instead of starting over. */
export const RESUME_METRICS = ["water_total_m3", "energy_total_kwh", "water_level_percent", "parking_occupied"] as const;

/**
 * A restart must not look like a meter reset: the totals, the tank and the parking
 * counters continue from what the database already holds.
 */
export function resumeField(base: FieldState, readings: readonly LastReading[]): { state: FieldState; parking: Map<string, number> } {
  const state: FieldState = { ...base }, parking = new Map<string, number>();
  for (const { deviceId, metric, value } of readings) {
    if (!Number.isFinite(value)) continue;
    if (metric === "water_total_m3" && value >= 0) state.waterTotalM3 = value;
    else if (metric === "energy_total_kwh" && value >= 0) state.energyTotalKwh = value;
    else if (metric === "water_level_percent" && value >= 0 && value <= 100) {
      state.waterLevelPercent = value;
      state.waterVolumeLiters = Math.round(value * 100);
    } else if (metric === "parking_occupied" && value >= 0) parking.set(deviceId, Math.round(value));
  }
  return { state, parking };
}
