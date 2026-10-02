import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { commonAreas, reservations, readFeatures, type AppTransaction } from "@predioon/db/runtime";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { featureDisabled } from "../../auth/features.js";
import { badRequest, conflict, forbidden, HttpError, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const reservationsRouter = Router();
reservationsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const ListQuerySchema = z.object({
  buildingId: z.string().min(1), from: z.coerce.date().optional(),
  mine: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
});
const CreateSchema = z.object({
  areaId: z.string().uuid(), startsAt: z.coerce.date(), endsAt: z.coerce.date(),
  unit: z.string().max(40).optional(), notes: z.string().max(600).optional(),
}).strict();
const DecisionSchema = z.object({ status: z.enum(["CONFIRMED", "REJECTED"]) }).strict();
const CalendarQuerySchema = z.object({
  buildingId: z.string().min(1), areaId: z.string().uuid(), from: z.coerce.date(), to: z.coerce.date(),
}).refine(value => value.to > value.from && value.to.getTime() - value.from.getTime() <= 31 * 86_400_000,
  { message: "Consulte um período de até 31 dias" });
const fields = {
  id: reservations.id, buildingId: reservations.buildingId, areaId: reservations.areaId,
  userId: reservations.userId, unit: reservations.unit, startsAt: reservations.startsAt,
  endsAt: reservations.endsAt, status: reservations.status, notes: reservations.notes,
};

async function inReservations<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a capacidade necessária para reservas");
    if (code === "23P01") throw conflict("Já existe uma reserva para esta área neste horário");
    if (["55000", "23505", "40001", "40P01"].includes(code ?? "")) throw conflict("A reserva foi alterada ou encerrada. Recarregue antes de tentar novamente.");
    if (["23503", "23514", "22007", "22008", "22023"].includes(code ?? "")) throw badRequest("Dados da reserva inválidos");
    if (code) throw new HttpError(500, "Não foi possível salvar ou consultar as reservas");
    throw error;
  }
}
async function assertFeature(tx: AppTransaction, buildingId: string) {
  const [permission] = await tx.execute(sql`select app_reservation_can_read_feature_state(${buildingId}) as allowed`);
  if (!permission?.allowed) throw forbidden("Sem a capacidade necessária para reservas");
  if (!(await readFeatures(tx, buildingId)).RESERVATIONS.enabled) throw featureDisabled("RESERVATIONS");
}
async function readOne(tx: AppTransaction, id: string) {
  const [row] = await tx.select(fields).from(reservations).where(eq(reservations.id, id)).limit(1);
  if (!row) throw notFound("Reserva não encontrada");
  return row;
}
async function canManage(tx: AppTransaction, buildingId: string, id: string) {
  const [row] = await tx.execute(sql`select app_reservation_has_capability(${buildingId},${id},'reservations:manage') as allowed`);
  return Boolean(row?.allowed);
}
function reservationId(req: Request) {
  const id = param(req, "reservationId");
  if (!z.string().uuid().safeParse(id).success) throw notFound("Reserva não encontrada");
  return id;
}
async function lockManaged(tx: AppTransaction, id: string) {
  const visible = await readOne(tx, id);
  if (!await canManage(tx, visible.buildingId, id)) throw forbidden("Sem a capacidade necessária para gerenciar esta reserva");
  await tx.select({ id: reservations.id }).from(reservations).where(eq(reservations.id, id)).for("update");
  // Refresh row and authority in separate statements after a concurrent lock wait.
  const current = await readOne(tx, id);
  if (!await canManage(tx, current.buildingId, id)) throw forbidden("Sem a capacidade necessária para gerenciar esta reserva");
  await assertFeature(tx, current.buildingId);
  return current;
}

reservationsRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId, from, mine } = query<z.infer<typeof ListQuerySchema>>(req);
  const rows = await inReservations(req, async tx => {
    const [scope] = await tx.execute(sql`select app_reservation_can_read_scope(${buildingId}) as allowed`);
    if (!scope?.allowed) throw forbidden("Sem a capacidade necessária para reservas");
    await assertFeature(tx, buildingId);
    return tx.select(fields).from(reservations).where(and(
      eq(reservations.buildingId, buildingId), gte(reservations.startsAt, from ?? sql`statement_timestamp()`),
      mine ? eq(reservations.userId, auth.userId) : undefined,
    )).orderBy(asc(reservations.startsAt));
  });
  res.json({ items: rows });
});

