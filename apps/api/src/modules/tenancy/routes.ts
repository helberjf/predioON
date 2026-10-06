import { Router, type Request } from "express";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { blocks, units, unitMemberships, teams, teamMembers, roleBindings, type AppTransaction } from "@predioon/db/runtime";
import { assertCapability, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { createInvitationToken } from "../../auth/invitations.js";

export const tenancyRouter = Router();
const buildingId = z.string().trim().min(1).max(128);
const id = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const ListSchema = z.object({ buildingId, after: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
// Users have text IDs; the UUID cursor used by units/teams is not interchangeable.
const PeopleListSchema = ListSchema.extend({ after: z.string().min(1).max(128).optional() });
type ListQuery = z.infer<typeof ListSchema>;
// Inactive records are a management view; the plain list stays the active structure.
const StructureListSchema = ListSchema.extend({ includeInactive: z.enum(["true", "false"]).optional() });
type StructureQuery = z.infer<typeof StructureListSchema>;
const CreateBlock = z.object({ buildingId, code: z.string().trim().min(1).max(40), name }).strict();
const CreateUnit = z.object({ buildingId, blockId: id.nullable().optional(), code: z.string().trim().min(1).max(40), floor: z.number().int().min(-10).max(300).nullable().optional() }).strict();
const CreateTeam = z.object({ buildingId, name }).strict();
const validity = { startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional() };
const validDates = (value: { startsAt?: Date | null; endsAt?: Date | null }) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt;
const CreateUnitMember = z.object({ buildingId, unitId: id, userId: z.string().min(1).max(128), kind: z.enum(["OWNER", "OCCUPANT", "DEPENDENT"]), ...validity }).strict().refine(validDates, "Vigência inválida");
const CreateTeamMember = z.object({ buildingId, teamId: id, userId: z.string().min(1).max(128), ...validity }).strict().refine(validDates, "Vigência inválida");
const CreateBinding = z.object({
  buildingId, userId: z.string().min(1).max(128).optional(), teamId: id.optional(),
  roleKey: z.enum(["BUILDING_ADMIN", "MAINTENANCE_MANAGER", "MAINTENANCE", "RESIDENT"]),
  reason: z.string().trim().min(3).max(500), ...validity,
}).strict().refine(value => Boolean(value.userId) !== Boolean(value.teamId), "Informe uma pessoa ou equipe").refine(validDates, "Vigência inválida");

const blockView = { id: blocks.id, buildingId: blocks.buildingId, code: blocks.code, name: blocks.name, active: blocks.active };
const unitView = { id: units.id, buildingId: units.buildingId, blockId: units.blockId, code: units.code, floor: units.floor, active: units.active };
const teamView = { id: teams.id, buildingId: teams.buildingId, name: teams.name, kind: teams.kind, active: teams.active };

/** Listing inactive records needs the management capability, not only the read one. */
async function listScope(tx: AppTransaction, q: StructureQuery, read: "units:read" | "teams:read", manage: "units:manage" | "teams:manage"): Promise<boolean> {
  await assertCapability(tx, read, q.buildingId);
  if (q.includeInactive !== "true") return false;
  await assertCapability(tx, manage, q.buildingId);
  return true;
}

function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}

/** RLS is enforced by the non-owner connection; constraint errors never expose foreign records. */
async function inTenancy<T>(req: Request, run: (tx: AppTransaction) => Promise<T>): Promise<T> {
  try { return await inTenantContext(req, run); }
  catch (error) {
    const code = pgErrorCode(error);
    if (code === "23503" || code === "23514") throw badRequest("Vínculo ou vigência inválidos para este condomínio");
    if (code === "23505") throw conflict("Este cadastro já existe no condomínio");
    if (code === "42501") throw forbidden();
    throw error;
  }
}

tenancyRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

tenancyRouter.get("/people", validateQuery(PeopleListSchema), async (req, res) => {
  const q = query<z.infer<typeof PeopleListSchema>>(req);
  const result = await inTenancy(req, async tx => {
    // The narrow helper authorizes memberships:manage OR teams:manage and
    // returns only current tenant-linked people. It never grants raw users access.
    const rows = await tx.execute(sql`select id, name, email from app_tenancy_people(${q.buildingId}, ${q.after ?? null}, ${q.limit})`);
    return page(rows as unknown as Array<{ id: string; name: string; email: string }>, q.limit);
  });
  res.json(result);
});

tenancyRouter.get("/blocks", validateQuery(StructureListSchema), async (req, res) => {
  const q = query<StructureQuery>(req);
  res.json(await inTenancy(req, async tx => {
    const all = await listScope(tx, q, "units:read", "units:manage");
    return page(await tx.select(blockView).from(blocks)
      .where(and(eq(blocks.buildingId, q.buildingId), all ? undefined : eq(blocks.active, true), q.after ? gt(blocks.id, q.after) : undefined)).orderBy(asc(blocks.id)).limit(q.limit + 1), q.limit);
  }));
});
tenancyRouter.post("/blocks", validateBody(CreateBlock), async (req, res) => {
  const input = req.body as z.infer<typeof CreateBlock>;
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "units:manage", input.buildingId);
    const [created] = await tx.insert(blocks).values(input).returning();
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: input.buildingId, action: "BLOCK_CREATED", resourceType: "block", resourceId: created!.id });
    return created;
  });
  res.status(201).json(row);
});

