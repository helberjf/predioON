import { sql } from "drizzle-orm";
import type { AccessAck } from "@predioon/shared";
import type { DatabaseTransaction as AccessServiceTransaction } from "./transaction.js";

export type AccessDispatchCandidate = { id: string; buildingId: string; gatewayId: string; gateId: string; deviceId: string; createdAt: Date; expiresAt: Date; gateKind: "GARAGE" | "PEDESTRIAN" | null };
export type PendingFailureCode = "NO_LIVE_CONNECTION" | "BEFORE_CONNECTION" | "FEATURE_PAUSED";
export type PublishFailureCode = "DISCONNECTED" | "OFFLINE_QUEUE" | "DEADLINE" | "BEFORE_CONNECTION" | "SEND_TIMEOUT" | "PUBLISH_FAILURE";

function text(value: unknown): string { if (typeof value !== "string" || !value) throw new Error("Invalid access response identity"); return value; }
function date(value: unknown): Date {
  if (!(value instanceof Date) && typeof value !== "string") throw new Error("Invalid access response timestamp");
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid access response timestamp");
  return result;
}
function changed(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("Missing access transition response"); return value; }

export async function nextPendingAccess(tx: AccessServiceTransaction): Promise<AccessDispatchCandidate | null> {
  const rows = await tx.execute(sql`select * from public.access_service_next_pending()`);
  if (!rows.length) return null;
  const row = rows[0]!;
  if (rows.length !== 1 || ![null, "GARAGE", "PEDESTRIAN"].includes(row.gate_kind as string | null)) throw new Error("Invalid access candidate response");
  return { id: text(row.id), buildingId: text(row.building_id), gatewayId: text(row.gateway_id), gateId: text(row.gate_id),
    deviceId: text(row.device_id), createdAt: date(row.created_at), expiresAt: date(row.expires_at), gateKind: row.gate_kind as AccessDispatchCandidate["gateKind"] };
}
export async function expireAccessCommands(tx: AccessServiceTransaction): Promise<number> {
  const [row] = await tx.execute(sql`select public.access_service_expire_commands() as count`);
  if (typeof row?.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error("Missing access expiration response");
  return row.count;
}
export async function failPendingAccess(tx: AccessServiceTransaction, id: string, reason: PendingFailureCode): Promise<boolean> {
  const [row] = await tx.execute(sql`select public.access_service_fail_pending(${id}::uuid,${reason}::text) as changed`);
  return changed(row?.changed);
}
export async function markAccessSent(tx: AccessServiceTransaction, id: string): Promise<string | null> {
  const [row] = await tx.execute(sql`select public.access_service_mark_sent(${id}::uuid) as reason`);
  if (!row || (row.reason !== null && (typeof row.reason !== "string" || !row.reason))) throw new Error("Missing access send decision");
  return row.reason;
}
export async function failAccessPublish(tx: AccessServiceTransaction, id: string, reason: PublishFailureCode): Promise<boolean> {
  const [row] = await tx.execute(sql`select public.access_service_fail_publish(${id}::uuid,${reason}::text) as changed`);
  return changed(row?.changed);
}
export async function applyAccessAck(tx: AccessServiceTransaction, ack: AccessAck): Promise<boolean> {
  const [row] = await tx.execute(sql`select public.access_service_apply_ack(${ack.commandId}::uuid,${ack.buildingId}::text,
    ${ack.gatewayId}::text,${ack.gateId}::text,${ack.deviceId}::text,${ack.result}::text) as changed`);
  return changed(row?.changed);
}
