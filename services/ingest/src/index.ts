import "./env.js";
import mqtt from "mqtt";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { alertRules, alerts, db, devices, ingestEvents, telemetry } from "@predioon/db";
import { TelemetrySchema } from "@predioon/shared";

const client = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: process.env.MQTT_CLIENT_ID ?? `predioon-ingest-${process.pid}`,
});

client.on("connect", () => {
  console.log("MQTT connected");
  client.subscribe("predio/+/device/+/telemetry", { qos: 1 });
});

function ruleMatches(operator: string, current: number, threshold: number) {
  switch (operator) {
    case "LT": return current < threshold;
    case "LTE": return current <= threshold;
    case "GT": return current > threshold;
    case "GTE": return current >= threshold;
    case "EQ": return current === threshold;
    case "NEQ": return current !== threshold;
    default: return false;
  }
}

client.on("message", async (topic, payload) => {
  try {
    if (!topic.endsWith("/telemetry")) return;
    const raw: unknown = JSON.parse(payload.toString("utf8"));
    const data = TelemetrySchema.parse(raw);

    await db.transaction(async (tx) => {
      // MQTT QoS 1 is at-least-once. Claiming eventId first makes ingestion idempotent.
      const claimed = await tx
        .insert(ingestEvents)
        .values({ eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId })
        .onConflictDoNothing()
        .returning({ eventId: ingestEvents.eventId });

      if (!claimed[0]) return;

      await tx.insert(telemetry).values({
        eventId: data.eventId,
        buildingId: data.buildingId,
        deviceId: data.deviceId,
        metric: data.metric,
        value: data.value,
        numericValue: typeof data.value === "number" ? data.value : null,
        unit: data.unit ?? null,
        quality: data.quality,
        time: new Date(data.timestamp),
      });

      await tx
        .update(devices)
        .set({ status: "ONLINE", lastSeenAt: new Date(), updatedAt: new Date() })
        .where(and(eq(devices.id, data.deviceId), eq(devices.buildingId, data.buildingId)));

      if (typeof data.value !== "number") return;

      const rules = await tx
        .select()
        .from(alertRules)
        .where(and(
          eq(alertRules.buildingId, data.buildingId),
          eq(alertRules.metric, data.metric),
          eq(alertRules.enabled, true),
          or(isNull(alertRules.deviceId), eq(alertRules.deviceId, data.deviceId)),
        ));

      for (const rule of rules) {
        if (!ruleMatches(rule.operator, data.value, rule.threshold)) continue;

        const cooldownFrom = new Date(Date.now() - rule.cooldownSeconds * 1000);
        const recent = await tx
          .select({ id: alerts.id })
          .from(alerts)
          .where(and(eq(alerts.ruleId, rule.id), gt(alerts.triggeredAt, cooldownFrom)))
          .limit(1);

        if (recent[0]) continue;

        await tx.insert(alerts).values({
          buildingId: data.buildingId,
          deviceId: data.deviceId,
          ruleId: rule.id,
          severity: rule.severity,
          type: rule.alertType,
          message: rule.messageTemplate.replaceAll("{value}", String(data.value)),
          triggeredValue: data.value,
          triggeredAt: new Date(data.timestamp),
        });
      }
    });
  } catch (error) {
    console.error("MQTT message rejected", { topic, error });
  }
});
