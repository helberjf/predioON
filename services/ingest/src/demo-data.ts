// Fictitious readings for a demonstration, without broker or hardware.
//
//   pnpm --filter @predioon/ingest demo:data            last 7 days, then stops
//   pnpm --filter @predioon/ingest demo:data --follow   keeps sending every 10 s
//
// Every value goes through the real ingestion pipeline (validation, deduplication,
// consumption, alerts), so the panels show exactly what real sensors would produce.
// It writes telemetry and raises the demo consumption limits to the size of the
// simulated building: use it only on a demonstration database, never on a
// condominium with real equipment.
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sqlClient } from "@predioon/db";
import { closeIngestDb } from "@predioon/db/ingest";
import { telemetryTopic, waterTelemetryTopic } from "@predioon/shared";
import { handleTelemetry } from "./pipeline/telemetry.js";
import { initialState, nextState, type FieldState } from "./simulator/state.js";

const buildingId = process.env.SIM_BUILDING_ID ?? "bld_001";
const days = Number(process.env.DEMO_DAYS ?? 7);
const follow = process.argv.includes("--follow");
if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("DEMO_DAYS deve ser um inteiro entre 1 e 30");
// Consumption is only estimated between readings at most five minutes apart.
const STEP_SECONDS = 300, SPARSE_EVERY = 6;

const send = (deviceId: string, metric: string, value: number | boolean, at: Date, unit?: string) =>
  handleTelemetry(telemetryTopic(buildingId, deviceId), Buffer.from(JSON.stringify({ schemaVersion: 1, eventId: randomUUID(), buildingId, deviceId,
    metric, value, ...(unit ? { unit } : {}), quality: "GOOD", timestamp: at.toISOString() })));

/** Meters every step; slow-changing sensors only when `everything` is set. */
async function publish(state: FieldState, at: Date, everything: boolean): Promise<void> {
  await send("energy_01", "energy_total_kwh", Math.round(state.energyTotalKwh * 1e6) / 1e6, at, "kWh");
  await send("water_meter_01", "water_total_m3", Math.round(state.waterTotalM3 * 1e6) / 1e6, at, "m³");
  await send("pump_01", "pump_running", state.pumpRunning, at);
  if (!everything) return;
  await handleTelemetry(waterTelemetryTopic(buildingId, "water_01"), Buffer.from(JSON.stringify({ device_id: "water_01", type: "nivel_caixa_agua",
    nivel_percentual: state.waterLevelPercent, volume_litros: state.waterVolumeLiters,
    distancia_mm: Math.round((1 - state.waterLevelPercent / 100) * 2000), timestamp: at.toISOString() })));
  for (const [metric, value, unit] of [["voltage_l1", state.voltageL1, "V"], ["voltage_l2", state.voltageL2, "V"], ["voltage_l3", state.voltageL3, "V"],
    ["current_l1", state.currentL1, "A"], ["current_l2", state.currentL2, "A"], ["current_l3", state.currentL3, "A"], ["frequency_hz", state.frequencyHz, "Hz"]] as const) {
    await send("phase_01", metric, value, at, unit);
  }
  await send("leak_01", "water_leak_detected", state.leakDetected, at);
  await send("sewage_01", "sewage_leak_detected", state.sewageLeakDetected, at);
  await send("gas_01", "gas_detected", state.gasDetected, at);
  await send("gas_01", "gas_ppm", state.gasPpm, at, "ppm");
  await send("smoke_01", "smoke_detected", state.smokeDetected, at);
  await send("temp_01", "temperature_c", state.temperatureC, at, "°C");
}

try {
  const [building] = await sqlClient`select name from buildings where id=${buildingId}`;
  if (!building) throw new Error(`Condomínio ${buildingId} não encontrado. Rode o seed de demonstração antes.`);
  // A second history over the same period would make the meters run backwards.
  const [existing] = await sqlClient`select 1 from telemetry where building_id=${buildingId} and time > now() - make_interval(days => ${days}) limit 1`;
  if (existing && !follow) throw new Error("Este condomínio já tem leituras no período. O histórico fictício é gerado uma única vez; use --follow para continuar enviando leituras atuais.");
  // The seed limits are illustrative and far below what the simulated building uses in a day;
  // left as they are, the demonstration would open with a wall of consumption alerts.
  if (!existing) {
    await sqlClient`update monitoring_profiles set daily_limit=300, daily_cost_limit=300 where building_id=${buildingId} and kind='ENERGY'`;
    await sqlClient`update monitoring_profiles set daily_limit=60 where building_id=${buildingId} and kind='WATER'`;
    await sqlClient`update monitoring_profiles set daily_limit=480, continuous_limit_minutes=180 where building_id=${buildingId} and kind='PUMP'`;
  }
  const steps = existing ? 0 : days * 86_400 / STEP_SECONDS, start = Date.now() - steps * STEP_SECONDS * 1000;
  console.log(existing ? `[demonstração] ${building.name}: histórico já existe; enviando só leituras atuais.` : `[demonstração] ${building.name}: ${days} dia(s) de leituras fictícias, ${steps} passos de ${STEP_SECONDS / 60} min.`);
  let state = initialState();
  for (let tick = 1; tick <= steps; tick++) {
    state = nextState(state, tick, "normal", STEP_SECONDS);
    await publish(state, new Date(start + tick * STEP_SECONDS * 1000), tick % SPARSE_EVERY === 0 || tick === steps);
    if (tick % 288 === 0) console.log(`[demonstração] ${tick / 288} de ${days} dia(s)`);
  }
  if (steps) console.log("[demonstração] histórico concluído; os painéis mostram leituras atuais por alguns minutos.");
  for (let tick = steps + 1; follow; tick++) {
    await delay(10_000);
    state = nextState(state, tick, "normal", 10);
    await publish(state, new Date(), true);
  }
} finally {
  // Readings go through the restricted ingest pool (052): both must close for the process to exit.
  await Promise.all([sqlClient.end(), closeIngestDb()]);
}
