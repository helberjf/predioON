import { and, eq } from "drizzle-orm";
import { db, devices, gateways, ingestEvents, telemetry } from "@predioon/db";
import { TelemetrySchema, parseTelemetryTopic } from "@predioon/shared";
import { notifyAlert } from "../notify/index.js";
import { publishRealtime } from "../realtime.js";
import { evaluateRules } from "../rules/evaluate.js";

/**
 * The TOPIC is the source of truth for identity, not the payload: the broker ACL restricts
 * which topics a gateway may publish to, while the JSON body is just data the device sent.
 * A mismatch means a misconfigured or hostile device, so the message is dropped.
 */
export async function handleTelemetry(topic: string, raw: Buffer): Promise<void> {
  const topicParts = parseTelemetryTopic(topic);
  if (!topicParts) return;

  const parsed = TelemetrySchema.safeParse(JSON.parse(raw.toString("utf8")));
  if (!parsed.success) {
    console.warn("Telemetria rejeitada pelo schema:", topic, parsed.error.issues);
    return;
  }

  const data = parsed.data;
  if (data.buildingId !== topicParts.buildingId || data.deviceId !== topicParts.deviceId) {
    console.warn("Telemetria descartada: payload não confere com o tópico", { topic, payload: data });
    return;
  }

  const time = new Date(data.timestamp);

  const alerts = await db.transaction(async (tx) => {
    // The device must already be registered in THIS building. Without this check a gateway
    // could publish under another building's topic and have the reading accepted.
    const [device] = await tx
      .select({ id: devices.id, gatewayId: devices.gatewayId })
      .from(devices)
      .where(and(eq(devices.id, data.deviceId), eq(devices.buildingId, data.buildingId)))
      .limit(1);

    if (!device) {
      console.warn("Telemetria descartada: dispositivo não pertence ao prédio", {
        deviceId: data.deviceId,
        buildingId: data.buildingId,
      });
      return [];
    }

    // MQTT QoS 1 is at-least-once. Claiming eventId first makes ingestion idempotent.
    const [claimed] = await tx
      .insert(ingestEvents)
      .values({ eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId })
      .onConflictDoNothing()
      .returning({ eventId: ingestEvents.eventId });
    if (!claimed) return [];

    await tx.insert(telemetry).values({
      eventId: data.eventId,
      buildingId: data.buildingId,
      deviceId: data.deviceId,
      metric: data.metric,
      value: data.value,
      numericValue: typeof data.value === "number" ? data.value : null,
      unit: data.unit ?? null,
      quality: data.quality,
      time,
    });

    const now = new Date();
    await tx
      .update(devices)
      .set({ status: "ONLINE", lastSeenAt: now, updatedAt: now })
      .where(and(eq(devices.id, data.deviceId), eq(devices.buildingId, data.buildingId)));

    // Telemetry arriving through a gateway is proof that it is alive. Without this the
    // offline sweeper would mark a perfectly healthy gateway as OFFLINE, because only the
    // status topic touches last_seen_at and that one is published rarely.
    if (device.gatewayId) {
      await tx
        .update(gateways)
        .set({ status: "ONLINE", lastSeenAt: now, updatedAt: now })
        .where(and(eq(gateways.id, device.gatewayId), eq(gateways.buildingId, data.buildingId)));
    }

    if (typeof data.value !== "number") return [];
    return evaluateRules(tx, {
      buildingId: data.buildingId,
      deviceId: data.deviceId,
      metric: data.metric,
      value: data.value,
      time,
    });
  });

  await publishRealtime({
    kind: "telemetry",
    buildingId: data.buildingId,
    deviceId: data.deviceId,
    metric: data.metric,
    value: data.value,
    unit: data.unit ?? null,
    time: time.toISOString(),
  });

  for (const alert of alerts) {
    await publishRealtime({
      kind: "alert",
      buildingId: alert.buildingId,
      alertId: alert.alertId,
      deviceId: alert.deviceId,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      status: "OPEN",
    });
    await notifyAlert(alert);
  }
}
