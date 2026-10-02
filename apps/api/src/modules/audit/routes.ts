import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditLogs } from "@predioon/db/runtime";
import { z } from "zod";
import { currentAuth, inTenantContext, requireRole } from "../../auth/middleware.js";
import { PaginationSchema } from "../../http/pagination.js";
import { query, validateQuery } from "../../http/validate.js";

export const auditRouter = Router();

const AuditQuerySchema = PaginationSchema.extend({ buildingId: z.string().optional() });

auditRouter.get("/", requireRole("BUILDING_ADMIN"), validateQuery(AuditQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { limit, offset, buildingId } = query<z.infer<typeof AuditQuerySchema>>(req);

  // RLS already restricts the rows; the filters below are for convenience, not for security.
  const rows = await inTenantContext(req, (tx) =>
    tx
      .select()
      .from(auditLogs)
      .where(
        buildingId
          ? eq(auditLogs.buildingId, buildingId)
          : auth.role === "PLATFORM_ADMIN"
            ? undefined
            : and(inArray(auditLogs.buildingId, auth.memberships.map((m) => m.buildingId))),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
  );

  res.json({ items: rows, limit, offset });
});
