import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { alerts, db, lockFeatures, type DbTransaction } from "@predioon/db";
import { permitsAlert } from "../features.js";

export type AlertNotification = {
  alertId: string;
  buildingId: string;
  deviceId: string;
  severity: string;
  type: string;
  message: string;
  triggeredAt: string;
};

/** Compare the persisted JSON representation, including Dates and numeric -0. */
export function assertPersisted(actual: unknown, expected: unknown, source: string): void {
  if (actual === undefined || !isDeepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))) {
    throw new Error(`${source} write was not persisted`);
  }
}

/** Check the last intended write per row after every writer in the source TX. */
export class PersistenceChecks {
  private readonly checks = new Map<string, () => Promise<void>>();
  remember(key: string, check: () => Promise<void>): void { this.checks.set(key, check); }
  async verify(): Promise<void> { for (const check of this.checks.values()) await check(); }
}

type AlertDraft = Pick<typeof alerts.$inferInsert, "buildingId" | "deviceId" | "gatewayId" | "ruleId" | "severity" | "type" | "message" | "triggeredValue"> & { triggeredAt: Date };

async function outboxSnapshot(tx: DbTransaction, eventId: string): Promise<unknown> {
  const [row] = await tx.execute<{ snapshot: unknown }>(sql`select jsonb_build_object(
    'event',to_jsonb(e),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.event_deliveries d where d.event_id=e.id),'[]'::jsonb),
    'witnesses',coalesce((select jsonb_agg(to_jsonb(w) order by w.delivery_id,w.clause_id) from public.delivery_witnesses w
      join public.event_deliveries d on d.id=w.delivery_id where d.event_id=e.id),'[]'::jsonb),
    'features',coalesce((select jsonb_agg(to_jsonb(f) order by f.delivery_id,f.clause_id,f.feature_key) from public.delivery_witness_features f
      join public.event_deliveries d on d.id=f.delivery_id where d.event_id=e.id),'[]'::jsonb)
    ) as snapshot from public.outbox_events e where e.id=${eventId}::uuid`);
  if (!row?.snapshot) throw new Error("Alert outbox write was not persisted");
  return row.snapshot;
}

/** Caller holds the feature/source locks. Source + immutable outbox commit together. */
export async function persistAlert(tx: DbTransaction, draft: AlertDraft, checks?: PersistenceChecks): Promise<AlertNotification> {
  const expected: typeof alerts.$inferSelect = {
    id: randomUUID(), buildingId: draft.buildingId, deviceId: draft.deviceId ?? null, gatewayId: draft.gatewayId ?? null,
    ruleId: draft.ruleId ?? null, severity: draft.severity, type: draft.type, status: "OPEN", message: draft.message,
    triggeredValue: draft.triggeredValue ?? null, triggeredAt: draft.triggeredAt, createdAt: new Date(),
    acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null,
  };
  const inserted = await tx.insert(alerts).values(expected).returning();
  assertPersisted(inserted.length === 1 ? inserted[0] : undefined, expected, "Alert source");
  const [persisted] = await tx.select().from(alerts).where(and(eq(alerts.id, expected.id), eq(alerts.buildingId, expected.buildingId))).limit(1);
  assertPersisted(persisted, expected, "Alert source");
  const [event] = await tx.execute<{ eventId: string }>(sql`select notification_enqueue_alert(${expected.id}::uuid) as "eventId"`);
  if (!event?.eventId) throw new Error("Alert outbox write was not persisted");
  if (checks) {
    // This alert/event is new in this TX, so no worker can mutate its state
    // until commit. Later source triggers must preserve the enqueue result.
    const snapshot = await outboxSnapshot(tx, event.eventId);
    checks.remember(`outbox:${event.eventId}`, async () => {
      assertPersisted(await outboxSnapshot(tx, event.eventId), snapshot, "Alert outbox");
    });
  }
  // Enqueue writes witnesses too: their immediate triggers must not change the
  // previously confirmed alert envelope before the caller commits/acknowledges.
  const [final] = await tx.select().from(alerts).where(eq(alerts.id, expected.id)).limit(1);
  assertPersisted(final, expected, "Alert source");
  checks?.remember(`alert:${expected.id}`, async () => {
    const [persisted] = await tx.select().from(alerts).where(eq(alerts.id, expected.id)).limit(1);
    assertPersisted(persisted, expected, "Alert source");
  });
  return { alertId: expected.id, buildingId: expected.buildingId, deviceId: expected.deviceId ?? expected.gatewayId ?? "",
    severity: expected.severity, type: expected.type, message: expected.message, triggeredAt: expected.triggeredAt.toISOString() };
}

/** Legacy diagnostic hook only. All webhook transport belongs to the outbox worker. */
export async function notifyAlert(alert: AlertNotification): Promise<void> {
  await db.transaction(async tx => {
    await lockFeatures(tx);
    if (!await permitsAlert(tx, alert.buildingId, alert.alertId)) return;
    console.log(`[alerta:${alert.severity}] ${alert.buildingId} · ${alert.deviceId} · ${alert.message}`);
  });
}
