import { Router, type RequestHandler } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { alerts, readFeatures } from "@predioon/db/runtime";
import type { FeatureStates } from "@predioon/shared";
import { inTenantContext } from "../../auth/middleware.js";
import { featureDisabled } from "../../auth/features.js";
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from "../../http/errors.js";
import { PaginationSchema } from "../../http/pagination.js";
import { query, validateQuery } from "../../http/validate.js";
import { param } from "../../http/params.js";
import { alertFeatureKeys, authorizedAlertContexts, type AlertCapability } from "./authorization.js";

export const alertsRouter = Router();
const ListQuerySchema = PaginationSchema.extend({
  buildingId: z.string().min(1).optional(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
});

alertsRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const { buildingId, status, limit, offset } = query<z.infer<typeof ListQuerySchema>>(req);
  const rows = await inTenantContext(req, async (tx) => {
    if (buildingId) {
      const [scope] = await tx.execute(sql`select app_alert_can_read_feature_state(${buildingId}) as allowed`);
      if (!scope?.allowed) throw forbidden("Sem a capacidade necessária para alertas");
    }
    const candidates = await tx.select().from(alerts)
      .where(and(buildingId ? eq(alerts.buildingId, buildingId) : undefined, status ? eq(alerts.status, status) : undefined))
      .orderBy(desc(alerts.createdAt), desc(alerts.id)).limit(limit).offset(offset);
    const states = new Map<string, FeatureStates>();
    const visible: typeof candidates = [];
    for (const alert of candidates) {
      const [context] = await authorizedAlertContexts(tx, alert.buildingId, alert.id);
      if (!context) continue;
      if (!states.has(alert.buildingId)) states.set(alert.buildingId, await readFeatures(tx, alert.buildingId));
      if (alertFeatureKeys(context, alert.type).every(key => states.get(alert.buildingId)![key].enabled)) visible.push(alert);
    }
    return visible;
  });
  res.json({ items: rows, limit, offset });
});

function transitionHandler(status: "ACKNOWLEDGED" | "RESOLVED"): RequestHandler {
  return async (req, res) => {
    const id = param(req, "alertId");
    if (!z.uuid().safeParse(id).success) throw notFound("Alerta não encontrado");
    const capability: AlertCapability = status === "ACKNOWLEDGED" ? "alerts:acknowledge" : "alerts:resolve";
    try {
      const updated = await inTenantContext(req, async (tx) => {
        const [alert] = await tx.select().from(alerts).where(eq(alerts.id, id)).limit(1);
        if (!alert) throw notFound("Alerta não encontrado");
        const [context] = await authorizedAlertContexts(tx, alert.buildingId, alert.id);
        if (!context) throw notFound("Alerta não encontrado");
        const [scope] = await tx.execute(sql`select app_alert_has_capability(${alert.buildingId},${alert.id},${capability}) as allowed`);
        if (!scope?.allowed) throw forbidden("Sem a capacidade necessária para esta transição");
        // inTenantContext holds the shared feature lock through the transition.
        const states = await readFeatures(tx, alert.buildingId);
        for (const key of alertFeatureKeys(context, alert.type)) if (!states[key].enabled) throw featureDisabled(key);
        await tx.execute(sql`select app_transition_alert(${alert.id}::uuid,${status},${req.ip ?? null},${req.header("user-agent") ?? null})`);
        const [row] = await tx.select().from(alerts).where(eq(alerts.id, alert.id)).limit(1);
        if (!row) throw notFound("Alerta não encontrado");
        return row;
      });
      res.json(updated);
    } catch (error) {
      switch (pgErrorCode(error)) {
        case "P0002": throw notFound("Alerta não encontrado");
        case "42501": throw forbidden("Sem a capacidade necessária para esta transição");
        case "P0409": throw conflict("Alerta resolvido não pode voltar para reconhecido");
        case "22023": throw badRequest("Estado de alerta inválido");
        default: throw error;
      }
    }
  };
}

alertsRouter.post("/:alertId/acknowledge", transitionHandler("ACKNOWLEDGED"));
alertsRouter.post("/:alertId/resolve", transitionHandler("RESOLVED"));
