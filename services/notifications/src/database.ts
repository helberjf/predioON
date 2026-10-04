import type postgres from "postgres";
import { createNotificationSqlClient, verifyRestrictedDatabaseRole } from "@predioon/db/notifications";
import type { AttemptFactory, Claim, Completion, Delivery, NotificationAttempt } from "./protocol.js";
import type { TransportOutcome } from "./transport.js";

type ClientFactory = (onclose: () => void) => postgres.Sql;
const completionStates = new Set<Completion>(["delivered", "retry", "failed", "cancelled", "no_destination", "stale"]);

export function notificationAttemptFactory(makeClient: ClientFactory = createNotificationSqlClient): AttemptFactory {
  return async shutdown => {
    const cancelled = new AbortController();
    let valid = true;
    let began = false;
    let session: postgres.ReservedSql | undefined;
    let ending: Promise<void> | undefined;
    let closed = false;
    const client = makeClient(() => { valid = false; cancelled.abort(); });
    const terminate = () => ending ??= client.end({ timeout: 0 });
    const stop = () => {
      valid = false; cancelled.abort();
      void terminate().catch(() => {});
    };
    shutdown.addEventListener("abort", stop, { once: true });
    const active = () => valid && !cancelled.signal.aborted && !shutdown.aborted;
    const requireActive = () => { if (!active()) throw new Error("Notification backend unavailable"); };
    const destroy = async () => {
      shutdown.removeEventListener("abort", stop);
      await terminate();
    };
    try {
      if (shutdown.aborted) stop();
      requireActive();
      // max:1 ensures reserve uses this authenticated backend; loss invalidates it.
      await verifyRestrictedDatabaseRole(client, "predioon_notifications");
      requireActive();
      session = await client.reserve();
      requireActive();
      await session`select notification_begin_attempt()`;
      began = true;
      requireActive();
    } catch {
      await destroy();
      throw new Error("Notification database attempt could not start");
    }
    const connection = session;
    const attempt: NotificationAttempt = {
      signal: cancelled.signal,
      isValid: active,
      async claim() {
        requireActive();
        const rows = await connection`select * from notification_claim(1)`;
        requireActive();
        if (!rows.length) return undefined;
        if (rows.length !== 1) throw new Error("Invalid notification claim response");
        const row = rows[0]!;
        for (const field of ["delivery_id", "event_id", "claim_token"])
          if (typeof row[field] !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row[field]))
            throw new Error("Invalid notification reservation identity");
        return { deliveryId: row.delivery_id as string, eventId: row.event_id as string, token: row.claim_token as string };
      },
      async revalidate(claim: Claim): Promise<Delivery | undefined> {
        requireActive();
        const rows = await connection`select * from notification_revalidate(${claim.deliveryId}::uuid,${claim.token}::uuid)`;
        requireActive();
        if (!rows.length) return undefined;
        if (rows.length !== 1) throw new Error("Invalid notification revalidation response");
        const row = rows[0]!;
        if (row.delivery_id !== claim.deliveryId || row.event_id !== claim.eventId ||
            row.idempotency_key !== `${claim.eventId}/webhook/alert.raised.v1` ||
            !["building_id", "alert_id", "device_id", "severity", "alert_type", "message"].every(key => typeof row[key] === "string") ||
            !(row.triggered_at instanceof Date) || !Number.isFinite(row.triggered_at.valueOf()))
          throw new Error("Invalid notification payload identity");
        return {
          idempotencyKey: row.idempotency_key as string,
          payload: { alertId: row.alert_id as string, buildingId: row.building_id as string,
            deviceId: row.device_id as string, severity: row.severity as string, type: row.alert_type as string,
            message: row.message as string, triggeredAt: row.triggered_at.toISOString() },
        };
      },
      async complete(claim: Claim, outcome: Exclude<TransportOutcome, { kind: "aborted" }>): Promise<Completion> {
        requireActive();
        const httpStatus = outcome.kind === "http" ? outcome.status : null;
        const delay = outcome.kind === "http" ? outcome.retryAfterSeconds ?? null : null;
        const rows = await connection`select notification_complete(${claim.deliveryId}::uuid,${claim.token}::uuid,${outcome.kind},${httpStatus}::integer,${delay}::integer) as status`;
        requireActive();
        const result = rows[0]?.status as Completion;
        if (rows.length !== 1 || !completionStates.has(result)) throw new Error("Invalid notification completion response");
        return result;
      },
      async close() {
        if (closed) return;
        closed = true;
        let confirmed = false;
        try {
          if (began && active()) {
            const rows = await connection`select notification_end_attempt() as released`;
            if (rows.length !== 1 || rows[0]?.released !== true) throw new Error("Notification barrier release unconfirmed");
            confirmed = true;
          }
        } finally {
          // Never release a poisoned reserve. Ending this whole client releases
          // session locks even after a failed statement, rollback or reconnect.
          if (confirmed) connection.release();
          await destroy();
        }
      },
    };
    return attempt;
  };
}
