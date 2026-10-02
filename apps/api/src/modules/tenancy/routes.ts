import { Router, type Request } from "express";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { blocks, units, unitMemberships, teams, teamMembers, roleBindings, type AppTransaction } from "@predioon/db/runtime";
import { assertCapability, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const tenancyRouter = Router();
const buildingId = z.string().trim().min(1).max(128);
const id = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const ListSchema = z.object({ buildingId, after: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
// Users have text IDs; the UUID cursor used by units/teams is not interchangeable.
const PeopleListSchema = ListSchema.extend({ after: z.string().min(1).max(128).optional() });
type ListQuery = z.infer<typeof ListSchema>;
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

tenancyRouter.get("/blocks", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "units:read", q.buildingId);
    return page(await tx.select({ id: blocks.id, buildingId: blocks.buildingId, code: blocks.code, name: blocks.name }).from(blocks)
      .where(and(eq(blocks.buildingId, q.buildingId), eq(blocks.active, true), q.after ? gt(blocks.id, q.after) : undefined)).orderBy(asc(blocks.id)).limit(q.limit + 1), q.limit);
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

tenancyRouter.get("/units", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "units:read", q.buildingId);
    return page(await tx.select({ id: units.id, buildingId: units.buildingId, blockId: units.blockId, code: units.code, floor: units.floor }).from(units)
      .where(and(eq(units.buildingId, q.buildingId), eq(units.active, true), q.after ? gt(units.id, q.after) : undefined)).orderBy(asc(units.id)).limit(q.limit + 1), q.limit);
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

tenancyRouter.get("/teams", validateQuery(ListSchema), async (req, res) => {
  const q = query<ListQuery>(req);
  res.json(await inTenancy(req, async tx => {
    await assertCapability(tx, "teams:read", q.buildingId);
    return page(await tx.select({ id: teams.id, buildingId: teams.buildingId, name: teams.name, kind: teams.kind }).from(teams)
      .where(and(eq(teams.buildingId, q.buildingId), eq(teams.active, true), q.after ? gt(teams.id, q.after) : undefined)).orderBy(asc(teams.id)).limit(q.limit + 1), q.limit);
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
