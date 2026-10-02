import { and, eq } from "drizzle-orm";
import { alertRules, devices, gates, parkingLots, readFeatures, type AppTransaction } from "@predioon/db/runtime";
import { deviceFeatures, gateFeature, kindFeature, metricFeature, parkingFeature, type FeatureKey, type FeatureStates } from "@predioon/shared";
import { HttpError } from "../http/errors.js";
import { assertGovernanceAccess } from "./governance.js";

export function featureDisabled(feature: FeatureKey): HttpError {
  return new HttpError(403, "Funcionalidade desativada", { code: "FEATURE_DISABLED", feature });
}

/** Read current membership before exposing either the state or data for a feature. */
export async function buildingFeatures(tx: AppTransaction, buildingId: string, manage = false): Promise<FeatureStates> {
  await assertGovernanceAccess(tx, buildingId, manage);
  return readFeatures(tx, buildingId);
}

export async function assertFeature(tx: AppTransaction, buildingId: string, feature: FeatureKey, manage = false): Promise<FeatureStates> {
  const states = await buildingFeatures(tx, buildingId, manage);
  if (!states[feature].enabled) throw featureDisabled(feature);
  return states;
}

/** Lists may combine several buildings or independently switchable capabilities. */
export async function filterFeatureRows<T extends { buildingId: string }>(tx: AppTransaction, rows: T[], keys: (row: T) => FeatureKey[] | Promise<FeatureKey[]>, options: { any?: boolean; manage?: boolean } = {}): Promise<T[]> {
  const cache = new Map<string, FeatureStates | null>(), result: T[] = [];
  for (const row of rows) {
    if (!cache.has(row.buildingId)) {
      try { cache.set(row.buildingId, await buildingFeatures(tx, row.buildingId, options.manage)); }
      catch (error) { if (error instanceof HttpError && error.status === 403) cache.set(row.buildingId, null); else throw error; }
    }
    const states = cache.get(row.buildingId);
    if (!states) continue;
    const required = await keys(row);
    if (!required.length || (options.any ? required.some(key => states[key].enabled) : required.every(key => states[key].enabled))) result.push(row);
  }
  return result;
}

export type SensorRecord = { buildingId: string; deviceId?: string | null; ruleId?: string | null; metric?: string; type?: string };

/** Rules carry canonical metrics; usage alerts carry their kind, including the AI dependency. */
export async function sensorFeatureKeys(tx: AppTransaction, row: SensorRecord): Promise<FeatureKey[]> {
  const usage = /^(ADAPTIVE|DAILY)_(WATER|ENERGY|PUMP)_/.exec(row.type ?? "");
  if (usage) return [...(usage[1] === "ADAPTIVE" ? ["AI_ANALYSIS" as const] : []), kindFeature(usage[2] as "WATER" | "ENERGY" | "PUMP")];
  if (row.type === "PUMP_CONTINUOUS_LIMIT") return ["PUMP"];
  let metric = row.metric;
  if (!metric && row.ruleId) {
    const [rule] = await tx.select({ metric: alertRules.metric }).from(alertRules).where(and(eq(alertRules.id, row.ruleId), eq(alertRules.buildingId, row.buildingId))).limit(1);
    metric = rule?.metric;
  }
  const feature = metric ? metricFeature(metric) : null;
  if (feature) return [feature];
  if (!row.deviceId) return [];
  const [device] = await tx.select({ type: devices.type }).from(devices).where(and(eq(devices.id, row.deviceId), eq(devices.buildingId, row.buildingId))).limit(1);
  if (!device) return [];
  if (device.type === "PARKING_SENSOR") {
    const [lot] = await tx.select({ vehicleType: parkingLots.vehicleType }).from(parkingLots).where(and(eq(parkingLots.sensorId, row.deviceId), eq(parkingLots.buildingId, row.buildingId))).limit(1);
    if (lot) return [parkingFeature(lot.vehicleType)];
  }
  if (["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(device.type)) {
    const [gate] = await tx.select({ kind: gates.kind }).from(gates).where(and(eq(gates.deviceId, row.deviceId), eq(gates.buildingId, row.buildingId))).limit(1);
    if (gate) return [gateFeature(gate.kind)];
  }
  return deviceFeatures(device.type);
}

export async function assertSensorFeatures(tx: AppTransaction, row: SensorRecord, manage = false): Promise<FeatureStates> {
  const states = await buildingFeatures(tx, row.buildingId, manage);
  for (const key of await sensorFeatureKeys(tx, row)) if (!states[key].enabled) throw featureDisabled(key);
  return states;
}

export function filterSensorRows<T extends SensorRecord>(tx: AppTransaction, rows: T[], manage = false): Promise<T[]> {
  return filterFeatureRows(tx, rows, row => sensorFeatureKeys(tx, row), { manage });
}

/** Re-enabling needs a new sample before an old observation can be called current. */
export function observationIsCurrent(states: FeatureStates, keys: FeatureKey[], observedAt: Date | string | null): boolean {
  return !!observedAt && keys.every(key => states[key].enabled && (!states[key].resumedAt || new Date(observedAt).getTime() > Date.parse(states[key].resumedAt!)));
}
