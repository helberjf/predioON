import { assertFeature, filterFeatureRows } from "../../auth/features.js";
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { occurrenceEvents, occurrences, type AppTransaction } from "@predioon/db";
import { duplicateTopic, TicketCreateSchema, TicketPrioritySchema } from "@predioon/shared";
import { assertBuildingAccess, buildingRole, currentAuth, inTenantContext, scopedBuildingIds } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound } from "../../http/errors.js";
import { PaginationSchema } from "../../http/pagination.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const occurrencesRouter = Router();
const OPEN_STATUSES = ["OPEN", "IN_ANALYSIS", "IN_PROGRESS"] as const;
const Status = z.enum(["OPEN", "IN_ANALYSIS", "IN_PROGRESS", "DONE", "CANCELLED"]);
const List = PaginationSchema.extend({ buildingId: z.string().optional(), status: Status.optional(), onlyOpen: z.enum(["true", "false"]).default("false").transform(v => v === "true") });
const Update = z.object({ status: Status.optional(), priority: TicketPrioritySchema.optional(), priorityReason: z.string().trim().min(3).max(1000).optional(), assignedTo: z.string().min(1).nullable().optional(), applyToGroup: z.boolean().default(false) }).strict()
  .refine(v => v.priority === undefined || v.priorityReason !== undefined, "Explique a alteração de gravidade")
  .refine(v => v.status !== undefined || v.priority !== undefined || v.assignedTo !== undefined, "Informe o que será alterado");
