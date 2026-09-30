import { Router } from "express";
import { z } from "zod";
import { and, inArray, sql } from "drizzle-orm";
import { rbacPermissions } from "@predioon/db/runtime";
import { CAPABILITIES, ResourceTypeSchema } from "@predioon/shared";
import { inTenantContext } from "../../auth/middleware.js";
import { forbidden } from "../../http/errors.js";
import { query, validateQuery } from "../../http/validate.js";

export const authorizationRouter = Router();
const Scope = z.object({ buildingId: z.string().min(1).max(128), resourceType: ResourceTypeSchema.optional(), resourceId: z.string().min(1).max(128).optional() })
  .refine(value => Boolean(value.resourceType) === Boolean(value.resourceId), "Informe tipo e identificador do recurso juntos");

authorizationRouter.get("/", validateQuery(Scope), async (req, res) => {
  const scope = query<z.infer<typeof Scope>>(req);
  const capabilities = await inTenantContext(req, async tx => {
    const rows = await tx.select({ key: rbacPermissions.key }).from(rbacPermissions).where(and(
      inArray(rbacPermissions.key, [...CAPABILITIES]),
      sql`app_has_capability(${scope.buildingId}, ${rbacPermissions.key}, ${scope.resourceType ?? null}, ${scope.resourceId ?? null})`,
    )).orderBy(rbacPermissions.key);
    return rows.map(row => row.key);
  });
  if (!capabilities.length) throw forbidden("Condomínio ou recurso fora do seu escopo");
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...scope, capabilities });
});