tenancyRouter.get("/units", validateQuery(StructureListSchema), async (req, res) => {
  const q = query<StructureQuery>(req);
  res.json(await inTenancy(req, async tx => {
    const all = await listScope(tx, q, "units:read", "units:manage");
    return page(await tx.select(unitView).from(units)
      .where(and(eq(units.buildingId, q.buildingId), all ? undefined : eq(units.active, true), q.after ? gt(units.id, q.after) : undefined)).orderBy(asc(units.id)).limit(q.limit + 1), q.limit);
  }));
});
tenancyRouter.post("/units", validateBody(CreateUnit), async (req, res) => {
  const input = req.body as z.infer<typeof CreateUnit>;
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "units:manage", input.buildingId);
    const [created] = await tx.insert(units).values(input).returning();
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: input.buildingId, action: "UNIT_CREATED", resourceType: "unit", resourceId: created!.id });
    return created;
  });
  res.status(201).json(row);
});

tenancyRouter.get("/teams", validateQuery(StructureListSchema), async (req, res) => {
  const q = query<StructureQuery>(req);
  res.json(await inTenancy(req, async tx => {
    const all = await listScope(tx, q, "teams:read", "teams:manage");
    return page(await tx.select(teamView).from(teams)
      .where(and(eq(teams.buildingId, q.buildingId), all ? undefined : eq(teams.active, true), q.after ? gt(teams.id, q.after) : undefined)).orderBy(asc(teams.id)).limit(q.limit + 1), q.limit);
  }));
});
tenancyRouter.post("/teams", validateBody(CreateTeam), async (req, res) => {
  const input = req.body as z.infer<typeof CreateTeam>;
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "teams:manage", input.buildingId);
    const [created] = await tx.insert(teams).values(input).returning();
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: input.buildingId, action: "TEAM_CREATED", resourceType: "team", resourceId: created!.id });
    return created;
  });
  res.status(201).json(row);
});

tenancyRouter.get("/unit-memberships", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "memberships:read", q.buildingId);
    return page(await tx.select().from(unitMemberships).where(and(eq(unitMemberships.buildingId, q.buildingId), eq(unitMemberships.active, true), q.after ? gt(unitMemberships.id, q.after) : undefined))
      .orderBy(asc(unitMemberships.id)).limit(q.limit + 1), q.limit);
  }));
});
tenancyRouter.post("/unit-memberships", validateBody(CreateUnitMember), async (req, res) => {
  const input = req.body as z.infer<typeof CreateUnitMember>;
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "memberships:manage", input.buildingId);
    const [created] = await tx.insert(unitMemberships).values(input).returning();
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: input.buildingId, action: "UNIT_MEMBERSHIP_CREATED", resourceType: "unit_membership", resourceId: created!.id });
    return created;
  });
  res.status(201).json(row);
});

tenancyRouter.get("/team-members", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "teams:read", q.buildingId);
    return page(await tx.select().from(teamMembers).where(and(eq(teamMembers.buildingId, q.buildingId), eq(teamMembers.active, true), q.after ? gt(teamMembers.id, q.after) : undefined))
      .orderBy(asc(teamMembers.id)).limit(q.limit + 1), q.limit);
  }));
});
tenancyRouter.post("/team-members", validateBody(CreateTeamMember), async (req, res) => {
  const input = req.body as z.infer<typeof CreateTeamMember>;
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "teams:manage", input.buildingId);
    // The unique member identity survives revocation. Renew only a lapsed grant;
    // concurrent attempts cannot overwrite a currently active membership.
    const [created] = await tx.insert(teamMembers).values(input).onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { active: true, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, updatedAt: new Date() },
      setWhere: and(eq(teamMembers.buildingId, input.buildingId), or(eq(teamMembers.active, false), sql`${teamMembers.endsAt} <= current_timestamp`)),
    }).returning();
    if (!created) throw conflict("Este integrante já possui vínculo ativo na equipe");
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: input.buildingId, action: "TEAM_MEMBER_ADDED", resourceType: "team_member", resourceId: created.id,
      metadata: { startsAt: created.startsAt?.toISOString() ?? null, endsAt: created.endsAt?.toISOString() ?? null } });
    return created;
  });
  res.status(201).json(row);
});

