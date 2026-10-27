import { Router, type Request } from "express";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppTransaction } from "@predioon/db/runtime";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { isoTime } from "../../http/sql-time.js";
import { recordAudit } from "../audit/repo.js";

export const workOrdersRouter = Router();
workOrdersRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const id = z.string().uuid();
const buildingId = z.string().trim().min(1).max(128);
const Status = z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]);
const Priority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const title = z.string().trim().min(1).max(160);
const description = z.string().trim().max(4000);
const note = z.string().trim().min(1).max(2000);
const version = z.number().int().positive();
const assignee = { assignedUserId: z.string().min(1).max(128).nullable().optional(), assignedTeamId: id.nullable().optional(),
  assignedName: z.string().trim().min(1).max(160).nullable().optional() };
const oneAssignee = (value: { assignedUserId?: string | null; assignedTeamId?: string | null; assignedName?: string | null }) =>
  [value.assignedUserId, value.assignedTeamId, value.assignedName].filter(Boolean).length <= 1;
const List = z.object({ buildingId, status: Status.optional(), after: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const Create = z.object({ buildingId, title, description: description.default(""), priority: Priority.default("NORMAL"),
  dueAt: z.coerce.date().nullable().optional(), occurrenceId: id.nullable().optional(), assetId: id.nullable().optional(), ...assignee }).strict().refine(oneAssignee, "Atribua a uma pessoa ou a uma equipe");
const Update = z.object({ version, title: title.optional(), description: description.optional(), priority: Priority.optional(),
  dueAt: z.coerce.date().nullable().optional(), occurrenceId: id.nullable().optional(), assetId: id.nullable().optional(), ...assignee }).strict()
  .refine(oneAssignee, "Atribua a uma pessoa ou a uma equipe").refine(value => Object.keys(value).length > 1, "Informe ao menos um campo");
const Transition = z.object({ version, status: Status, note: note.optional() }).strict();
const Note = z.object({ note }).strict();

type WorkOrder = { id: string; buildingId: string; status: z.infer<typeof Status>; version: number; assignedUserId: string | null; assignedTeamId: string | null; assignedName: string | null };
const view = sql`w.id, w.building_id as "buildingId", w.title, w.description, w.priority, w.status, w.occurrence_id as "occurrenceId", w.asset_id as "assetId",
  (select s.name from assets s where s.id=w.asset_id) as "assetName",
  w.assigned_user_id as "assignedUserId", w.assigned_team_id as "assignedTeamId", w.assigned_name as "assignedName", ${isoTime(sql`w.due_at`)} as "dueAt", w.created_by as "createdBy", w.version,
  ${isoTime(sql`w.created_at`)} as "createdAt", ${isoTime(sql`w.updated_at`)} as "updatedAt",
  ${isoTime(sql`w.started_at`)} as "startedAt", ${isoTime(sql`w.closed_at`)} as "closedAt",
  app_work_order_assigned(w.building_id, w.assigned_user_id, w.assigned_team_id) as "assignedToMe"`;

/** RLS and the table guard decide; constraint details never reach the client. */
async function inWorkOrders<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a permissão necessária para esta ordem de serviço");
    if (code === "23503" || code === "23514") throw badRequest("Responsável, equipe, chamado ou ativo inválidos para este condomínio");
    if (code === "P0409" || code === "40001") throw conflict("A ordem de serviço foi alterada. Recarregue antes de tentar novamente.");
    if (code === "55000") throw conflict("Esta ordem de serviço já foi encerrada ou não admite essa mudança de estado.");
    throw error;
  }
}

