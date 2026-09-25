import { Router, type RequestHandler } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { alerts } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole, scopedBuildingIds } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { PaginationSchema } from "../../http/pagination.js";
import { query, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";
import { assertSensorFeatures, buildingFeatures, filterSensorRows } from "../../auth/features.js";

export const alertsRouter = Router();

const ListQuerySchema = PaginationSchema.extend({
  buildingId: z.string().optional(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
});

alertsRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId, status, limit, offset } = query<z.infer<typeof ListQuerySchema>>(req);
  if (buildingId) assertBuildingAccess(auth, buildingId);
  const scope = scopedBuildingIds(auth);

  const rows = await inTenantContext(req, async (tx) => {
    if (buildingId) await buildingFeatures(tx, buildingId);
    const filters = [
      buildingId ? eq(alerts.buildingId, buildingId) : undefined,
      scope && !buildingId ? inArray(alerts.buildingId, scope.length ? scope : [""]) : undefined,
      status ? eq(alerts.status, status) : undefined,
    ].filter(Boolean);
    const candidates = await tx
      .select()
      .from(alerts)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(alerts.createdAt))
      .limit(limit)
      .offset(offset);
    return filterSensorRows(tx, candidates);
  });

  res.json({ items: rows, limit, offset });
});

type Transition = { status: "ACKNOWLEDGED" | "RESOLVED"; action: string };

/** Acknowledge and resolve differ only by the columns they stamp, so one handler covers both. */
function transitionHandler({ status, action }: Transition): RequestHandler {
  return async (req, res) => {
    const auth = currentAuth(req);
    const now = new Date();

    const row = await inTenantContext(req, async (tx) => {
      const [alert] = await tx.select().from(alerts).where(eq(alerts.id, param(req, "alertId"))).limit(1);
      if (!alert) throw notFound("Alerta não encontrado");
      assertBuildingAccess(auth, alert.buildingId, "BUILDING_ADMIN");
      await assertSensorFeatures(tx, alert, true);

      const [updated] = await tx
        .update(alerts)
        .set(
          status === "ACKNOWLEDGED"
            ? { status, acknowledgedBy: auth.userId, acknowledgedAt: now }
            : { status, resolvedBy: auth.userId, resolvedAt: now },
        )
        .where(eq(alerts.id, alert.id))
        .returning();

      await recordAudit(tx, req, {
        buildingId: alert.buildingId,
        userId: auth.userId,
        action,
        resourceType: "alert",
        resourceId: alert.id,
      });
      return updated!;
    });

    res.json(row);
  };
}

alertsRouter.post(
  "/:alertId/acknowledge",
  requireRole("BUILDING_ADMIN"),
  transitionHandler({ status: "ACKNOWLEDGED", action: "ALERT_ACKNOWLEDGED" }),
);

alertsRouter.post(
  "/:alertId/resolve",
  requireRole("BUILDING_ADMIN"),
  transitionHandler({ status: "RESOLVED", action: "ALERT_RESOLVED" }),
);