tenancyRouter.get("/role-bindings", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "memberships:manage", q.buildingId);
    return page(await tx.select().from(roleBindings).where(and(eq(roleBindings.buildingId, q.buildingId), eq(roleBindings.active, true), q.after ? gt(roleBindings.id, q.after) : undefined))
      .orderBy(asc(roleBindings.id)).limit(q.limit + 1), q.limit);
  }));
});
tenancyRouter.post("/role-bindings", validateBody(CreateBinding), async (req, res) => {
  const input = req.body as z.infer<typeof CreateBinding>;
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "memberships:manage", input.buildingId);
    const [created] = await tx.insert(roleBindings).values({ ...input, grantedBy: currentAuth(req).userId }).returning();
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: input.buildingId, action: "ROLE_BINDING_CREATED", resourceType: "role_binding", resourceId: created!.id, metadata: { roleKey: input.roleKey } });
    return created;
  });
  res.status(201).json(row);
});

// Edits never move a record to another condominium nor change its active state.
const changed = (value: object) => Object.keys(value).length > 0;
const UpdateBlock = z.object({ code: CreateBlock.shape.code.optional(), name: name.optional() }).strict().refine(changed, "Informe ao menos um campo");
const UpdateUnit = z.object({ code: CreateUnit.shape.code.optional(), blockId: id.nullable().optional(), floor: CreateUnit.shape.floor }).strict().refine(changed, "Informe ao menos um campo");
const UpdateTeam = z.object({ name: name.optional() }).strict().refine(changed, "Informe ao menos um campo");

/**
 * The first read uses the caller's own projection, so a record outside it is
 * a 404. The capability is rechecked before the write, and the audit proof
 * runs after it in the same transaction.
 */
async function edit<T>(req: Request, capability: "units:manage" | "teams:manage", action: string, resourceType: string,
  find: (tx: AppTransaction, recordId: string) => Promise<Array<{ buildingId: string }>>,
  update: (tx: AppTransaction, recordId: string) => Promise<T[]>): Promise<T> {
  const parsed = id.safeParse(param(req, "id"));
  if (!parsed.success) throw notFound();
  return inTenancy(req, async tx => {
    const [current] = await find(tx, parsed.data);
    if (!current) throw notFound();
    await assertCapability(tx, capability, current.buildingId);
    const [updated] = await update(tx, parsed.data);
    if (!updated) throw notFound();
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: current.buildingId, action, resourceType, resourceId: parsed.data,
      metadata: { fields: Object.keys(req.body as object).sort() } });
    return updated;
  });
}

tenancyRouter.patch("/blocks/:id", validateBody(UpdateBlock), async (req, res) => {
  const input = req.body as z.infer<typeof UpdateBlock>;
  const live = (recordId: string) => and(eq(blocks.id, recordId), eq(blocks.active, true));
  res.json(await edit(req, "units:manage", "BLOCK_UPDATED", "block",
    (tx, recordId) => tx.select({ buildingId: blocks.buildingId }).from(blocks).where(live(recordId)).limit(1),
    (tx, recordId) => tx.update(blocks).set({ ...input, updatedAt: new Date() }).where(live(recordId)).returning(blockView)));
});
tenancyRouter.patch("/units/:id", validateBody(UpdateUnit), async (req, res) => {
  const input = req.body as z.infer<typeof UpdateUnit>;
  const live = (recordId: string) => and(eq(units.id, recordId), eq(units.active, true));
  res.json(await edit(req, "units:manage", "UNIT_UPDATED", "unit",
    (tx, recordId) => tx.select({ buildingId: units.buildingId }).from(units).where(live(recordId)).limit(1),
    (tx, recordId) => tx.update(units).set({ ...input, updatedAt: new Date() }).where(live(recordId)).returning(unitView)));
});
tenancyRouter.patch("/teams/:id", validateBody(UpdateTeam), async (req, res) => {
  const input = req.body as z.infer<typeof UpdateTeam>;
  const live = (recordId: string) => and(eq(teams.id, recordId), eq(teams.active, true));
  res.json(await edit(req, "teams:manage", "TEAM_UPDATED", "team",
    (tx, recordId) => tx.select({ buildingId: teams.buildingId }).from(teams).where(live(recordId)).limit(1),
    (tx, recordId) => tx.update(teams).set({ ...input, updatedAt: new Date() }).where(live(recordId)).returning(teamView)));
});