const Comment = z.object({ message: z.string().trim().min(1).max(2000), applyToGroup: z.boolean().default(false) }).strict();
const Group = z.object({ buildingId: z.string().min(1), occurrenceIds: z.array(z.string().uuid()).min(2).max(50).refine(ids => new Set(ids).size === ids.length, "Selecione chamados diferentes") }).strict();
function occurrenceId(req: Request) {
  const result = z.string().uuid().safeParse(param(req, "occurrenceId"));
  if (!result.success) throw badRequest("Identificador de chamado inválido"); return result.data;
}
async function lockBuilding(tx: AppTransaction, buildingId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`occurrences:${buildingId}`}, 0))`);
}
async function editable(tx: AppTransaction, id: string) {
  const [first] = await tx.select().from(occurrences).where(eq(occurrences.id, id)).limit(1);
  if (!first) throw notFound("Chamado não encontrado");
  await lockBuilding(tx, first.buildingId);
  const [current] = await tx.select().from(occurrences).where(eq(occurrences.id, id)).limit(1).for("update");
  if (!current) throw notFound("Chamado não encontrado"); return current;
}

occurrencesRouter.get("/", validateQuery(List), async (req, res) => {
  const auth = currentAuth(req), { buildingId, status, onlyOpen, limit, offset } = query<z.infer<typeof List>>(req);
  if (buildingId) assertBuildingAccess(auth, buildingId);
  const scope = scopedBuildingIds(auth);
  const rows = await inTenantContext(req, async tx => {
    if (buildingId) await assertFeature(tx, buildingId, "TICKETS");
    const candidates = await tx.select().from(occurrences).where(and(
    buildingId ? eq(occurrences.buildingId, buildingId) : undefined,
    scope && !buildingId ? inArray(occurrences.buildingId, scope.length ? scope : [""]) : undefined,
    status ? eq(occurrences.status, status) : undefined, onlyOpen ? inArray(occurrences.status, [...OPEN_STATUSES]) : undefined,
  )).orderBy(sql`case when ${occurrences.priority} in ('HIGH', 'URGENT') then 0 when ${occurrences.priority} = 'NORMAL' then 1 else 2 end`, desc(occurrences.createdAt));
    return (await filterFeatureRows(tx, candidates, () => ["TICKETS"])).slice(offset, offset + limit);
  });
  res.json({ items: rows, limit, offset });
});
occurrencesRouter.get("/duplicates", validateQuery(z.object({ buildingId: z.string().min(1) })), async (req, res) => {
  const { buildingId } = query<{ buildingId: string }>(req);
  const items = await inTenantContext(req, async tx => {
    await assertFeature(tx, buildingId, "TICKET_GROUPING", true);
    const rows = await tx.select().from(occurrences).where(and(eq(occurrences.buildingId, buildingId), inArray(occurrences.status, [...OPEN_STATUSES]), isNull(occurrences.groupId))).orderBy(desc(occurrences.createdAt)).limit(1000);
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) { const key = duplicateTopic(row.category, row.title, row.location); grouped.set(key, [...(grouped.get(key) ?? []), row]); }
    return [...grouped.values()].filter(rows => rows.length >= 3).map(rows => ({ title: rows[0]!.title, location: rows[0]!.location, count: rows.length, occurrenceIds: rows.slice(0, 50).map(row => row.id) }));
  });
  res.json({ items });
});
occurrencesRouter.post("/group", validateBody(Group), async (req, res) => {
  const { buildingId, occurrenceIds } = req.body as z.infer<typeof Group>, auth = currentAuth(req);
  const result = await inTenantContext(req, async tx => {
    await assertFeature(tx, buildingId, "TICKET_GROUPING", true); await lockBuilding(tx, buildingId);
    const rows = await tx.select().from(occurrences).where(and(eq(occurrences.buildingId, buildingId), inArray(occurrences.id, occurrenceIds))).for("update");
    if (rows.length !== occurrenceIds.length) throw notFound("Um dos chamados não pertence a este condomínio");
    if (rows.some(row => row.groupId || !OPEN_STATUSES.includes(row.status as typeof OPEN_STATUSES[number]))) throw conflict("Selecione apenas chamados abertos e ainda não agrupados");
    const groupId = randomUUID();
    await tx.update(occurrences).set({ groupId, updatedAt: sql`clock_timestamp()` }).where(inArray(occurrences.id, occurrenceIds));
    await tx.insert(occurrenceEvents).values(rows.map(row => ({ occurrenceId: row.id, buildingId, authorId: auth.userId, kind: "GROUPED", message: "A administração vinculou este chamado a um atendimento conjunto do mesmo problema." })));
    await recordAudit(tx, req, { buildingId, userId: auth.userId, action: "OCCURRENCES_GROUPED", resourceType: "occurrence_group", resourceId: groupId, metadata: { occurrenceIds } });
    return { groupId, count: rows.length };
  });
  res.status(201).json(result);
});
occurrencesRouter.get("/:occurrenceId", async (req, res) => {
  const id = occurrenceId(req);
  const payload = await inTenantContext(req, async tx => {
    const [row] = await tx.select().from(occurrences).where(eq(occurrences.id, id)).limit(1);
    if (!row) throw notFound("Chamado não encontrado");
    await assertFeature(tx, row.buildingId, "TICKETS");
    const timeline = await tx.select().from(occurrenceEvents).where(eq(occurrenceEvents.occurrenceId, id)).orderBy(occurrenceEvents.createdAt, occurrenceEvents.id);
    return { ...row, timeline };
  });
  res.json(payload);
});
occurrencesRouter.post("/", validateBody(TicketCreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof TicketCreateSchema>, auth = currentAuth(req);
  const row = await inTenantContext(req, async tx => {
    const features = await assertFeature(tx, input.buildingId, "TICKETS");
    const [{ protocol }] = (await tx.execute(sql`select next_occurrence_protocol() as protocol`)) as unknown as Array<{ protocol: string }>;
    const [created] = await tx.insert(occurrences).values({ ...input, priority: features.TICKET_PRIORITY.enabled ? input.priority : "NORMAL", protocol, openedBy: auth.userId }).returning();
    await tx.insert(occurrenceEvents).values({ occurrenceId: created!.id, buildingId: input.buildingId, authorId: auth.userId, kind: "CREATED", message: input.title });
    return created!;
  });
  res.status(201).json(row);
});
occurrencesRouter.patch("/:occurrenceId", validateBody(Update), async (req, res) => {
  const id = occurrenceId(req), auth = currentAuth(req), input = req.body as z.infer<typeof Update>;
  const row = await inTenantContext(req, async tx => {
    const current = await editable(tx, id);
    const role = buildingRole(auth, current.buildingId), isAdmin = role === "BUILDING_ADMIN" || role === "PLATFORM_ADMIN";
    const residentCancelling = input.status === "CANCELLED" && current.openedBy === auth.userId && input.assignedTo === undefined && input.priority === undefined && input.priorityReason === undefined && !input.applyToGroup;
    if (!isAdmin && !residentCancelling) throw forbidden("Apenas a administração pode alterar este chamado");
    if (!isAdmin && !OPEN_STATUSES.includes(current.status as typeof OPEN_STATUSES[number])) throw conflict("Este chamado já foi encerrado. Envie uma mensagem ou abra um novo pedido.");
    await assertFeature(tx, current.buildingId, "TICKETS", isAdmin);
    if (input.priority !== undefined) await assertFeature(tx, current.buildingId, "TICKET_PRIORITY", true);
    if (input.applyToGroup) await assertFeature(tx, current.buildingId, "TICKET_GROUPING", true);
    if (input.assignedTo) {
      const target = await tx.execute(sql`select u.id from users u join memberships m on m.user_id = u.id where u.id = ${input.assignedTo} and u.active and m.building_id = ${current.buildingId} and m.active and (m.starts_at is null or m.starts_at <= now()) and (m.ends_at is null or m.ends_at > now())`);
      if (!target.length) throw badRequest("Responsável sem vínculo ativo com o condomínio");
    }
    const targets = input.applyToGroup && current.groupId ? await tx.select().from(occurrences).where(and(eq(occurrences.buildingId, current.buildingId), eq(occurrences.groupId, current.groupId))).for("update") : [current];
    for (const target of targets) {
      // Closed tickets stay preserved when a group of still-active tickets is updated.
      if (target.id !== id && !OPEN_STATUSES.includes(target.status as typeof OPEN_STATUSES[number])) continue;
      const closing = input.status === "DONE" || input.status === "CANCELLED";
      await tx.update(occurrences).set({
        ...(input.status ? { status: input.status, closedAt: closing ? target.closedAt ?? sql`clock_timestamp()` : null } : {}),
        ...(input.priority ? { priority: input.priority } : {}), ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}), updatedAt: sql`clock_timestamp()`,
      }).where(eq(occurrences.id, target.id));
      const base = { occurrenceId: target.id, buildingId: target.buildingId, authorId: auth.userId };
      if (input.status && input.status !== target.status) await tx.insert(occurrenceEvents).values({ ...base, kind: "STATUS_CHANGED", message: `${target.status} → ${input.status}` });
      if (input.priority && input.priority !== target.priority) await tx.insert(occurrenceEvents).values({ ...base, kind: "PRIORITY_CHANGED", message: input.priorityReason!, metadata: { from: target.priority, to: input.priority } });
      await recordAudit(tx, req, { buildingId: target.buildingId, userId: auth.userId, action: "OCCURRENCE_UPDATED", resourceType: "occurrence", resourceId: target.id, metadata: input });
    }
    const [updated] = await tx.select().from(occurrences).where(eq(occurrences.id, id)); return updated!;
  });
  res.json(row);
});
occurrencesRouter.post("/:occurrenceId/comments", validateBody(Comment), async (req, res) => {
  const id = occurrenceId(req), auth = currentAuth(req), { message, applyToGroup } = req.body as z.infer<typeof Comment>;
  const row = await inTenantContext(req, async tx => {
    const current = await editable(tx, id);
    await assertFeature(tx, current.buildingId, "TICKETS", applyToGroup);
    if (applyToGroup) await assertFeature(tx, current.buildingId, "TICKET_GROUPING", true);
    const targets = applyToGroup && current.groupId ? await tx.select().from(occurrences).where(and(eq(occurrences.buildingId, current.buildingId), eq(occurrences.groupId, current.groupId))) : [current];
    const inserted = await tx.insert(occurrenceEvents).values(targets.map(target => ({ occurrenceId: target.id, buildingId: target.buildingId, authorId: auth.userId, kind: "COMMENT", message }))).returning();
    await tx.update(occurrences).set({ updatedAt: sql`clock_timestamp()` }).where(inArray(occurrences.id, targets.map(t => t.id)));
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "OCCURRENCE_COMMENTED", resourceType: "occurrence", resourceId: id, metadata: { applyToGroup, count: targets.length } });
    return inserted.find(event => event.occurrenceId === id)!;
  });
  res.status(201).json(row);
});