const rows = async <T>(tx: AppTransaction, statement: SQL) => await tx.execute(statement) as unknown as T[];
function orderId(req: Request): string {
  const parsed = id.safeParse(param(req, "id"));
  if (!parsed.success) throw notFound();
  return parsed.data;
}
/** A missing order and one outside the caller's view are the same answer. */
async function visible(tx: AppTransaction, target: string): Promise<WorkOrder> {
  const [order] = await rows<WorkOrder>(tx, sql`select ${view} from work_orders w where w.id=${target}`);
  if (!order) throw notFound("Ordem de serviço não encontrada");
  return order;
}
const eventView = sql`id, actor_id as "actorId", kind, from_status as "fromStatus", to_status as "toStatus", note, ${isoTime(sql`created_at`)} as "createdAt"`;
const event = (tx: AppTransaction, order: { id: string; buildingId: string }, actor: string, kind: string, extra: { from?: string; to?: string; note?: string } = {}) =>
  tx.execute(sql`insert into work_order_events(work_order_id,building_id,actor_id,kind,from_status,to_status,note)
    values(${order.id},${order.buildingId},${actor},${kind},${extra.from ?? null},${extra.to ?? null},${extra.note ?? ""})`);

workOrdersRouter.get("/", validateQuery(List), async (req, res) => {
  const q = query<z.infer<typeof List>>(req);
  res.json(await inWorkOrders(req, async tx => {
    const [scope] = await rows<{ distribute: boolean; execute: boolean }>(tx, sql`select app_has_capability(${q.buildingId},'work-orders:assign') as distribute,
      app_has_capability(${q.buildingId},'work-orders:read-assigned') as execute`);
    if (!scope?.distribute && !scope?.execute) throw forbidden();
    const items = await rows<WorkOrder>(tx, sql`select ${view} from work_orders w where w.building_id=${q.buildingId}
      and (${q.status ?? null}::text is null or w.status=${q.status ?? null})
      and (${q.after ?? null}::uuid is null or (w.created_at,w.id) < (select c.created_at,c.id from work_orders c where c.id=${q.after ?? null}::uuid))
      order by w.created_at desc, w.id desc limit ${q.limit + 1}`);
    const page = items.slice(0, q.limit);
    return { items: page, nextCursor: items.length > q.limit ? page.at(-1)!.id : null, canDistribute: scope.distribute };
  }));
});

workOrdersRouter.post("/", validateBody(Create), async (req, res) => {
  const input = req.body as z.infer<typeof Create>;
  const actor = currentAuth(req).userId;
  const created = await inWorkOrders(req, async tx => {
    const [order] = await rows<WorkOrder>(tx, sql`insert into work_orders as w(building_id,title,description,priority,occurrence_id,asset_id,assigned_user_id,assigned_team_id,assigned_name,due_at,created_by)
      values(${input.buildingId},${input.title},${input.description},${input.priority},${input.occurrenceId ?? null},${input.assetId ?? null},${input.assignedUserId ?? null},
        ${input.assignedTeamId ?? null},${input.assignedName ?? null},${input.dueAt?.toISOString() ?? null}::timestamptz,${actor}) returning ${view}`);
    await event(tx, order!, actor, "CREATED", { note: input.assignedName ? `Responsável: ${input.assignedName}` : undefined });
    await recordAudit(tx, req, { userId: actor, buildingId: input.buildingId, action: "WORK_ORDER_CREATED", resourceType: "work_order", resourceId: order!.id });
    return order!;
  });
  res.status(201).json(created);
});

workOrdersRouter.get("/:id", async (req, res) => {
  const target = orderId(req);
  res.json(await inWorkOrders(req, async tx => {
    const order = await visible(tx, target);
    const events = await rows(tx, sql`select ${eventView}
      from work_order_events where work_order_id=${target} order by created_at, id`);
    return { ...order, events };
  }));
});

