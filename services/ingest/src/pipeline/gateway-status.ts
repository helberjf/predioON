import { and, eq } from "drizzle-orm";
import { db, gateways } from "@predioon/db";
import { GatewayStatusSchema, parseGatewayStatusTopic } from "@predioon/shared";
import { publishRealtime } from "../realtime.js";

/**
 * Gateways publish ONLINE retained on connect and register the OFFLINE payload
 * as the MQTT last will, so an abrupt power loss is reported by the broker itself.
 */
export async function handleGatewayStatus(topic: string, raw: Buffer): Promise<void> {
  const topicParts = parseGatewayStatusTopic(topic);
  if (!topicParts) return;

  const parsed = GatewayStatusSchema.safeParse(JSON.parse(raw.toString("utf8")));
  if (!parsed.success) {
    console.warn("Status de gateway rejeitado pelo schema:", topic, parsed.error.issues);
    return;
  }

  const data = parsed.data;
  if (data.buildingId !== topicParts.buildingId || data.gatewayId !== topicParts.gatewayId) {
    console.warn("Status descartado: payload não confere com o tópico", { topic });
    return;
  }

  const updated = await db
    .update(gateways)
    .set({
      status: data.state,
      lastSeenAt: data.state === "ONLINE" ? new Date() : undefined,
      firmwareVersion: data.firmwareVersion ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(gateways.id, data.gatewayId), eq(gateways.buildingId, data.buildingId), eq(gateways.enabled, true)))
    .returning({ id: gateways.id });

  if (!updated.length) {
    console.warn("Status de gateway desconhecido ignorado:", data.gatewayId);
    return;
  }

  await publishRealtime({
    kind: "gateway-status",
    buildingId: data.buildingId,
    gatewayId: data.gatewayId,
    status: data.state,
  });
}
