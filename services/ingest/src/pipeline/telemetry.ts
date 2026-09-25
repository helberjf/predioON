import { and, eq } from "drizzle-orm";
import { db, buildings, devices, gateways, ingestEvents, telemetry, lockFeatures, readFeatures } from "@predioon/db";
import type { Telemetry } from "@predioon/shared";
import { notifyAlert, type AlertNotification } from "../notify/index.js";
import { publishRealtime } from "../realtime.js";
import { evaluateRules } from "../rules/evaluate.js";
import { normalizeTelemetry } from "./normalize.js";
import { accountUsage } from "../analytics/usage.js";
import { applyParkingTelemetry } from "../parking/index.js";
import { permitsReading } from "../features.js";

/** Persist an envelope atomically, then publish only accepted readings. */
export async function handleTelemetry(topic: string, raw: Buffer): Promise<void> {
  const readings = normalizeTelemetry(topic, raw);
  if (readings.some(reading => Date.parse(reading.timestamp) > Date.now() + 60_000)) return;
  const identity = readings[0];
  if (!identity) return;

  const result = await db.transaction(async (tx) => {
    await lockFeatures(tx);
    const accepted: Telemetry[] = [];
    const createdAlerts: AlertNotification[] = [];
    // Serialize a sensor's messages so concurrent deliveries share one cooldown check.
    const [device] = await tx.select().from(devices).where(and(
      eq(devices.id, identity.deviceId), eq(devices.buildingId, identity.buildingId), eq(devices.enabled, true),
    )).limit(1).for("update");
    if (!device) return { accepted, createdAlerts };
    const [building] = await tx.select({ active: buildings.active }).from(buildings).where(eq(buildings.id, identity.buildingId)).limit(1);
    if (!building?.active) return { accepted, createdAlerts };
    if (device.gatewayId) {
      const [gateway] = await tx.select({ enabled: gateways.enabled }).from(gateways).where(and(
        eq(gateways.id, device.gatewayId), eq(gateways.buildingId, identity.buildingId),
      )).limit(1);
      if (!gateway?.enabled) return { accepted, createdAlerts };
    }

    const features = await readFeatures(tx, identity.buildingId);
    for (const data of readings) {
      const time = new Date(data.timestamp);
      if (!await permitsReading(tx, features, data.buildingId, device, data.metric, time)) continue;
      const [claimed] = await tx.insert(ingestEvents).values({
        eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId,
      }).onConflictDoNothing().returning({ eventId: ingestEvents.eventId });
      if (!claimed) continue;
      await tx.insert(telemetry).values({
        eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId,
        metric: data.metric, value: data.value,
        numericValue: typeof data.value === "number" ? data.value : typeof data.value === "boolean" ? Number(data.value) : null,
        unit: data.unit ?? null, quality: data.quality, time,
      });
      accepted.push(data);
      createdAlerts.push(...await accountUsage(tx, data, features));
      await applyParkingTelemetry(tx, data);
      if (data.quality === "GOOD" && (typeof data.value === "number" || typeof data.value === "boolean")) {
        createdAlerts.push(...await evaluateRules(tx, {
          buildingId: data.buildingId, deviceId: data.deviceId, metric: data.metric, value: Number(data.value), time,
        }));
      }
    }

    // A valid packet proves transport liveness even when every module is paused.
    {
      const now = new Date();
      await tx.update(devices).set({ status: "ONLINE", lastSeenAt: now, updatedAt: now }).where(eq(devices.id, device.id));
      if (device.gatewayId) await tx.update(gateways).set({ status: "ONLINE", lastSeenAt: now, updatedAt: now }).where(eq(gateways.id, device.gatewayId));
    }
    return { accepted, createdAlerts };
  });

  for (const data of result.accepted) {
    await publishRealtime({ kind: "telemetry", buildingId: data.buildingId, deviceId: data.deviceId,
      metric: data.metric, value: data.value, unit: data.unit ?? null, quality: data.quality, time: new Date(data.timestamp).toISOString() });
  }
  for (const alert of result.createdAlerts) {
    await publishRealtime({ kind: "alert", buildingId: alert.buildingId, alertId: alert.alertId,
      deviceId: alert.deviceId, severity: alert.severity, type: alert.type, message: alert.message, status: "OPEN" });
    await notifyAlert(alert);
  }
}