// Deactivation keeps the record and its history. The RBAC helpers already
// ignore an inactive team, unit or block, so derived access ends with it and
// returns on reactivation.
const UpdateStatus = z.object({ active: z.boolean() }).strict();
type StatusRow = { buildingId: string; active: boolean };
async function setStatus<T>(req: Request, capability: "units:manage" | "teams:manage", prefix: string, resourceType: string,
  find: (tx: AppTransaction, recordId: string, lock: boolean) => Promise<StatusRow[]>,
  update: (tx: AppTransaction, recordId: string, active: boolean) => Promise<T[]>,
  read: (tx: AppTransaction, recordId: string) => Promise<T[]>): Promise<T> {
  const parsed = id.safeParse(param(req, "id"));
  if (!parsed.success) throw notFound();
  const { active } = req.body as z.infer<typeof UpdateStatus>;
  return inTenancy(req, async tx => {
    const [visible] = await find(tx, parsed.data, false);
    if (!visible) throw notFound();
    await assertCapability(tx, capability, visible.buildingId);
    const [current] = await find(tx, parsed.data, true);
    if (!current) throw notFound();
    if (current.active === active) return (await read(tx, parsed.data))[0]!;
    // Audit while the actor still has the grant: deactivating their own team may end it.
    await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: current.buildingId, action: `${prefix}_${active ? "REACTIVATED" : "DEACTIVATED"}`, resourceType, resourceId: parsed.data });
    const [updated] = await update(tx, parsed.data, active);
    if (!updated) throw notFound();
    return updated;
  });
}

tenancyRouter.patch("/blocks/:id/status", validateBody(UpdateStatus), async (req, res) => {
  res.json(await setStatus(req, "units:manage", "BLOCK", "block",
    async (tx, recordId, lock) => { const rows = tx.select({ buildingId: blocks.buildingId, active: blocks.active }).from(blocks).where(eq(blocks.id, recordId)); return lock ? rows.for("update") : rows; },
    (tx, recordId, active) => tx.update(blocks).set({ active, updatedAt: new Date() }).where(eq(blocks.id, recordId)).returning(blockView),
    (tx, recordId) => tx.select(blockView).from(blocks).where(eq(blocks.id, recordId))));
});
tenancyRouter.patch("/units/:id/status", validateBody(UpdateStatus), async (req, res) => {
  res.json(await setStatus(req, "units:manage", "UNIT", "unit",
    async (tx, recordId, lock) => { const rows = tx.select({ buildingId: units.buildingId, active: units.active }).from(units).where(eq(units.id, recordId)); return lock ? rows.for("update") : rows; },
    (tx, recordId, active) => tx.update(units).set({ active, updatedAt: new Date() }).where(eq(units.id, recordId)).returning(unitView),
    (tx, recordId) => tx.select(unitView).from(units).where(eq(units.id, recordId))));
});
tenancyRouter.patch("/teams/:id/status", validateBody(UpdateStatus), async (req, res) => {
  res.json(await setStatus(req, "teams:manage", "TEAM", "team",
    async (tx, recordId, lock) => { const rows = tx.select({ buildingId: teams.buildingId, active: teams.active }).from(teams).where(eq(teams.id, recordId)); return lock ? rows.for("update") : rows; },
    (tx, recordId, active) => tx.update(teams).set({ active, updatedAt: new Date() }).where(eq(teams.id, recordId)).returning(teamView),
    (tx, recordId) => tx.select(teamView).from(teams).where(eq(teams.id, recordId))));
});

// Resident invitations. The secret leaves the API once, in the creation
// response; the row keeps only its hash, which this role cannot read back.
const CreateInvitation = z.object({
  buildingId, name, email: z.string().trim().toLowerCase().email().max(254),
  unitId: id.optional(), kind: z.enum(["OWNER", "OCCUPANT", "DEPENDENT"]).optional(),
}).strict().refine(value => Boolean(value.unitId) === Boolean(value.kind), "Informe a unidade e o tipo de vínculo juntos");
type InvitationRow = { id: string; buildingId: string; email: string; name: string; unitId: string | null; kind: string | null; status: string; createdAt: Date; expiresAt: Date };
const invitationView = sql`id, building_id as "buildingId", email, name, unit_id as "unitId", unit_kind as "kind", created_at as "createdAt", expires_at as "expiresAt",
  case when accepted_at is not null then 'ACCEPTED' when revoked_at is not null then 'REVOKED'
    when expires_at <= clock_timestamp() then 'EXPIRED' else 'PENDING' end as status`;

