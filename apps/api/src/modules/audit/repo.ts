import { auditLogs, type AppTransaction } from "@predioon/db/runtime";
import type { Request } from "express";

type AuditInput = {
  buildingId?: string | null;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Called inside the same transaction as the change, so the log can never drift from the data. */
export async function recordAudit(tx: AppTransaction, req: Request, input: AuditInput): Promise<void> {
  await tx.insert(auditLogs).values({
    buildingId: input.buildingId ?? null,
    userId: input.userId,
    actorType: "USER",
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
    metadata: input.metadata ?? {},
  });
}
