import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { commonAreas, type AppTransaction } from "@predioon/db/runtime";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, HttpError, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { assertCommonAreaCreation, assertCommonAreaFeature, assertCommonAreaManagement } from "./authorization.js";

export const commonAreasRouter = Router();
commonAreasRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const ListQuerySchema = z.object({ buildingId: z.string().min(1) });

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const FieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(600).optional(),
  capacity: z.number().int().positive().optional(),
  rules: z.string().max(2000).optional(),
  opensAt: z.string().regex(TIME, "use HH:MM"),
  closesAt: z.string().regex(TIME, "use HH:MM"),
  requiresApproval: z.boolean(),
  maxHoursPerBooking: z.number().int().min(1).max(24),
});
const CreateSchema = FieldsSchema.extend({
  buildingId: z.string().min(1),
  opensAt: FieldsSchema.shape.opensAt.default("08:00"),
  closesAt: FieldsSchema.shape.closesAt.default("22:00"),
  requiresApproval: FieldsSchema.shape.requiresApproval.default(true),
  maxHoursPerBooking: FieldsSchema.shape.maxHoursPerBooking.default(6),
}).strict();
// PATCH has no creation defaults: changing the name preserves every omitted field.
const UpdateSchema = FieldsSchema.partial().extend({ active: z.boolean().optional() }).strict();

async function inCommonAreas<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a capacidade necessária para áreas comuns");
    if (["23503", "23514", "22007", "22008", "22023"].includes(code ?? "")) throw badRequest("Configuração de área comum inválida");
    if (["23505", "40001", "40P01"].includes(code ?? "")) throw conflict("A área comum foi alterada. Recarregue antes de tentar novamente.");
    if (code) throw new HttpError(500, "Não foi possível salvar ou consultar as áreas comuns");
    throw error;
  }
}

commonAreasRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const { buildingId } = query<z.infer<typeof ListQuerySchema>>(req);
  const rows = await inCommonAreas(req, async (tx) => {
    await assertCommonAreaFeature(tx, buildingId);
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
  const row = await inCommonAreas(req, async (tx) => {
    await assertCommonAreaCreation(tx, input.buildingId);
    await assertCommonAreaFeature(tx, input.buildingId);
    const id = randomUUID();
    await tx.insert(commonAreas).values({ id, ...input });
    // Resource-scoped SELECT helpers see the parent in a subsequent statement.
    const [created] = await tx.select().from(commonAreas).where(eq(commonAreas.id, id)).limit(1);
    if (!created) throw notFound("Área comum não encontrada");
    await recordAudit(tx, req, {
      buildingId: input.buildingId,
      userId: auth.userId,
      action: "COMMON_AREA_CREATED",
      resourceType: "common_area",
      resourceId: created.id,
    });
    await assertCommonAreaCreation(tx, input.buildingId);
    await assertCommonAreaManagement(tx, input.buildingId, id);
    return created;
  });

  res.status(201).json(row);
});

commonAreasRouter.patch("/:areaId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;
  const id = param(req, "areaId");
  if (!z.string().uuid().safeParse(id).success) throw notFound("Área comum não encontrada");

  const row = await inCommonAreas(req, async (tx) => {
    const [visible] = await tx.select({ id: commonAreas.id, buildingId: commonAreas.buildingId }).from(commonAreas).where(eq(commonAreas.id, id)).limit(1);
    if (!visible) throw notFound("Área comum não encontrada");
    await assertCommonAreaManagement(tx, visible.buildingId, id);
    await tx.select({ id: commonAreas.id }).from(commonAreas).where(eq(commonAreas.id, id)).for("update");
    // Refresh both row and authority after waiting for a concurrent update.
    const [current] = await tx.select().from(commonAreas).where(eq(commonAreas.id, id)).limit(1);
    if (!current) throw notFound("Área não encontrada");
    await assertCommonAreaManagement(tx, current.buildingId, id);
    await assertCommonAreaFeature(tx, current.buildingId);

    const [updated] = await tx
      .update(commonAreas)
      .set({ ...input, updatedAt: sql`clock_timestamp()` })
      .where(eq(commonAreas.id, current.id))
      .returning();
    if (!updated) throw notFound("Área comum não encontrada");
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId,
      action: "COMMON_AREA_UPDATED", resourceType: "common_area", resourceId: id });
    await assertCommonAreaManagement(tx, current.buildingId, id);
    return updated;
  });

  res.json(row);
});
