import { Router, type Request } from "express";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { readFeatures, type AppTransaction } from "@predioon/db/runtime";
import type { Capability } from "@predioon/shared";
import { assertCapability, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { featureDisabled } from "../../auth/features.js";
import { badRequest, conflict, forbidden, HttpError, notFound, pgConstraintName, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { isoTime } from "../../http/sql-time.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

/**
 * Condominium events (infrastructure/059). They follow the reservations
 * switch: an event may take a common area, and then the area is busy for
 * reservations during it. Residents answer "vou"/"não vou" with companions.
 */
export const buildingEventsRouter = Router();
buildingEventsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const id = z.string().uuid();
const buildingId = z.string().trim().min(1).max(128);
const fields = {
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000),
  location: z.string().trim().max(160),
  areaId: id.nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  rsvpUntil: z.coerce.date().nullable(),
  capacity: z.number().int().min(1).max(10000).nullable(),
  maxGuests: z.number().int().min(0).max(20),
};
const List = z.object({ buildingId, from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const Create = z.object({
  buildingId, title: fields.title, description: fields.description.default(""), location: fields.location.default(""),
  areaId: fields.areaId.default(null), startsAt: fields.startsAt, endsAt: fields.endsAt, rsvpUntil: fields.rsvpUntil.default(null),
  capacity: fields.capacity.default(null), maxGuests: fields.maxGuests.default(0),
}).strict();
const Update = z.object({
  version: z.number().int().positive(), title: fields.title.optional(), description: fields.description.optional(),
  location: fields.location.optional(), areaId: fields.areaId.optional(), startsAt: fields.startsAt.optional(),
  endsAt: fields.endsAt.optional(), rsvpUntil: fields.rsvpUntil.optional(), capacity: fields.capacity.optional(),
  maxGuests: fields.maxGuests.optional(),
}).strict().refine(value => Object.keys(value).length > 1, "Informe ao menos um campo");
const Cancel = z.object({ version: z.number().int().positive() }).strict();
const Answer = z.object({ attending: z.boolean(), guests: z.number().int().min(0).max(20).default(0) }).strict();

type EventRow = {
  id: string; buildingId: string; title: string; description: string; location: string; areaId: string | null; areaName: string | null;
  startsAt: string; endsAt: string; rsvpUntil: string | null; capacity: number | null; maxGuests: number; status: "SCHEDULED" | "CANCELLED";
  version: number; answersOpen: boolean; attendingResponses: number; attendingPeople: number; declinedResponses: number;
  myAttending: boolean | null; myGuests: number | null;
};

function refusal(constraint: string | undefined, maxGuests?: number): HttpError | null {
  switch (constraint) {
    case "building_events_reservation_overlap": return conflict("Já há reservas nesta área neste horário. Cancele-as no calendário ou escolha outro horário.");
    case "building_events_event_overlap": return conflict("Já há outro evento nesta área neste horário.");
    case "building_events_area": return badRequest("Escolha uma área comum ativa deste condomínio.");
    case "building_events_future_start": return badRequest("O evento precisa começar no futuro.");
    case "building_event_responses_cancelled": return conflict("Este evento foi cancelado.");
    case "building_event_responses_closed": return conflict("As confirmações deste evento já foram encerradas.");
    case "building_event_responses_max_guests": return badRequest(maxGuests ? `Este evento aceita até ${maxGuests} acompanhante${maxGuests === 1 ? "" : "s"} por morador.` : "Este evento não aceita acompanhantes.");
    case "building_event_responses_capacity": return conflict("Não há mais vagas para este evento.");
    default: return null;
  }
}

async function inEvents<T>(req: Request, run: (tx: AppTransaction) => Promise<T>, context: { maxGuests?: number } = {}): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const known = refusal(pgConstraintName(error), context.maxGuests);
    if (known) throw known;
    const code = pgErrorCode(error);
    if (code === "42501") throw forbidden("Sem a capacidade necessária para eventos");
    if (code === "P0409" || code === "40001" || code === "40P01") throw conflict("O evento foi alterado. Recarregue antes de tentar novamente.");
    if (code === "55000") throw conflict("Este evento já foi cancelado.");
    if (["23503", "23514", "22007", "22008", "22023"].includes(code ?? "")) throw badRequest("Dados do evento inválidos");
    throw error;
  }
}
const rows = async <T>(tx: AppTransaction, statement: SQL) => await tx.execute(statement) as unknown as T[];

async function allowed(tx: AppTransaction, buildingId: string, capability: Capability): Promise<boolean> {
  const [row] = await rows<{ allowed: boolean }>(tx, sql`select app_has_capability(${buildingId},${capability}) as allowed`);
  return row?.allowed === true;
}
async function assertReservationsOn(tx: AppTransaction, buildingId: string) {
  if (!(await readFeatures(tx, buildingId)).RESERVATIONS.enabled) throw featureDisabled("RESERVATIONS");
}
async function assertReader(tx: AppTransaction, buildingId: string) {
  if (!(await allowed(tx, buildingId, "events:read")) && !(await allowed(tx, buildingId, "events:manage"))) throw forbidden("Sem a capacidade necessária para eventos");
  await assertReservationsOn(tx, buildingId);
}
async function assertManager(tx: AppTransaction, buildingId: string) {
  await assertCapability(tx, "events:manage", buildingId);
  await assertReservationsOn(tx, buildingId);
}

function view(buildingId: string, userId: string, where: SQL): SQL {
  return sql`select e.id, e.building_id as "buildingId", e.title, e.description, e.location, e.area_id as "areaId", a.name as "areaName",
      ${isoTime(sql`e.starts_at`)} as "startsAt", ${isoTime(sql`e.ends_at`)} as "endsAt", ${isoTime(sql`e.rsvp_until`)} as "rsvpUntil",
      e.capacity, e.max_guests as "maxGuests", e.status, e.version,
      (e.status='SCHEDULED' and clock_timestamp() < coalesce(e.rsvp_until, e.starts_at)) as "answersOpen",
      coalesce(t.attending_responses,0) as "attendingResponses", coalesce(t.attending_people,0) as "attendingPeople",
      coalesce(t.declined_responses,0) as "declinedResponses", r.attending as "myAttending", r.guests as "myGuests"
    from building_events e
    left join common_areas a on a.id=e.area_id and a.building_id=e.building_id
    left join app_building_event_totals(${buildingId}) t on t.event_id=e.id
    left join building_event_responses r on r.event_id=e.id and r.user_id=${userId}
    where e.building_id=${buildingId} and ${where}`;
}
function dto(row: EventRow) {
  const { myAttending, myGuests, ...event } = row;
  return { ...event, myResponse: myAttending === null ? null : { attending: myAttending, guests: myGuests ?? 0 } };
}
function eventId(req: Request): string {
  const parsed = id.safeParse(param(req, "eventId"));
  if (!parsed.success) throw notFound("Evento não encontrado");
  return parsed.data;
}
async function visible(tx: AppTransaction, target: string, userId: string): Promise<EventRow> {
  const [owner] = await rows<{ buildingId: string }>(tx, sql`select building_id as "buildingId" from building_events where id=${target}`);
  if (!owner) throw notFound("Evento não encontrado");
  const [event] = await rows<EventRow>(tx, view(owner.buildingId, userId, sql`e.id=${target}`));
  if (!event) throw notFound("Evento não encontrado");
  return event;
}

type Period = { startsAt: Date; endsAt: Date; rsvpUntil: Date | null };
function assertPeriod({ startsAt, endsAt, rsvpUntil }: Period) {
  if (endsAt <= startsAt) throw badRequest("O término precisa ser depois do início.");
  if (endsAt.getTime() - startsAt.getTime() > 7 * 86_400_000) throw badRequest("Um evento dura no máximo 7 dias.");
  if (rsvpUntil && rsvpUntil > startsAt) throw badRequest("O prazo de confirmação precisa terminar até o início do evento.");
}
async function assertArea(tx: AppTransaction, buildingId: string, areaId: string | null) {
  if (!areaId) return;
  const [area] = await rows<{ id: string }>(tx, sql`select id from common_areas where id=${areaId}::uuid and building_id=${buildingId} and active`);
  if (!area) throw badRequest("Escolha uma área comum ativa deste condomínio.");
}

buildingEventsRouter.get("/", validateQuery(List), async (req, res) => {
  const q = query<z.infer<typeof List>>(req);
  const auth = currentAuth(req);
  const items = await inEvents(req, async tx => {
    await assertReader(tx, q.buildingId);
    // Without a period: what is still ahead, including today's events already under way.
    const from = q.from ?? new Date(Date.now() - 86_400_000);
    const list = await rows<EventRow>(tx, sql`${view(q.buildingId, auth.userId, sql`e.ends_at >= ${from.toISOString()}::timestamptz
      and (${q.to?.toISOString() ?? null}::timestamptz is null or e.starts_at < ${q.to?.toISOString() ?? null}::timestamptz)`)}
      order by e.starts_at, e.id limit 100`);
    return list.map(dto);
  });
  res.json({ items });
});

buildingEventsRouter.post("/", validateBody(Create), async (req, res) => {
  const input = req.body as z.infer<typeof Create>;
  const actor = currentAuth(req).userId;
  assertPeriod(input);
  if (input.startsAt.getTime() <= Date.now()) throw badRequest("O evento precisa começar no futuro.");
  const created = await inEvents(req, async tx => {
    await assertManager(tx, input.buildingId);
    await assertArea(tx, input.buildingId, input.areaId);
    const [row] = await rows<{ id: string }>(tx, sql`insert into building_events(building_id,title,description,location,area_id,starts_at,ends_at,rsvp_until,capacity,max_guests,created_by)
      values(${input.buildingId},${input.title},${input.description},${input.location},${input.areaId}::uuid,${input.startsAt.toISOString()}::timestamptz,
        ${input.endsAt.toISOString()}::timestamptz,${input.rsvpUntil?.toISOString() ?? null}::timestamptz,${input.capacity}::integer,${input.maxGuests},${actor})
      returning id`);
    await recordAudit(tx, req, { userId: actor, buildingId: input.buildingId, action: "EVENT_CREATED", resourceType: "event", resourceId: row!.id });
    return dto(await visible(tx, row!.id, actor));
  });
  res.status(201).json(created);
});

buildingEventsRouter.patch("/:eventId", validateBody(Update), async (req, res) => {
  const target = eventId(req);
  const { version: expected, ...changes } = req.body as z.infer<typeof Update>;
  const actor = currentAuth(req).userId;
  res.json(await inEvents(req, async tx => {
    const current = await visible(tx, target, actor);
    await assertManager(tx, current.buildingId);
    const has = (key: keyof typeof changes) => Object.hasOwn(changes, key);
    assertPeriod({
      startsAt: changes.startsAt ?? new Date(current.startsAt), endsAt: changes.endsAt ?? new Date(current.endsAt),
      rsvpUntil: has("rsvpUntil") ? changes.rsvpUntil ?? null : current.rsvpUntil ? new Date(current.rsvpUntil) : null,
    });
    if (has("areaId")) await assertArea(tx, current.buildingId, changes.areaId ?? null);
    const [updated] = await rows<{ id: string }>(tx, sql`update building_events as e set version=e.version+1,
      title=case when ${has("title")} then ${changes.title ?? null} else e.title end,
      description=case when ${has("description")} then ${changes.description ?? null} else e.description end,
      location=case when ${has("location")} then ${changes.location ?? null} else e.location end,
      area_id=case when ${has("areaId")} then ${changes.areaId ?? null}::uuid else e.area_id end,
      starts_at=case when ${has("startsAt")} then ${changes.startsAt?.toISOString() ?? null}::timestamptz else e.starts_at end,
      ends_at=case when ${has("endsAt")} then ${changes.endsAt?.toISOString() ?? null}::timestamptz else e.ends_at end,
      rsvp_until=case when ${has("rsvpUntil")} then ${changes.rsvpUntil?.toISOString() ?? null}::timestamptz else e.rsvp_until end,
      capacity=case when ${has("capacity")} then ${changes.capacity ?? null}::integer else e.capacity end,
      max_guests=case when ${has("maxGuests")} then ${changes.maxGuests ?? null}::integer else e.max_guests end
      where e.id=${target} and e.version=${expected} and e.status='SCHEDULED' returning e.id`);
    if (!updated) throw conflict(current.status === "CANCELLED" ? "Este evento já foi cancelado." : "O evento foi alterado. Recarregue antes de tentar novamente.");
    await recordAudit(tx, req, { userId: actor, buildingId: current.buildingId, action: "EVENT_UPDATED", resourceType: "event", resourceId: target,
      metadata: { fields: Object.keys(changes).sort() } });
    return dto(await visible(tx, target, actor));
  }));
});

buildingEventsRouter.post("/:eventId/cancel", validateBody(Cancel), async (req, res) => {
  const target = eventId(req);
  const { version: expected } = req.body as z.infer<typeof Cancel>;
  const actor = currentAuth(req).userId;
  res.json(await inEvents(req, async tx => {
    const current = await visible(tx, target, actor);
    await assertManager(tx, current.buildingId);
    if (current.status === "CANCELLED") throw conflict("Este evento já foi cancelado.");
    const [updated] = await rows<{ id: string }>(tx, sql`update building_events as e set version=e.version+1, status='CANCELLED'
      where e.id=${target} and e.version=${expected} and e.status='SCHEDULED' returning e.id`);
    if (!updated) throw conflict("O evento foi alterado. Recarregue antes de tentar novamente.");
    await recordAudit(tx, req, { userId: actor, buildingId: current.buildingId, action: "EVENT_CANCELLED", resourceType: "event", resourceId: target });
    return dto(await visible(tx, target, actor));
  }));
});

/** Every answer, for the administration: who, which apartment, and how many companions. */
buildingEventsRouter.get("/:eventId/responses", async (req, res) => {
  const target = eventId(req);
  const actor = currentAuth(req).userId;
  res.json(await inEvents(req, async tx => {
    const current = await visible(tx, target, actor);
    await assertManager(tx, current.buildingId);
    const items = await rows(tx, sql`select * from (select r.user_id as "userId", app_building_person_name(r.building_id, r.user_id) as name,
        r.unit_label as "unit", r.attending, r.guests, ${isoTime(sql`r.updated_at`)} as "updatedAt"
      from building_event_responses r where r.event_id=${target} and r.building_id=${current.buildingId}) answers
      order by attending desc, name nulls last, "userId"`);
    return { items };
  }));
});

/** The caller's own answer. Changing it is allowed while answers are open. */
buildingEventsRouter.put("/:eventId/response", validateBody(Answer), async (req, res) => {
  const target = eventId(req);
  const { attending, guests } = req.body as z.infer<typeof Answer>;
  const actor = currentAuth(req).userId;
  const context: { maxGuests?: number } = {};
  res.json(await inEvents(req, async tx => {
    const current = await visible(tx, target, actor);
    context.maxGuests = current.maxGuests;
    await assertCapability(tx, "events:respond-own", current.buildingId);
    await assertReservationsOn(tx, current.buildingId);
    await tx.execute(sql`insert into building_event_responses(event_id,building_id,user_id,attending,guests)
      values(${target}::uuid,${current.buildingId},${actor},${attending},${attending ? guests : 0})
      on conflict (event_id,user_id) do update set attending=excluded.attending, guests=excluded.guests`);
    return dto(await visible(tx, target, actor));
  }, context));
});
