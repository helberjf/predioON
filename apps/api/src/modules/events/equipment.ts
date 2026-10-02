import { and, eq, sql } from "drizzle-orm";
import { devices, gateways, readFeatures, type AppTransaction } from "@predioon/db/runtime";
import { deviceFeatures, gateFeature, parkingFeature, type RealtimeEvent } from "@predioon/shared";

type DeviceStatusEvent = Extract<RealtimeEvent, { kind: "device-status" }>;
type GatewayStatusEvent = Extract<RealtimeEvent, { kind: "gateway-status" }>;
type DeviceClassification = { device_type: string; gate_kind: string | null; parking_vehicle_type: string | null };

/** A notification supplies identifiers only; current RLS and persisted state decide delivery. */
export async function projectDeviceStatusEvent(tx: AppTransaction, event: DeviceStatusEvent): Promise<DeviceStatusEvent | null> {
  const [stored] = await tx.select({ buildingId: devices.buildingId, deviceId: devices.id, status: devices.status })
    .from(devices).where(and(eq(devices.id, event.deviceId), eq(devices.buildingId, event.buildingId))).limit(1);
  if (!stored || stored.buildingId !== event.buildingId || stored.deviceId !== event.deviceId) return null;
  const [classification] = await tx.execute<DeviceClassification>(sql`select * from app_equipment_device_classification(${stored.buildingId},${stored.deviceId})`);
  if (!classification) return null;
  const keys = classification.device_type === "PARKING_SENSOR" && classification.parking_vehicle_type
    ? [parkingFeature(classification.parking_vehicle_type)]
    : ["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(classification.device_type) && classification.gate_kind
      ? [gateFeature(classification.gate_kind)] : deviceFeatures(classification.device_type);
  const states = await readFeatures(tx, stored.buildingId);
  // Support windows may expire while the feature queries run. Recheck at a new
  // statement instant before returning cached state, including RLS-hidden defaults.
  const [authority] = await tx.execute<{ allowed: boolean }>(sql`select app_device_has_capability(${stored.buildingId},${stored.deviceId},'devices:read') as allowed`);
  if (!authority?.allowed || (keys.length && !keys.some(key => states[key].enabled))) return null;
  return { kind: "device-status", buildingId: stored.buildingId, deviceId: stored.deviceId, status: stored.status };
}

export async function projectGatewayStatusEvent(tx: AppTransaction, event: GatewayStatusEvent): Promise<GatewayStatusEvent | null> {
  const [stored] = await tx.select({ buildingId: gateways.buildingId, gatewayId: gateways.id, status: gateways.status })
    .from(gateways).where(and(eq(gateways.id, event.gatewayId), eq(gateways.buildingId, event.buildingId))).limit(1);
  if (!stored || stored.buildingId !== event.buildingId || stored.gatewayId !== event.gatewayId) return null;
  return { kind: "gateway-status", buildingId: stored.buildingId, gatewayId: stored.gatewayId, status: stored.status };
}
