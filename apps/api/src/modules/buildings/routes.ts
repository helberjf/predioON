import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { buildings } from "@predioon/db/runtime";
import { CreatePropertySchema, UpdatePropertySchema } from "@predioon/shared";
import { assertBuildingDiscovery, assertCapability, assertGlobalCapability, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { validateBody } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const buildingsRouter = Router();

const CreateSchema = CreatePropertySchema;
const UpdateSchema = UpdatePropertySchema;

/** PostgreSQL discovers current scopes from bindings, teams and diagnostic grants. */
buildingsRouter.get("/", async (req, res) => {
  const rows = await inTenantContext(req, tx => tx.select().from(buildings).orderBy(asc(buildings.name)));
  res.json({ items: rows });
});

buildingsRouter.get("/:buildingId", async (req, res) => {
  const buildingId = param(req, "buildingId");
  const row = await inTenantContext(req, async tx => {
    await assertBuildingDiscovery(tx, buildingId);
    const [found] = await tx.select().from(buildings).where(eq(buildings.id, buildingId)).limit(1);
    if (!found) throw notFound("Prédio não encontrado");
    return found;
  });
  res.json(row);
});

buildingsRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await inTenantContext(req, async (tx) => {
    await assertGlobalCapability(tx, "buildings:provision");
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
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [global] = await tx.execute(sql`select app_has_global_capability('buildings:manage') as allowed`);
    if (!global?.allowed) await assertCapability(tx, "buildings:manage", buildingId, { type: "building", id: buildingId });
    const [existing] = await tx.select().from(buildings).where(eq(buildings.id, buildingId)).for("update").limit(1);
    if (!existing) throw notFound("Prédio não encontrado");
    // Auditing before deactivation preserves the current tenant grant; rollback
    // keeps the audit and mutation atomic if the update subsequently fails.
    await recordAudit(tx, req, {
      buildingId,
      userId: auth.userId,
      action: "BUILDING_UPDATED",
      resourceType: "building",
      resourceId: buildingId,
      metadata: input,
    });
    const [updated] = await tx.update(buildings).set({ ...input, updatedAt: new Date() })
      .where(eq(buildings.id, buildingId)).returning();
    if (!updated) throw notFound("Prédio não encontrado");
    return updated;
  });

  res.json(row);
});
