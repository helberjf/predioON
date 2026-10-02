import { sql } from "drizzle-orm";
import type { AppTransaction } from "@predioon/db/runtime";
import { deviceFeatures, gateFeature, metricFeature, parkingFeature, type FeatureKey } from "@predioon/shared";

/** Minimal owner projection; callers cannot infer device configuration access. */
export type TelemetryDevice = {
  building_id: string;
  device_id: string;
  device_name: string;
  device_type: string;
  gate_kind: string | null;
  parking_vehicle_type: string | null;
};
export type TelemetryReadCapability = "telemetry:read" | "telemetry:read-published";

export async function authorizedTelemetryDevices(tx: AppTransaction, buildingId: string | null, capability: TelemetryReadCapability = "telemetry:read"): Promise<TelemetryDevice[]> {
  const rows = await tx.execute(sql`select * from app_telemetry_authorized_devices(${buildingId},${capability})`);
  return rows as unknown as TelemetryDevice[];
}

/** Canonical metrics take precedence on devices that publish mixed metrics. */
export function telemetryFeatureKeys(device: TelemetryDevice, metric: string): FeatureKey[] {
  const feature = metricFeature(metric, device.parking_vehicle_type ?? undefined);
  if (feature) return [feature];
  if (device.device_type === "PARKING_SENSOR" && device.parking_vehicle_type) return [parkingFeature(device.parking_vehicle_type)];
  if (["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(device.device_type) && device.gate_kind) return [gateFeature(device.gate_kind)];
  return deviceFeatures(device.device_type);
}
