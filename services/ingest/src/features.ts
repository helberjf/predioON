import { and, eq } from "drizzle-orm";
import { alertRules, alerts, devices, gates, parkingLots, readFeatures, type DbTransaction } from "@predioon/db";
import { deviceFeatures, gateFeature, kindFeature, metricFeature, parkingFeature, type FeatureKey, type FeatureState } from "@predioon/shared";

type Features = Record<FeatureKey, FeatureState>;

/** A resumed module cannot consume queued samples from its previous active period. */
export function permitsFeature(features: Features, feature: FeatureKey, at?: Date): boolean {
  const state = features[feature];
  return state.enabled && (!at || !state.resumedAt || at.getTime() > Date.parse(state.resumedAt));
}

export async function readingFeatures(tx: DbTransaction, buildingId: string, device: { id: string; type: string }, metric: string): Promise<FeatureKey[]> {
  if (metric === "parking_occupied") {
    const [lot] = await tx.select().from(parkingLots).where(and(eq(parkingLots.buildingId, buildingId), eq(parkingLots.sensorId, device.id))).limit(1);
    // Unbound parking telemetry must not bypass the separate car/motorcycle controls.
    return lot ? [parkingFeature(lot.vehicleType)] : ["CAR_PARKING", "MOTORCYCLE_PARKING"];
  }
  const feature = metricFeature(metric);
  return feature ? [feature] : deviceFeatures(device.type);
}

export async function permitsReading(tx: DbTransaction, features: Features, buildingId: string, device: { id: string; type: string }, metric: string, at: Date): Promise<boolean> {
  const required = await readingFeatures(tx, buildingId, device, metric);
  return required.every(feature => permitsFeature(features, feature, at));
}

/** Communication status remains core; a module-owned device only pages while active. */
export async function permitsDeviceAlert(tx: DbTransaction, features: Features, buildingId: string, device: { id: string; type: string }, at?: Date): Promise<boolean> {
  let required = deviceFeatures(device.type);
  if (device.type === "PARKING_SENSOR") {
    required = await readingFeatures(tx, buildingId, device, "parking_occupied");
  } else if (device.type === "GATE_CONTROLLER") {
    const bound = await tx.select().from(gates).where(and(eq(gates.buildingId, buildingId), eq(gates.deviceId, device.id)));
    required = bound.length ? bound.map(gate => gateFeature(gate.kind)) : ["GARAGE_ACCESS", "PEDESTRIAN_ACCESS"];
  }
  return !required.length || required.some(feature => permitsFeature(features, feature, at));
}

/** Re-read persisted alert ownership instead of trusting a stale delivery envelope. */
export async function permitsAlert(tx: DbTransaction, buildingId: string, alertId: string): Promise<boolean> {
  const [alert] = await tx.select().from(alerts).where(and(eq(alerts.id, alertId), eq(alerts.buildingId, buildingId))).limit(1);
  if (!alert) return false;
  const features = await readFeatures(tx, buildingId);
  if (!alert.deviceId) return !!alert.gatewayId;
  const [device] = await tx.select().from(devices).where(and(eq(devices.id, alert.deviceId), eq(devices.buildingId, buildingId))).limit(1);
  if (!device) return false;
  if (alert.type.startsWith("ADAPTIVE_") && !permitsFeature(features, "AI_ANALYSIS", alert.triggeredAt)) return false;
  const usageKind = /^(?:DAILY_|ADAPTIVE_)(ENERGY|WATER|PUMP)_/.exec(alert.type)?.[1];
  if (usageKind) return permitsFeature(features, kindFeature(usageKind as "ENERGY" | "WATER" | "PUMP"), alert.triggeredAt);
  if (alert.type === "PUMP_CONTINUOUS_LIMIT") return permitsFeature(features, "PUMP", alert.triggeredAt);
  if (alert.ruleId) {
    const [rule] = await tx.select().from(alertRules).where(eq(alertRules.id, alert.ruleId)).limit(1);
    if (rule) return permitsReading(tx, features, buildingId, device, rule.metric, alert.triggeredAt);
  }
  return permitsDeviceAlert(tx, features, buildingId, device, alert.triggeredAt);
}
