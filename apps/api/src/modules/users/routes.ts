import { Router } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { memberships, users } from "@predioon/db/runtime";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole, scopedBuildingIds } from "../../auth/middleware.js";
import { conflict, notFound } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { hashPassword } from "../../auth/passwords.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const usersRouter = Router();

const ListQuerySchema = z.object({ buildingId: z.string().optional() });

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
  phone: z.string().max(40).optional(),
  isPlatformAdmin: z.boolean().default(false),
});

const MembershipSchema = z.object({
  userId: z.string().min(1),
  buildingId: z.string().min(1),
  role: z.enum(["BUILDING_ADMIN", "RESIDENT"]),
  unit: z.string().max(40).optional(),
});

const publicFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  isPlatformAdmin: users.isPlatformAdmin,
  active: users.active,
  createdAt: users.createdAt,
};

usersRouter.use(requireRole("BUILDING_ADMIN"));

usersRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId } = query<z.infer<typeof ListQuerySchema>>(req);
  if (buildingId) assertBuildingAccess(auth, buildingId, "BUILDING_ADMIN");

  const scope = buildingId ? [buildingId] : scopedBuildingIds(auth);

  const rows = await inTenantContext(req, (tx) =>
    scope
      ? tx
          .selectDistinct(publicFields)
          .from(users)
          .innerJoin(memberships, eq(memberships.userId, users.id))
          .where(inArray(memberships.buildingId, scope.length ? scope : [""]))
          .orderBy(asc(users.name))
      : tx.select(publicFields).from(users).orderBy(asc(users.name)),
  );

  res.json({ items: rows });
});

usersRouter.post("/", requireRole("PLATFORM_ADMIN"), validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  const passwordHash = await hashPassword(input.password);

  const row = await inTenantContext(req, async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
    if (existing) throw conflict("Já existe um usuário com este e-mail");

    const [created] = await tx
      .insert(users)
      .values({
        id: generateId("usr"),
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone ?? null,
        isPlatformAdmin: input.isPlatformAdmin,
        passwordHash,
      })
      .returning(publicFields);

    await recordAudit(tx, req, {
      userId: auth.userId,
      action: "USER_CREATED",
      resourceType: "user",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(row);
});

usersRouter.post("/memberships", validateBody(MembershipSchema), async (req, res) => {
  const input = req.body as z.infer<typeof MembershipSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx
      .insert(memberships)
      .values(input)
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.buildingId],
        set: {
          role: input.role, unit: input.unit ?? null, active: true,
          // Readmission must not retain the revoked grant's end date. An edit
          // to a still-valid or future grant must preserve its access window.
          startsAt: sql`case when not ${memberships.active} or ${memberships.endsAt} <= statement_timestamp() then null else ${memberships.startsAt} end`,
          endsAt: sql`case when not ${memberships.active} or ${memberships.endsAt} <= statement_timestamp() then null else ${memberships.endsAt} end`,
          updatedAt: sql`clock_timestamp()`,
        },
      })
      .returning();

    await recordAudit(tx, req, {
      buildingId: input.buildingId,
      userId: auth.userId,
      action: "MEMBERSHIP_UPSERTED",
      resourceType: "membership",
      resourceId: created!.id,
      metadata: { targetUserId: input.userId, role: input.role },
    });
    return created!;
  });

  res.status(201).json(row);
});

usersRouter.delete("/memberships/:membershipId", async (req, res) => {
  const auth = currentAuth(req);

  await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(memberships).where(eq(memberships.id, param(req, "membershipId"))).limit(1);
    if (!current) throw notFound("Vínculo não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");

    // Record while the actor still has authority, including self-revocation.
    // Both the audit and the mutation roll back if either operation fails.
    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "MEMBERSHIP_REVOKED",
      resourceType: "membership",
      resourceId: current.id,
    });
    const changed = await tx
      .update(memberships)
      .set({ active: false, endsAt: new Date(), updatedAt: new Date() })
      .where(and(eq(memberships.id, current.id)))
      .returning({ id: memberships.id });
    if (changed.length !== 1) throw conflict("O vínculo mudou durante a revogação. Atualize e tente novamente.");
  });

  res.status(204).end();
});
