import { eq } from "drizzle-orm";
import { z } from "zod";
import { alerts, readFeatures, type AppTransaction } from "@predioon/db/runtime";
import type { RealtimeEvent } from "@predioon/shared";
import { observationIsCurrent } from "../../auth/features.js";
import { alertFeatureKeys, authorizedAlertContexts } from "../alerts/authorization.js";

export type AlertEvent = Extract<RealtimeEvent, { kind: "alert" }>;

/** The notification identifies an alert; persisted data and live grants determine delivery. */
export async function projectAlertEvent(tx: AppTransaction, event: AlertEvent): Promise<AlertEvent | null> {
  if (!z.uuid().safeParse(event.alertId).success) return null;
  const context = (await authorizedAlertContexts(tx, event.buildingId, event.alertId))
    .find(row => row.building_id === event.buildingId && row.alert_id === event.alertId);
  if (!context) return null;
  const [stored] = await tx.select({
    buildingId: alerts.buildingId,
    alertId: alerts.id,
    deviceId: alerts.deviceId,
    gatewayId: alerts.gatewayId,
    severity: alerts.severity,
    type: alerts.type,
    message: alerts.message,
    status: alerts.status,
    triggeredAt: alerts.triggeredAt,
  }).from(alerts).where(eq(alerts.id, event.alertId)).limit(1);
  if (!stored || stored.buildingId !== event.buildingId || stored.alertId !== event.alertId) return null;
  const states = await readFeatures(tx, stored.buildingId);
  if (!observationIsCurrent(states, alertFeatureKeys(context, stored.type), stored.triggeredAt)) return null;
  return {
    kind: "alert",
    buildingId: stored.buildingId,
    alertId: stored.alertId,
    deviceId: stored.deviceId,
    gatewayId: stored.gatewayId,
    severity: stored.severity,
    type: stored.type,
    message: stored.message,
    status: stored.status,
  };
}
