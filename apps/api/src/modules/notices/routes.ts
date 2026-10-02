import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { notices, noticeSchedules, type AppTransaction } from "@predioon/db/runtime";
import { nextNoticeOccurrence, NoticeScheduleSchema, type NoticeSchedule } from "@predioon/shared";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, HttpError, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { assertNoticeCreation, assertNoticeFeature, assertNoticeManagement, assertNoticeScope, noticeFeatures } from "./authorization.js";

export const noticesRouter = Router();
const BooleanQuery = z.enum(["true", "false"]).default("false").transform(value => value === "true");
const ListQuerySchema = z.object({ buildingId: z.string().min(1), category: z.enum(["COMMUNICATION", "MAINTENANCE", "EVENT", "WASTE_COLLECTION", "GESTAO"]).optional(), includeExpired: BooleanQuery, includeUnpublished: BooleanQuery });
const FieldsSchema = z.object({
  category: z.enum(["COMMUNICATION", "MAINTENANCE", "EVENT", "WASTE_COLLECTION", "GESTAO"]),
  title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(4000), pinned: z.boolean(),
  publishedAt: z.string().datetime({ offset: true }).transform(value => new Date(value)),
  expiresAt: z.string().datetime({ offset: true }).transform(value => new Date(value)).nullable(),
  schedule: NoticeScheduleSchema.nullable(),
});
const CreateSchema = FieldsSchema.partial().required({ title: true, body: true }).extend({ buildingId: z.string().min(1) });
const EditSchema = FieldsSchema.partial().extend({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() });

function view(notice: typeof notices.$inferSelect, schedule: NoticeSchedule | null, now = new Date()) {
  const occurrence = nextNoticeOccurrence(schedule, now);
  return { ...notice, schedule, nextOccurrenceAt: occurrence && (!notice.expiresAt || new Date(occurrence) < notice.expiresAt) ? occurrence : null };
}
function checkDates(publishedAt: Date, expiresAt: Date | null): void {
  if (expiresAt && expiresAt <= publishedAt) throw badRequest("O encerramento deve ser posterior à publicação");
}
async function databaseNow(tx: AppTransaction) {
  const [row] = await tx.execute(sql`select statement_timestamp() as time`);
  return new Date(row!.time as string);
}

/** Prevent driver errors from logging SQL parameters containing private bodies. */
async function inNotices<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a capacidade necessária para avisos");
    if (["23503", "23514", "22007", "22008", "22023"].includes(code ?? "")) throw badRequest("Dados de aviso ou agendamento inválidos");
    if (["23505", "40001", "40P01"].includes(code ?? "")) throw conflict("O aviso foi alterado. Recarregue antes de tentar novamente.");
    if (code) throw new HttpError(500, "Não foi possível salvar ou consultar os avisos");
    throw error;
  }
}

/** Reject unauthorized callers before locking; re-read/re-authorize after waiting. */
async function lockedNotice(tx: AppTransaction, noticeId: string) {
  const [visible] = await tx.select({ id: notices.id, buildingId: notices.buildingId }).from(notices).where(eq(notices.id, noticeId)).limit(1);
  if (!visible) throw notFound("Aviso não encontrado");
  await assertNoticeManagement(tx, visible.buildingId, visible.id);
  await tx.select({ id: notices.id }).from(notices).where(eq(notices.id, noticeId)).for("update");
  // Each following statement acquires a fresh snapshot and statement clock.
  const [current] = await tx.select().from(notices).where(eq(notices.id, noticeId)).limit(1);
  if (!current) throw notFound("Aviso não encontrado");
  await assertNoticeManagement(tx, current.buildingId, current.id);
  return current;
}

noticesRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

noticesRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const { buildingId, category, includeExpired, includeUnpublished } = query<z.infer<typeof ListQuerySchema>>(req);
  const manage = includeExpired || includeUnpublished;
  const items = await inNotices(req, async tx => {
    await assertNoticeScope(tx, buildingId, manage);
    const features = await noticeFeatures(tx, buildingId);
    if (category) assertNoticeFeature(features, category);
    const now = await databaseNow(tx);
    const rows = await tx.select({ notice: notices, schedule: noticeSchedules }).from(notices)
    .leftJoin(noticeSchedules, and(eq(noticeSchedules.noticeId, notices.id), eq(noticeSchedules.buildingId, notices.buildingId)))
    .where(and(eq(notices.buildingId, buildingId), category ? eq(notices.category, category) : undefined,
      manage ? sql`app_notice_has_capability(${notices.buildingId},${notices.id}::text,'notices:manage')` : undefined,
      includeUnpublished ? undefined : sql`${notices.publishedAt} <= statement_timestamp()`,
      includeExpired ? undefined : or(isNull(notices.expiresAt), sql`${notices.expiresAt} > statement_timestamp()`)))
    .orderBy(desc(notices.pinned), desc(notices.publishedAt));
    return rows.filter(row => features[row.notice.category === "GESTAO" ? "TRANSPARENCY" : "NOTICES"].enabled).map(row => view(row.notice, row.schedule, now));
  });
  res.json({ items });
});

noticesRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const { schedule, ...input } = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  const row = await inNotices(req, async tx => {
    await assertNoticeCreation(tx, input.buildingId);
    assertNoticeFeature(await noticeFeatures(tx, input.buildingId), input.category ?? "COMMUNICATION");
    // Match the clock used by the publication RLS policy, even when the API host differs.
    const now = await databaseNow(tx);
    const publishedAt = input.publishedAt ?? now;
    checkDates(publishedAt, input.expiresAt ?? null);
    const id = randomUUID();
    await tx.insert(notices).values({ ...input, id, publishedAt, createdBy: auth.userId });
    // STABLE RLS helpers see the inserted parent in the next statement, not
    // in INSERT RETURNING. Parent/schedule/audit still share one transaction.
    const [created] = await tx.select().from(notices).where(eq(notices.id, id)).limit(1);
    if (!created) throw notFound("Aviso não encontrado");
    if (schedule) await tx.insert(noticeSchedules).values({ noticeId: id, buildingId: input.buildingId, ...schedule, startsAt: new Date(schedule.startsAt) });
    await recordAudit(tx, req, { buildingId: input.buildingId, userId: auth.userId, action: publishedAt > now ? "NOTICE_SCHEDULED" : "NOTICE_PUBLISHED", resourceType: "notice", resourceId: id, metadata: { publishedAt: publishedAt.toISOString(), schedule: schedule ?? null } });
    return view(created, schedule ?? null, now);
  });
  res.status(201).json(row);
});

noticesRouter.patch("/:noticeId", validateBody(EditSchema), async (req, res) => {
  const { schedule, expectedUpdatedAt, ...input } = req.body as z.infer<typeof EditSchema>;
  const auth = currentAuth(req);
  const id = param(req, "noticeId");
  if (!z.uuid().safeParse(id).success) throw notFound("Aviso não encontrado");
  const result = await inNotices(req, async tx => {
    const current = await lockedNotice(tx, id);
    const features = await noticeFeatures(tx, current.buildingId);
    assertNoticeFeature(features, current.category);
    if (input.category) assertNoticeFeature(features, input.category);
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) throw conflict("O aviso foi alterado. Recarregue antes de salvar.");
    checkDates(input.publishedAt ?? current.publishedAt, input.expiresAt === undefined ? current.expiresAt : input.expiresAt);
    const [updated] = await tx.update(notices).set({ ...input, updatedAt: sql`clock_timestamp()` }).where(eq(notices.id, current.id)).returning();
    if (!updated) throw notFound("Aviso não encontrado");
    if (schedule === null) await tx.delete(noticeSchedules).where(and(eq(noticeSchedules.noticeId, current.id), eq(noticeSchedules.buildingId, current.buildingId)));
    else if (schedule) await tx.insert(noticeSchedules).values({ noticeId: current.id, buildingId: current.buildingId, ...schedule, startsAt: new Date(schedule.startsAt) }).onConflictDoUpdate({ target: noticeSchedules.noticeId, set: { ...schedule, startsAt: new Date(schedule.startsAt) } });
    const [savedSchedule] = await tx.select().from(noticeSchedules).where(and(eq(noticeSchedules.noticeId, current.id), eq(noticeSchedules.buildingId, current.buildingId))).limit(1);
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "NOTICE_UPDATED", resourceType: "notice", resourceId: current.id, metadata: { fields: Object.keys(req.body) } });
    return view(updated, savedSchedule ?? null, await databaseNow(tx));
  });
  res.json(result);
});

noticesRouter.delete("/:noticeId", async (req, res) => {
  const auth = currentAuth(req);
  const id = param(req, "noticeId");
  if (!z.uuid().safeParse(id).success) throw notFound("Aviso não encontrado");
  await inNotices(req, async tx => {
    const current = await lockedNotice(tx, id);
    assertNoticeFeature(await noticeFeatures(tx, current.buildingId), current.category);
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "NOTICE_DELETED", resourceType: "notice", resourceId: current.id });
    const deleted = await tx.delete(notices).where(eq(notices.id, current.id)).returning({ id: notices.id });
    if (!deleted.length) throw notFound("Aviso não encontrado");
  });
  res.status(204).end();
});
