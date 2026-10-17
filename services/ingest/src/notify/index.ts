import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { persistIngestAlert, ingestAlertOutboxSignature, ingestAlertColumns, alerts, ingestDb, lockFeatures, type IngestAlert, type IngestTransaction } from "@predioon/db/ingest";
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

/** Caller holds the feature/source locks. Source + immutable outbox commit together. */
export async function persistAlert(tx: IngestTransaction, draft: AlertDraft, checks?: PersistenceChecks): Promise<AlertNotification> {
  const expected: typeof alerts.$inferSelect = {
    id: randomUUID(), buildingId: draft.buildingId, deviceId: draft.deviceId ?? null, gatewayId: draft.gatewayId ?? null,
    ruleId: draft.ruleId ?? null, severity: draft.severity, type: draft.type, status: "OPEN", message: draft.message,
    triggeredValue: draft.triggeredValue ?? null, triggeredAt: draft.triggeredAt, createdAt: new Date(),
    acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null,
  };
  // The private producer compares the whole row, human actors included; this
  // role can only re-read the envelope it is allowed to see.
  const event = await persistIngestAlert(tx, expected);
  const { acknowledgedBy: _a, acknowledgedAt: _b, resolvedBy: _c, resolvedAt: _d, ...envelope } = expected;
  const visible: IngestAlert = envelope;
  const [persisted] = await tx.select(ingestAlertColumns).from(alerts).where(and(eq(alerts.id, expected.id), eq(alerts.buildingId, expected.buildingId))).limit(1);
  assertPersisted(persisted, visible, "Alert source");
  if (checks) {
    // This alert/event is new in this TX, so no worker can mutate its state
    // until commit. Later source triggers must preserve the enqueue result.
    const snapshot = event.signature;
    checks.remember(`outbox:${event.eventId}`, async () => {
      assertPersisted(await ingestAlertOutboxSignature(tx, expected.id, event.eventId), snapshot, "Alert outbox");
    });
  }
  // Enqueue writes witnesses too: their immediate triggers must not change the
  // previously confirmed alert envelope before the caller commits/acknowledges.
  const [final] = await tx.select(ingestAlertColumns).from(alerts).where(eq(alerts.id, expected.id)).limit(1);
  assertPersisted(final, visible, "Alert source");
  checks?.remember(`alert:${expected.id}`, async () => {
    const [persisted] = await tx.select(ingestAlertColumns).from(alerts).where(eq(alerts.id, expected.id)).limit(1);
    assertPersisted(persisted, visible, "Alert source");
  });
  return { alertId: expected.id, buildingId: expected.buildingId, deviceId: expected.deviceId ?? expected.gatewayId ?? "",
    severity: expected.severity, type: expected.type, message: expected.message, triggeredAt: expected.triggeredAt.toISOString() };
}

/** Legacy diagnostic hook only. All webhook transport belongs to the outbox worker. */
export async function notifyAlert(alert: AlertNotification): Promise<void> {
  await ingestDb.transaction(async tx => {
    await lockFeatures(tx);
    if (!await permitsAlert(tx, alert.buildingId, alert.alertId)) return;
    console.log(`[alerta:${alert.severity}] ${alert.buildingId} · ${alert.deviceId} · ${alert.message}`);
  });
}
