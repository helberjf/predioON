import { and, eq, lt, ne, sql } from "drizzle-orm";
import { alerts, db, devices, gateways, lockFeatures, readFeatures, type DbTransaction } from "@predioon/db";
import type { RealtimeEvent } from "@predioon/shared";
import { permitsDeviceAlert } from "./features.js";
import { config } from "./config.js";
import { assertPersisted, persistAlert, PersistenceChecks, type AlertNotification } from "./notify/index.js";
import { publishRealtime } from "./realtime.js";

type CommunicationAlert = { buildingId: string; message: string; deviceId?: string; gatewayId?: string };
type CommunicationResult = { status?: RealtimeEvent; alert?: AlertNotification; deviceId: string | null; gatewayId: string | null };

/** Source lock first, then fresh DB cutoff; state + alert + outbox commit together. */
async function persistCommunication(tx: DbTransaction, input: CommunicationAlert, markOffline: boolean): Promise<CommunicationResult | null> {
  await lockFeatures(tx);
  if (!!input.deviceId === !!input.gatewayId) throw new Error("Exactly one communication source is required");
  const isDevice = !!input.deviceId;
  const table = isDevice ? devices : gateways;
  const [source] = await tx.select().from(table).where(and(eq(table.id, input.deviceId ?? input.gatewayId!), eq(table.buildingId, input.buildingId))).limit(1).for("update");
  if (!source?.enabled || (markOffline && source.status === "DISABLED")) return null;
  // Raw Drizzle execute keeps PostgreSQL timestamps as strings; mapped selects
  // yield Dates. Parse the fresh DB clock explicitly before cutoff comparison.
  const [{ evaluatedAt: databaseClock }] = await tx.execute<{ evaluatedAt: string }>(sql`select clock_timestamp() as "evaluatedAt"`);
  const evaluatedAt = new Date(databaseClock);
  const seconds = isDevice ? config.DEVICE_OFFLINE_TIMEOUT_SECONDS : config.GATEWAY_OFFLINE_TIMEOUT_SECONDS;
  if ((source.lastSeenAt && source.lastSeenAt.getTime() >= evaluatedAt.getTime() - seconds * 1000) || (markOffline && !source.lastSeenAt)) return null;
  // Gateway sweep does not replay historic OFFLINE incidents. Device sweeps keep
  // the existing unresolved-alert dedup check even when it is already OFFLINE.
  if (markOffline && !isDevice && source.status === "OFFLINE") return null;
  const result: CommunicationResult = { deviceId: isDevice ? source.id : null, gatewayId: isDevice ? null : source.id };
  const checks = new PersistenceChecks();
  let expected = source;
  if (markOffline && source.status !== "OFFLINE") {
    expected = { ...source, status: "OFFLINE", updatedAt: evaluatedAt };
    const updated = await tx.update(table).set({ status: "OFFLINE", updatedAt: evaluatedAt }).where(eq(table.id, source.id)).returning();
    assertPersisted(updated.length === 1 ? updated[0] : undefined, expected, "Communication status");
    const [persisted] = await tx.select().from(table).where(eq(table.id, source.id)).limit(1);
    assertPersisted(persisted, expected, "Communication status");
    result.status = isDevice ? { kind: "device-status", buildingId: source.buildingId, deviceId: source.id, status: "OFFLINE" }
      : { kind: "gateway-status", buildingId: source.buildingId, gatewayId: source.id, status: "OFFLINE" };
  }
  if (isDevice && !await permitsDeviceAlert(tx, await readFeatures(tx, source.buildingId), source.buildingId, source as typeof devices.$inferSelect)) return result;
  const [open] = await tx.select({ id: alerts.id }).from(alerts).where(and(
    eq(alerts.buildingId, source.buildingId), isDevice ? eq(alerts.deviceId, source.id) : eq(alerts.gatewayId, source.id),
    eq(alerts.type, "COMMUNICATION_LOST"), ne(alerts.status, "RESOLVED"),
  )).limit(1);
  if (!open) result.alert = await persistAlert(tx, {
    buildingId: source.buildingId, deviceId: result.deviceId, gatewayId: result.gatewayId,
    severity: "HIGH", type: "COMMUNICATION_LOST", message: markOffline ? `${source.name} sem comunicação` : input.message,
    triggeredAt: evaluatedAt,
  }, checks);
  const [final] = await tx.select().from(table).where(eq(table.id, source.id)).limit(1);
  assertPersisted(final, expected, "Communication status");
  await checks.verify();
  return result;
}

/** Realtime is post-commit convenience; it never owns durable webhook delivery. */
async function publishCommunication(result: CommunicationResult | null): Promise<void> {
  if (!result) return;
  if (result.status) await publishRealtime(result.status);
  if (result.alert) await publishRealtime({ kind: "alert", buildingId: result.alert.buildingId, alertId: result.alert.alertId,
    deviceId: result.deviceId, gatewayId: result.gatewayId, severity: result.alert.severity, type: result.alert.type,
    message: result.alert.message, status: "OPEN" });
}

/** Candidates are hints only; each source is locked/rechecked before mutation. */
export async function sweepOffline(): Promise<void> {
  const staleGateways = await db.select({ id: gateways.id, buildingId: gateways.buildingId }).from(gateways).where(and(
    ne(gateways.status, "OFFLINE"), ne(gateways.status, "DISABLED"), eq(gateways.enabled, true),
    lt(gateways.lastSeenAt, sql`clock_timestamp()-make_interval(secs=>${config.GATEWAY_OFFLINE_TIMEOUT_SECONDS})`),
  ));
  for (const gateway of staleGateways) {
    const result = await db.transaction(tx => persistCommunication(tx, { buildingId: gateway.buildingId, gatewayId: gateway.id, message: "" }, true));
    await publishCommunication(result);
  }
  const staleDevices = await db.select({ id: devices.id, buildingId: devices.buildingId }).from(devices).where(and(
    ne(devices.status, "DISABLED"), eq(devices.enabled, true),
    lt(devices.lastSeenAt, sql`clock_timestamp()-make_interval(secs=>${config.DEVICE_OFFLINE_TIMEOUT_SECONDS})`),
  ));
  for (const device of staleDevices) {
    const result = await db.transaction(tx => persistCommunication(tx, { buildingId: device.buildingId, deviceId: device.id, message: "" }, true));
    await publishCommunication(result);
  }
  if (staleGateways.length || staleDevices.length) console.log(`[offline] ${staleGateways.length} gateway(s) e ${staleDevices.length} dispositivo(s) verificados.`);
}

/** Direct communication producers use the same source/outbox transaction. */
export async function raiseCommunicationAlert(input: CommunicationAlert): Promise<void> {
  await publishCommunication(await db.transaction(tx => persistCommunication(tx, input, false)));
}

export function startOfflineSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepOffline().catch(error => console.error("Falha na varredura de offline:", error));
  }, config.OFFLINE_SWEEP_INTERVAL_SECONDS * 1000);
  timer.unref();
  return timer;
}
