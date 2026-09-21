import { and, eq } from "drizzle-orm";
import { db, devices, gateways, ingestEvents, telemetry } from "@predioon/db";
import type { Telemetry } from "@predioon/shared";
import { notifyAlert, type AlertNotification } from "../notify/index.js";
import { publishRealtime } from "../realtime.js";
import { evaluateRules } from "../rules/evaluate.js";
import { normalizeTelemetry } from "./normalize.js";

/** Persist an envelope atomically, then publish only accepted readings. */
export async function handleTelemetry(topic: string, raw: Buffer): Promise<void> {
  const readings = normalizeTelemetry(topic, raw);
  const identity = readings[0];
  if (!identity) return;

  const result = await db.transaction(async (tx) => {
    const accepted: Telemetry[] = [];
    const createdAlerts: AlertNotification[] = [];
    // Serialize a sensor's messages so concurrent deliveries share one cooldown check.
    const [device] = await tx.select().from(devices).where(and(
      eq(devices.id, identity.deviceId), eq(devices.buildingId, identity.buildingId), eq(devices.enabled, true),
    )).limit(1).for("update");
    if (!device) return { accepted, createdAlerts };
    if (device.gatewayId) {
      const [gateway] = await tx.select({ enabled: gateways.enabled }).from(gateways).where(and(
        eq(gateways.id, device.gatewayId), eq(gateways.buildingId, identity.buildingId),
      )).limit(1);
      if (!gateway?.enabled) return { accepted, createdAlerts };
    }

    for (const data of readings) {
      const [claimed] = await tx.insert(ingestEvents).values({
        eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId,
      }).onConflictDoNothing().returning({ eventId: ingestEvents.eventId });
      if (!claimed) continue;
      const time = new Date(data.timestamp);
      await tx.insert(telemetry).values({
        eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId,
        metric: data.metric, value: data.value,
        numericValue: typeof data.value === "number" ? data.value : typeof data.value === "boolean" ? Number(data.value) : null,
        unit: data.unit ?? null, quality: data.quality, time,
      });
      accepted.push(data);
      if (data.quality === "GOOD" && (typeof data.value === "number" || typeof data.value === "boolean")) {
        createdAlerts.push(...await evaluateRules(tx, {
          buildingId: data.buildingId, deviceId: data.deviceId, metric: data.metric, value: Number(data.value), time,
        }));
      }
    }

    if (accepted.length) {
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
