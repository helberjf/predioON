import { assertFeature } from "../../auth/features.js";
import { Router } from "express";
import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { commonAreas, reservations } from "@predioon/db/runtime";
import { assertBuildingAccess, buildingRole, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const reservationsRouter = Router();

const ListQuerySchema = z.object({
  buildingId: z.string().min(1),
  from: z.coerce.date().optional(),
  mine: z.coerce.boolean().default(false),
});

const CreateSchema = z.object({
  areaId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  unit: z.string().max(40).optional(),
  notes: z.string().max(600).optional(),
});

const DecisionSchema = z.object({ status: z.enum(["CONFIRMED", "REJECTED"]) });

/** PostgreSQL error raised by the `reservations_no_overlap` exclusion constraint. */
const EXCLUSION_VIOLATION = "23P01";

function isExclusionViolation(error: unknown): boolean {
  return pgErrorCode(error) === EXCLUSION_VIOLATION;
}

reservationsRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId, from, mine } = query<z.infer<typeof ListQuerySchema>>(req);
  assertBuildingAccess(auth, buildingId);

  const rows = await inTenantContext(req, async (tx) => {
    await assertFeature(tx, buildingId, "RESERVATIONS");
    return tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.buildingId, buildingId),
          gte(reservations.startsAt, from ?? new Date()),
          mine ? eq(reservations.userId, auth.userId) : undefined,
        ),
      )
      .orderBy(asc(reservations.startsAt));
  });

  res.json({ items: rows });
});

reservationsRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  if (input.endsAt <= input.startsAt) throw badRequest("O término precisa ser depois do início");
  if (input.startsAt.getTime() < Date.now()) throw badRequest("Não é possível reservar no passado");

  try {
    const row = await inTenantContext(req, async (tx) => {
      const [area] = await tx.select().from(commonAreas).where(eq(commonAreas.id, input.areaId)).limit(1);
      if (!area || !area.active) throw notFound("Área comum não encontrada");
      assertBuildingAccess(auth, area.buildingId);
      await assertFeature(tx, area.buildingId, "RESERVATIONS");

      const hours = (input.endsAt.getTime() - input.startsAt.getTime()) / 3_600_000;
      if (hours > area.maxHoursPerBooking) {
        throw badRequest(`Esta área permite no máximo ${area.maxHoursPerBooking}h por reserva`);
      }

      const [created] = await tx
        .insert(reservations)
        .values({
          buildingId: area.buildingId,
          areaId: area.id,
          userId: auth.userId,
          unit: input.unit ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          notes: input.notes ?? null,
          // An area that needs no approval is confirmed on the spot.
          status: area.requiresApproval ? "PENDING" : "CONFIRMED",
        })
        .returning();

      return created!;
    });

    res.status(201).json(row);
  } catch (error) {
    // The database, not the application, is what guarantees there is no double booking.
    if (isExclusionViolation(error)) throw conflict("Já existe uma reserva para esta área neste horário");
    throw error;
  }
});

reservationsRouter.post("/:reservationId/decision", validateBody(DecisionSchema), async (req, res) => {
  const auth = currentAuth(req);
  const { status } = req.body as z.infer<typeof DecisionSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(reservations).where(eq(reservations.id, param(req, "reservationId"))).limit(1);
    if (!current) throw notFound("Reserva não encontrada");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, "RESERVATIONS", true);

    const [updated] = await tx
      .update(reservations)
      .set({ status, decidedBy: auth.userId, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(reservations.id, current.id))
      .returning();

    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: `RESERVATION_${status}`,
      resourceType: "reservation",
      resourceId: current.id,
    });

    return updated!;
  });

  res.json(row);
});

reservationsRouter.delete("/:reservationId", async (req, res) => {
  const auth = currentAuth(req);

  await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(reservations).where(eq(reservations.id, param(req, "reservationId"))).limit(1);
    if (!current) throw notFound("Reserva não encontrada");

    const role = buildingRole(auth, current.buildingId);
    const isAdmin = role === "BUILDING_ADMIN" || role === "PLATFORM_ADMIN";
    await assertFeature(tx, current.buildingId, "RESERVATIONS", isAdmin);
    if (!isAdmin && current.userId !== auth.userId) throw forbidden("Você só pode cancelar as suas reservas");

    await tx
      .update(reservations)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(reservations.id, current.id));
  });

  res.status(204).end();
});
