import { assertFeature } from "../../auth/features.js";
import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { commonAreas } from "@predioon/db/runtime";
import { assertBuildingAccess, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const commonAreasRouter = Router();

const ListQuerySchema = z.object({ buildingId: z.string().min(1) });

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  name: z.string().min(2).max(120),
  description: z.string().max(600).optional(),
  capacity: z.number().int().positive().optional(),
  rules: z.string().max(2000).optional(),
  opensAt: z.string().regex(TIME, "use HH:MM").default("08:00"),
  closesAt: z.string().regex(TIME, "use HH:MM").default("22:00"),
  requiresApproval: z.boolean().default(true),
  maxHoursPerBooking: z.number().int().min(1).max(24).default(6),
});
const UpdateSchema = CreateSchema.partial().omit({ buildingId: true }).extend({ active: z.boolean().optional() });

commonAreasRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const { buildingId } = query<z.infer<typeof ListQuerySchema>>(req);
  assertBuildingAccess(currentAuth(req), buildingId);

  const rows = await inTenantContext(req, async (tx) => {
    await assertFeature(tx, buildingId, "RESERVATIONS");
    return tx
      .select()
      .from(commonAreas)
      .where(and(eq(commonAreas.buildingId, buildingId), eq(commonAreas.active, true)))
      .orderBy(asc(commonAreas.name));
  });

  res.json({ items: rows });
});

commonAreasRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");

  const row = await inTenantContext(req, async (tx) => {
    await assertFeature(tx, input.buildingId, "RESERVATIONS", true);
    const [created] = await tx.insert(commonAreas).values(input).returning();
    await recordAudit(tx, req, {
      buildingId: input.buildingId,
      userId: auth.userId,
      action: "COMMON_AREA_CREATED",
      resourceType: "common_area",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(row);
});

commonAreasRouter.patch("/:areaId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(commonAreas).where(eq(commonAreas.id, param(req, "areaId"))).limit(1);
    if (!current) throw notFound("Área não encontrada");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, "RESERVATIONS", true);

    const [updated] = await tx
      .update(commonAreas)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(commonAreas.id, current.id))
      .returning();
    return updated!;
  });

  res.json(row);
});