reservationsRouter.get("/availability", validateQuery(CalendarQuerySchema), async (req, res) => {
  const { buildingId, areaId, from, to } = query<z.infer<typeof CalendarQuerySchema>>(req);
  const rows = await inReservations(req, async tx => {
    const [permission] = await tx.execute(sql`select app_reservation_can_read_calendar(${buildingId},${areaId}) as allowed`);
    if (!permission?.allowed) throw forbidden("Sem a capacidade necessária para consultar a ocupação desta área");
    await assertFeature(tx, buildingId);
    const result = await tx.execute(sql`select * from app_reservation_availability(${buildingId},${areaId},${from.toISOString()}::timestamptz,${to.toISOString()}::timestamptz)`);
    return result.map(row => ({ startsAt: row.starts_at, endsAt: row.ends_at }));
  });
  res.json({ items: rows });
});

reservationsRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  if (input.endsAt <= input.startsAt) throw badRequest("O término precisa ser depois do início");
  const row = await inReservations(req, async tx => {
    const [area] = await tx.select().from(commonAreas).where(eq(commonAreas.id, input.areaId)).limit(1);
    if (!area || !area.active) throw notFound("Área comum não encontrada");
    const [permission] = await tx.execute(sql`select app_reservation_can_create(${area.buildingId},${area.id}) as allowed, ${input.startsAt.toISOString()}::timestamptz >= clock_timestamp() as future`);
    if (!permission?.allowed) throw forbidden("Sem a capacidade necessária para solicitar reservas");
    if (!permission.future) throw badRequest("Não é possível reservar no passado");
    if ((input.endsAt.getTime() - input.startsAt.getTime()) / 3_600_000 > area.maxHoursPerBooking) throw badRequest(`Esta área permite no máximo ${area.maxHoursPerBooking}h por reserva`);
    await assertFeature(tx, area.buildingId);
    const id = randomUUID();
    // Drizzle's full-table INSERT includes DEFAULT for protected decision fields;
    // name only the columns that the runtime may insert.
    await tx.execute(sql`insert into reservations(id,building_id,area_id,user_id,unit,starts_at,ends_at,notes,status)
      values(${id}::uuid,${area.buildingId},${area.id}::uuid,${auth.userId},${input.unit ?? null},
        ${input.startsAt.toISOString()}::timestamptz,${input.endsAt.toISOString()}::timestamptz,${input.notes ?? null},
        ${area.requiresApproval ? "PENDING" : "CONFIRMED"}::reservation_status)`);
    // A later statement lets resource-scoped RLS resolve the newly inserted row.
    const created = await readOne(tx, id);
    await recordAudit(tx, req, { buildingId: area.buildingId, userId: auth.userId,
      action: "RESERVATION_CREATED", resourceType: "reservation", resourceId: id });
    return created;
  });
  res.status(201).json(row);
});

reservationsRouter.post("/:reservationId/decision", validateBody(DecisionSchema), async (req, res) => {
  const auth = currentAuth(req), id = reservationId(req);
  const { status } = req.body as z.infer<typeof DecisionSchema>;
  const row = await inReservations(req, async tx => {
    const current = await lockManaged(tx, id);
    if (current.status !== "PENDING") throw conflict("A reserva já foi decidida ou encerrada");
    const [updated] = await tx.update(reservations).set({ status, decidedBy: auth.userId,
      decidedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` }).where(eq(reservations.id, id)).returning(fields);
    if (!updated) throw notFound("Reserva não encontrada");
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId,
      action: `RESERVATION_${status}`, resourceType: "reservation", resourceId: id });
    return updated;
  });
  res.json(row);
});

reservationsRouter.delete("/:reservationId", async (req, res) => {
  const auth = currentAuth(req), id = reservationId(req);
  await inReservations(req, async tx => {
    let current = await readOne(tx, id);
    await assertFeature(tx, current.buildingId);
    if (await canManage(tx, current.buildingId, id)) {
      current = await lockManaged(tx, id);
      if (current.status === "CANCELLED") return;
      if (!["PENDING", "CONFIRMED"].includes(current.status)) throw conflict("A reserva já foi encerrada");
      const [updated] = await tx.update(reservations).set({ status: "CANCELLED", updatedAt: sql`clock_timestamp()` })
        .where(eq(reservations.id, id)).returning({ id: reservations.id });
      if (!updated) throw notFound("Reserva não encontrada");
    } else {
      const [result] = await tx.execute(sql`select app_cancel_own_reservation(${id}) as changed`);
      if (!result?.changed) return;
    }
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId,
      action: "RESERVATION_CANCELLED", resourceType: "reservation", resourceId: id });
  });
  res.status(204).end();
});
