import { readFeatures, type AppTransaction } from "@predioon/db/runtime";
import type { RealtimeEvent } from "@predioon/shared";
import { observationIsCurrent } from "../../auth/features.js";
import { authorizedTelemetryDevices, telemetryFeatureKeys } from "../telemetry/authorization.js";

export type TelemetryEvent = Extract<RealtimeEvent, { kind: "telemetry" }>;

/** Resolve live capabilities on the exact device before reading feature state. */
export async function projectTelemetryEvent(tx: AppTransaction, event: TelemetryEvent): Promise<TelemetryEvent | null> {
  const matches = (device: Awaited<ReturnType<typeof authorizedTelemetryDevices>>[number]) =>
    device.building_id === event.buildingId && device.device_id === event.deviceId;
  const raw = (await authorizedTelemetryDevices(tx, event.buildingId)).find(matches);
  if (raw) {
    const features = await readFeatures(tx, event.buildingId);
    return observationIsCurrent(features, telemetryFeatureKeys(raw, event.metric), event.time) ? event : null;
  }

  if (event.metric !== "water_level_percent") return null;
  const published = (await authorizedTelemetryDevices(tx, event.buildingId, "telemetry:read-published")).find(matches);
  if (!published) return null;
  if (typeof event.value !== "number" || !Number.isFinite(event.value) || event.value < 0 || event.value > 100) return null;
  const timestamp = Date.parse(event.time);
  if (!Number.isFinite(timestamp)) return null;
  const features = await readFeatures(tx, event.buildingId);
  if (!observationIsCurrent(features, ["WATER_TANK"], event.time)) return null;
  return {
    kind: "telemetry",
    buildingId: event.buildingId,
    deviceId: event.deviceId,
    metric: "water_level_percent",
    value: event.value,
    unit: "%",
    quality: event.quality ?? "UNCERTAIN",
    time: new Date(timestamp).toISOString(),
  };
}
