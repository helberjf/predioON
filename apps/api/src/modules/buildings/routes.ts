import { Router } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { buildings } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole, scopedBuildingIds } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { validateBody } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const buildingsRouter = Router();

const CreateSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(30),
  timezone: z.string().max(60).default("America/Sao_Paulo"),
  address: z.record(z.string(), z.unknown()).optional(),
});
const UpdateSchema = CreateSchema.partial().omit({ organizationId: true }).extend({ active: z.boolean().optional() });

/** Residents and building admins see only their own buildings; RLS enforces the same rule. */
buildingsRouter.get("/", async (req, res) => {
  const scope = scopedBuildingIds(currentAuth(req));
  const rows = await inTenantContext(req, (tx) => {
    const base = tx.select().from(buildings);
    return scope ? base.where(inArray(buildings.id, scope.length ? scope : [""])).orderBy(asc(buildings.name))
                 : base.orderBy(asc(buildings.name));
  });
  res.json({ items: rows });
});

buildingsRouter.get("/:buildingId", async (req, res) => {
  assertBuildingAccess(currentAuth(req), param(req, "buildingId"));
  const [row] = await inTenantContext(req, (tx) =>
    tx.select().from(buildings).where(eq(buildings.id, param(req, "buildingId"))).limit(1),
  );
  if (!row) throw notFound("Prédio não encontrado");
  res.json(row);
});

buildingsRouter.post("/", requireRole("PLATFORM_ADMIN"), validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx
      .insert(buildings)
      .values({ id: generateId("bld"), ...input, address: input.address ?? {} })
      .returning();
    await recordAudit(tx, req, {
      buildingId: created!.id,
      userId: auth.userId,
      action: "BUILDING_CREATED",
      resourceType: "building",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(row);
});

buildingsRouter.patch("/:buildingId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const buildingId = param(req, "buildingId");
  assertBuildingAccess(auth, buildingId, "BUILDING_ADMIN");
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [updated] = await tx
      .update(buildings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(buildings.id, buildingId))
      .returning();
    if (!updated) throw notFound("Prédio não encontrado");
    await recordAudit(tx, req, {
      buildingId,
      userId: auth.userId,
      action: "BUILDING_UPDATED",
      resourceType: "building",
      resourceId: buildingId,
      metadata: input,
    });
    return updated;
  });

  res.json(row);
});
