import { assertFeature, buildingFeatures } from "../../auth/features.js";
import { Router } from "express";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { notices, noticeSchedules, type AppTransaction } from "@predioon/db";
import { nextNoticeOccurrence, NoticeScheduleSchema, type NoticeSchedule } from "@predioon/shared";
import { assertBuildingAccess, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

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
  const [row] = await tx.execute(sql`select now() as time`);
  return new Date(row!.time as string);
}

noticesRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const { buildingId, category, includeExpired, includeUnpublished } = query<z.infer<typeof ListQuerySchema>>(req);
  const auth = currentAuth(req);
  assertBuildingAccess(auth, buildingId, includeExpired || includeUnpublished ? "BUILDING_ADMIN" : "RESIDENT");
  const items = await inTenantContext(req, async tx => {
    const features = await buildingFeatures(tx, buildingId, includeExpired || includeUnpublished);
    if (category) await assertFeature(tx, buildingId, category === "GESTAO" ? "TRANSPARENCY" : "NOTICES", includeExpired || includeUnpublished);
    const now = await databaseNow(tx);
    const rows = await tx.select({ notice: notices, schedule: noticeSchedules }).from(notices)
    .leftJoin(noticeSchedules, eq(noticeSchedules.noticeId, notices.id))
    .where(and(eq(notices.buildingId, buildingId), category ? eq(notices.category, category) : undefined, includeUnpublished ? undefined : lte(notices.publishedAt, now), includeExpired ? undefined : or(isNull(notices.expiresAt), gt(notices.expiresAt, now))))
    .orderBy(desc(notices.pinned), desc(notices.publishedAt));
    return rows.filter(row => features[row.notice.category === "GESTAO" ? "TRANSPARENCY" : "NOTICES"].enabled).map(row => view(row.notice, row.schedule, now));
  });
  res.json({ items });
});

noticesRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const { schedule, ...input } = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");
  const row = await inTenantContext(req, async tx => {
    await assertFeature(tx, input.buildingId, input.category === "GESTAO" ? "TRANSPARENCY" : "NOTICES", true);
    // Match the clock used by the publication RLS policy, even when the API host differs.
    const now = await databaseNow(tx);
    const publishedAt = input.publishedAt ?? now;
    checkDates(publishedAt, input.expiresAt ?? null);
    const [created] = await tx.insert(notices).values({ ...input, publishedAt, createdBy: auth.userId }).returning();
    if (schedule) await tx.insert(noticeSchedules).values({ noticeId: created!.id, buildingId: input.buildingId, ...schedule, startsAt: new Date(schedule.startsAt) });
    await recordAudit(tx, req, { buildingId: input.buildingId, userId: auth.userId, action: publishedAt > now ? "NOTICE_SCHEDULED" : "NOTICE_PUBLISHED", resourceType: "notice", resourceId: created!.id, metadata: { publishedAt: publishedAt.toISOString(), schedule: schedule ?? null } });
    return view(created!, schedule ?? null, now);
  });
  res.status(201).json(row);
});

noticesRouter.patch("/:noticeId", validateBody(EditSchema), async (req, res) => {
  const { schedule, expectedUpdatedAt, ...input } = req.body as z.infer<typeof EditSchema>;
  const auth = currentAuth(req);
  const result = await inTenantContext(req, async tx => {
    const [current] = await tx.select().from(notices).where(eq(notices.id, param(req, "noticeId"))).limit(1).for("update");
    if (!current) throw notFound("Aviso não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, current.category === "GESTAO" ? "TRANSPARENCY" : "NOTICES", true);
    if (input.category) await assertFeature(tx, current.buildingId, input.category === "GESTAO" ? "TRANSPARENCY" : "NOTICES", true);
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) throw conflict("O aviso foi alterado. Recarregue antes de salvar.");
    checkDates(input.publishedAt ?? current.publishedAt, input.expiresAt === undefined ? current.expiresAt : input.expiresAt);
    const [updated] = await tx.update(notices).set({ ...input, updatedAt: sql`clock_timestamp()` }).where(eq(notices.id, current.id)).returning();
    if (schedule === null) await tx.delete(noticeSchedules).where(eq(noticeSchedules.noticeId, current.id));
    else if (schedule) await tx.insert(noticeSchedules).values({ noticeId: current.id, buildingId: current.buildingId, ...schedule, startsAt: new Date(schedule.startsAt) }).onConflictDoUpdate({ target: noticeSchedules.noticeId, set: { ...schedule, startsAt: new Date(schedule.startsAt) } });
    const [savedSchedule] = await tx.select().from(noticeSchedules).where(eq(noticeSchedules.noticeId, current.id)).limit(1);
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "NOTICE_UPDATED", resourceType: "notice", resourceId: current.id, metadata: { fields: Object.keys(req.body) } });
    return view(updated!, savedSchedule ?? null, await databaseNow(tx));
  });
  res.json(result);
});

noticesRouter.delete("/:noticeId", async (req, res) => {
  const auth = currentAuth(req);
  await inTenantContext(req, async tx => {
    const [current] = await tx.select().from(notices).where(eq(notices.id, param(req, "noticeId"))).limit(1).for("update");
    if (!current) throw notFound("Aviso não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, current.category === "GESTAO" ? "TRANSPARENCY" : "NOTICES", true);
    await tx.delete(notices).where(eq(notices.id, current.id));
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "NOTICE_DELETED", resourceType: "notice", resourceId: current.id });
  });
  res.status(204).end();
});
