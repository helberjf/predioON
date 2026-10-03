import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { inTenantContext } from "../../auth/middleware.js";
import { forbidden } from "../../http/errors.js";
import { PaginationSchema } from "../../http/pagination.js";
import { query, validateQuery } from "../../http/validate.js";

export const auditRouter = Router();
const AuditQuerySchema = PaginationSchema.extend({ buildingId: z.string().min(1).max(128).optional() });
auditRouter.get("/", validateQuery(AuditQuerySchema), async (req, res) => {
  const { limit, offset, buildingId } = query<z.infer<typeof AuditQuerySchema>>(req);
  const rows = await inTenantContext(req, async tx => {
    const [scope] = await tx.execute(sql`select platform,buildings from app_audit_query_scope(${buildingId ?? null})`);
    const buildings = Array.isArray(scope?.buildings) ? scope.buildings as string[] : [];
    if (!scope?.platform && !buildings.length) throw forbidden("Sem permissão para consultar esta auditoria");
    // Keep global queries off private history. Candidate local tenants come
    // from live grants; RLS retains the final resource-level privacy decision.
    const local = buildings.length ? sql`scope_building_id in (${sql.join(buildings.map(id => sql`${id}`), sql`,`)})` : sql`false`;
    const candidates = scope.platform ? sql`(scope_kind='PLATFORM' or ${local})` : local;
    return tx.execute(sql`select id,scope_building_id as "buildingId",scope_kind as "scopeKind",
      user_id as "userId",actor_type as "actorType",action,resource_type as "resourceType",resource_id as "resourceId",created_at as "createdAt"
      from audit_logs where ${candidates} and (${buildingId ?? null}::text is null or scope_building_id=${buildingId ?? null})
      order by created_at desc,id desc limit ${limit} offset ${offset}`);
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ items: rows, limit, offset });
});