tenancyRouter.get("/invitations", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "memberships:manage", q.buildingId);
    const rows = await tx.execute(sql`select ${invitationView} from invitations where building_id=${q.buildingId}
      and (${q.after ?? null}::uuid is null or id > ${q.after ?? null}::uuid) order by id limit ${q.limit + 1}`);
    return page(rows as unknown as InvitationRow[], q.limit);
  }));
});
tenancyRouter.post("/invitations", validateBody(CreateInvitation), async (req, res) => {
  const input = req.body as z.infer<typeof CreateInvitation>;
  const actor = currentAuth(req).userId;
  const { token, hash } = createInvitationToken();
  const row = await inTenancy(req, async tx => {
    await assertCapability(tx, "memberships:manage", input.buildingId);
    // A new invitation for the same address replaces the open one, expired or not.
    const replaced = await tx.execute(sql`update invitations set revoked_at=clock_timestamp(), revoked_by=${actor}
      where building_id=${input.buildingId} and email=${input.email} and accepted_at is null and revoked_at is null returning id`);
    for (const previous of replaced as unknown as Array<{ id: string }>) {
      await recordAudit(tx, req, { userId: actor, buildingId: input.buildingId, action: "INVITATION_REVOKED", resourceType: "invitation", resourceId: previous.id });
    }
    const [created] = await tx.execute(sql`insert into invitations(building_id,email,name,unit_id,unit_kind,token_hash,invited_by,expires_at)
      values(${input.buildingId},${input.email},${input.name},${input.unitId ?? null},${input.kind ?? null},${hash},${actor},clock_timestamp()+interval '7 days')
      returning ${invitationView}`) as unknown as InvitationRow[];
    await recordAudit(tx, req, { userId: actor, buildingId: input.buildingId, action: "INVITATION_CREATED", resourceType: "invitation", resourceId: created!.id });
    return created!;
  });
  res.status(201).json({ invitation: row, token });
});
tenancyRouter.delete("/invitations/:id", async (req, res) => {
  const parsed = id.safeParse(param(req, "id"));
  if (!parsed.success) throw notFound();
  const actor = currentAuth(req).userId;
  await inTenancy(req, async tx => {
    const [current] = await tx.execute(sql`select building_id as "buildingId", accepted_at is null and revoked_at is null as open from invitations where id=${parsed.data}`) as unknown as Array<{ buildingId: string; open: boolean }>;
    if (!current) throw notFound();
    await assertCapability(tx, "memberships:manage", current.buildingId);
    if (!current.open) return;
    const revoked = await tx.execute(sql`update invitations set revoked_at=clock_timestamp(), revoked_by=${actor}
      where id=${parsed.data} and accepted_at is null and revoked_at is null returning id`);
    // Accepted in the meantime: nothing was revoked, so nothing is audited.
    if (revoked.length) await recordAudit(tx, req, { userId: actor, buildingId: current.buildingId, action: "INVITATION_REVOKED", resourceType: "invitation", resourceId: parsed.data });
  });
  res.status(204).end();
});

// Grants are revoked rather than deleted so their audit references remain useful.
for (const [path, table, capability, action] of [
  ["unit-memberships", unitMemberships, "memberships:manage", "UNIT_MEMBERSHIP_REVOKED"],
  ["team-members", teamMembers, "teams:manage", "TEAM_MEMBER_REVOKED"],
  ["role-bindings", roleBindings, "memberships:manage", "ROLE_BINDING_REVOKED"],
] as const) {
  tenancyRouter.delete(`/${path}/:id`, async (req, res) => {
    const parsed = id.safeParse(param(req, "id"));
    if (!parsed.success) throw notFound();
    await inTenancy(req, async tx => {
      const [current] = await tx.select({ id: table.id, buildingId: table.buildingId, active: table.active }).from(table).where(eq(table.id, parsed.data)).for("update");
      if (!current?.buildingId) throw notFound();
      await assertCapability(tx, capability, current.buildingId);
      if (!current.active) return;
      // Audit while the actor still has the grant, including self-revocation.
      // Both statements roll back together if the update is rejected.
      await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId: current.buildingId, action, resourceType: path, resourceId: current.id });
      await tx.update(table).set({ active: false, updatedAt: new Date() }).where(eq(table.id, current.id));
    });
    res.status(204).end();
  });
}
