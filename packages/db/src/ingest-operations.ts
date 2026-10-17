import { eq, inArray, sql } from "drizzle-orm";
import type { DatabaseTransaction as IngestTransaction } from "./transaction.js";
import { alerts, monitoringProfiles, parkingLots } from "./schema.js";

export type IngestRejectionCategory = "INVALID_ENVELOPE" | "FUTURE_TIMESTAMP" | "UNKNOWN_SOURCE" | "CONTENT_CONFLICT" | "RETAINED_REPLAY";

export async function countIngestRejection(executor: Pick<IngestTransaction, "execute">, category: IngestRejectionCategory, buildingId = ""): Promise<void> {
  const [row] = await executor.execute(sql`select public.ingest_count_rejection(${category}::text,${buildingId}::text) as result`);
  if (!row || !("result" in row)) throw new Error("Missing rejection counter response");
}

export async function lockMonitoringProfiles(tx: IngestTransaction, buildingId: string, deviceId: string): Promise<typeof monitoringProfiles.$inferSelect[]> {
  const rows = await tx.execute<{ profile_id: string }>(sql`select profile_id from public.ingest_lock_monitoring_profiles(${buildingId}::text,${deviceId}::text)`);
  const ids = rows.map(row => { if (typeof row.profile_id !== "string") throw new Error("Invalid profile lock response"); return row.profile_id; });
  if (!ids.length) return [];
  const profiles = await tx.select().from(monitoringProfiles).where(inArray(monitoringProfiles.id, ids));
  return ids.map(id => { const profile = profiles.find(row => row.id === id); if (!profile) throw new Error("Locked monitoring profile disappeared"); return profile; });
}

export async function lockParkingLot(tx: IngestTransaction, buildingId: string, deviceId: string): Promise<typeof parkingLots.$inferSelect | null> {
  const rows = await tx.execute<{ lot_id: string }>(sql`select lot_id from public.ingest_lock_parking_lot(${buildingId}::text,${deviceId}::text)`);
  if (!rows.length) return null;
  if (rows.length !== 1 || typeof rows[0]?.lot_id !== "string") throw new Error("Invalid parking lock response");
  const [lot] = await tx.select().from(parkingLots).where(eq(parkingLots.id, rows[0].lot_id));
  if (!lot) throw new Error("Locked parking lot disappeared");
  return lot;
}

/**
 * The query builder wraps database errors with the SQL text and parameters.
 * A private helper's own serialization failure (40001) carries a fixed message
 * from 052; surface only that message, so callers keep one persistence error.
 */
async function privateWrite<T>(write: () => Promise<T>): Promise<T> {
  try { return await write(); }
  catch (error) {
    const cause = (error as { cause?: { code?: unknown; message?: unknown } })?.cause;
    if (cause?.code === "40001" && typeof cause.message === "string" && /^[A-Za-z ]{1,80}$/.test(cause.message)) {
      throw Object.assign(new Error(cause.message), { code: "40001" });
    }
    throw error;
  }
}

function signature(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid alert outbox signature");
  return value;
}

export async function persistIngestAlert(tx: IngestTransaction, expected: typeof alerts.$inferSelect): Promise<{ eventId: string; signature: string }> {
  const [row] = await privateWrite(() => tx.execute<{ event_id: string; signature: string }>(sql`select * from public.ingest_persist_alert(
    ${expected.id}::uuid,${expected.buildingId}::text,${expected.deviceId}::text,${expected.gatewayId}::text,${expected.ruleId}::uuid,
    ${expected.severity}::public.alert_severity,${expected.type}::text,${expected.message}::text,
    ${expected.triggeredValue === null ? null : JSON.stringify(expected.triggeredValue)}::jsonb,
    ${expected.triggeredAt.toISOString()}::timestamptz,${expected.createdAt.toISOString()}::timestamptz)`));
  if (!row || typeof row.event_id !== "string" || !row.event_id) throw new Error("Missing alert producer response");
  return { eventId: row.event_id, signature: signature(row.signature) };
}

export async function ingestAlertOutboxSignature(tx: IngestTransaction, alertId: string, eventId: string): Promise<string> {
  const [row] = await privateWrite(() => tx.execute(sql`select public.ingest_alert_outbox_signature(${alertId}::uuid,${eventId}::uuid) as signature`));
  return signature(row?.signature);
}

export type ParkingObservation = { lotId: string; buildingId: string; deviceId: string; eventId: string; occupied: number; observedAt: Date; updatedAt: Date; expectedVersion: number };
export async function writeParkingObservation(tx: IngestTransaction, input: ParkingObservation): Promise<boolean> {
  const [row] = await privateWrite(() => tx.execute(sql`select public.ingest_write_parking_observation(${input.lotId}::uuid,
    ${input.buildingId}::text,${input.deviceId}::text,${input.eventId}::text,${input.occupied}::integer,
    ${input.observedAt.toISOString()}::timestamptz,${input.updatedAt.toISOString()}::timestamptz,${input.expectedVersion}::integer) as changed`));
  if (typeof row?.changed !== "boolean") throw new Error("Missing parking observation response");
  return row.changed;
}
