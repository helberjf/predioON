import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import { deviceFeatures, gateFeature, kindFeature, metricFeature, parkingFeature, type FeatureKey } from "@predioon/shared";

export type AlertCapability = "alerts:read" | "alerts:acknowledge" | "alerts:resolve";
/** Classification only: no device configuration or rule thresholds/templates. */
export type AlertContext = {
  building_id: string;
  alert_id: string;
  device_id: string | null;
  gateway_id: string | null;
  rule_id: string | null;
  rule_metric: string | null;
  device_type: string | null;
  gate_kind: string | null;
  parking_vehicle_type: string | null;
};

export async function authorizedAlertContexts(tx: AppTransaction, buildingId: string | null, alertId: string | null = null): Promise<AlertContext[]> {
  const rows = await tx.execute(sql`select * from app_alert_authorized_contexts(${buildingId},${alertId}::uuid)`);
  return rows as unknown as AlertContext[];
}

/** Usage kind precedes canonical rule metric, which precedes device type. */
export function alertFeatureKeys(context: AlertContext, type: string): FeatureKey[] {
  const usage = /^(ADAPTIVE|DAILY)_(WATER|ENERGY|PUMP)_/.exec(type);
  if (usage) return [...(usage[1] === "ADAPTIVE" ? ["AI_ANALYSIS" as const] : []), kindFeature(usage[2] as "WATER" | "ENERGY" | "PUMP")];
  if (type === "PUMP_CONTINUOUS_LIMIT") return ["PUMP"];
  const canonical = context.rule_metric ? metricFeature(context.rule_metric) : null;
  if (canonical) return [canonical];
  if (!context.device_id || !context.device_type) return [];
  if (context.device_type === "PARKING_SENSOR" && context.parking_vehicle_type) return [parkingFeature(context.parking_vehicle_type)];
  if (["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(context.device_type) && context.gate_kind) return [gateFeature(context.gate_kind)];
  return deviceFeatures(context.device_type);
}