workOrdersRouter.patch("/:id", validateBody(Update), async (req, res) => {
  const target = orderId(req);
  const { version: expected, ...changes } = req.body as z.infer<typeof Update>;
  const actor = currentAuth(req).userId;
  res.json(await inWorkOrders(req, async tx => {
    const current = await visible(tx, target);
    const has = (key: keyof typeof changes) => Object.hasOwn(changes, key);
    // Choosing one kind of assignee clears the other.
    const user = has("assignedUserId") ? changes.assignedUserId ?? null : changes.assignedTeamId || changes.assignedName ? null : current.assignedUserId;
    const team = has("assignedTeamId") ? changes.assignedTeamId ?? null : changes.assignedUserId || changes.assignedName ? null : current.assignedTeamId;
    const name = has("assignedName") ? changes.assignedName ?? null : changes.assignedUserId || changes.assignedTeamId ? null : current.assignedName;
    const [updated] = await rows<WorkOrder>(tx, sql`update work_orders as w set version=w.version+1,
      title=case when ${has("title")} then ${changes.title ?? null} else w.title end,
      description=case when ${has("description")} then ${changes.description ?? null} else w.description end,
      priority=case when ${has("priority")} then ${changes.priority ?? null} else w.priority end,
      due_at=case when ${has("dueAt")} then ${changes.dueAt?.toISOString() ?? null}::timestamptz else w.due_at end,
      occurrence_id=case when ${has("occurrenceId")} then ${changes.occurrenceId ?? null}::uuid else w.occurrence_id end,
      asset_id=case when ${has("assetId")} then ${changes.assetId ?? null}::uuid else w.asset_id end,
      assigned_user_id=${user}, assigned_team_id=${team}::uuid, assigned_name=${name}
      where w.id=${target} and w.version=${expected} returning ${view}`);
    if (!updated) throw conflict("A ordem de serviço foi alterada. Recarregue antes de tentar novamente.");
    const reassigned = user !== current.assignedUserId || team !== current.assignedTeamId || name !== current.assignedName;
    await event(tx, updated, actor, reassigned ? "ASSIGNED" : "UPDATED", {
      note: reassigned && (name || current.assignedName) ? `${current.assignedName ? `Responsável anterior: ${current.assignedName}. ` : ""}${name ? `Responsável: ${name}` : user || team ? "Responsável cadastrado selecionado." : "Sem responsável."}` : undefined,
    });
    await recordAudit(tx, req, { userId: actor, buildingId: updated.buildingId, action: "WORK_ORDER_UPDATED", resourceType: "work_order", resourceId: target,
      metadata: { fields: Object.keys(changes).sort() } });
    return updated;
  }));
});

workOrdersRouter.post("/:id/status", validateBody(Transition), async (req, res) => {
  const target = orderId(req);
  const input = req.body as z.infer<typeof Transition>;
  const actor = currentAuth(req).userId;
  res.json(await inWorkOrders(req, async tx => {
    const current = await visible(tx, target);
    if (current.status === input.status) throw conflict("A ordem de serviço já está neste estado.");
    const [updated] = await rows<WorkOrder>(tx, sql`update work_orders as w set version=w.version+1, status=${input.status}
      where w.id=${target} and w.version=${input.version} returning ${view}`);
    if (!updated) throw conflict("A ordem de serviço foi alterada. Recarregue antes de tentar novamente.");
    await event(tx, updated, actor, "STATUS_CHANGED", { from: current.status, to: input.status, note: input.note });
    await recordAudit(tx, req, { userId: actor, buildingId: updated.buildingId, action: "WORK_ORDER_STATUS_CHANGED", resourceType: "work_order", resourceId: target,
      metadata: { from: current.status, to: input.status } });
    return updated;
  }));
});

workOrdersRouter.post("/:id/notes", validateBody(Note), async (req, res) => {
  const target = orderId(req);
  const actor = currentAuth(req).userId;
  const created = await inWorkOrders(req, async tx => {
    const order = await visible(tx, target);
    const [row] = await rows(tx, sql`insert into work_order_events(work_order_id,building_id,actor_id,kind,note)
      values(${order.id},${order.buildingId},${actor},'NOTE',${(req.body as z.infer<typeof Note>).note})
      returning ${eventView}`);
    return row;
  });
  res.status(201).json(created);
});
