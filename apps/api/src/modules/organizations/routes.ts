import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { organizations, type AppTransaction } from "@predioon/db/runtime";
import type { OrganizationView } from "@predioon/contracts";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { conflict, forbidden, HttpError, notFound, pgErrorCode } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { validateBody } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const organizationsRouter = Router();

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "use apenas minúsculas, números e hífen"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const UpdateSchema = CreateSchema.partial().extend({ active: z.boolean().optional() });

organizationsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

async function assertOrganizationAccess(tx: AppTransaction, write = false): Promise<void> {
  const [row] = await tx.execute(sql`select app_has_global_capability('organizations:read')
    and (${!write} or app_has_global_capability('organizations:manage')) as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade global necessária para organizações");
}

function view(row: typeof organizations.$inferSelect): OrganizationView {
  return { id: row.id, name: row.name, slug: row.slug, active: row.active, metadata: row.metadata,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function organizationOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    if (pgErrorCode(error) === "42501") throw forbidden("Sem a capacidade global necessária para organizações");
    if (pgErrorCode(error) === "23505") throw conflict("Já existe uma organização com este slug");
    // Database errors can contain submitted commercial metadata and SQL parameters.
    throw new HttpError(500, "Não foi possível concluir a operação de organizações");
  }
}

organizationsRouter.get("/", async (req, res) => {
  const items = await organizationOperation(() => inTenantContext(req, async tx => {
    await assertOrganizationAccess(tx);
    const rows = await tx.select().from(organizations).orderBy(organizations.name, organizations.id);
    await assertOrganizationAccess(tx);
    return rows.map(view);
  }));
  res.json({ items });
});

organizationsRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await organizationOperation(() => inTenantContext(req, async (tx) => {
    await assertOrganizationAccess(tx, true);
    const organizationId = generateId("org");
    // Limit INSERT privileges to these columns; database-owned defaults are not
    // present in the statement, including as client-supplied DEFAULT expressions.
    await tx.execute(sql`insert into organizations(id,name,slug,metadata)
      values(${organizationId},${input.name},${input.slug},${JSON.stringify(input.metadata ?? {})}::jsonb)`);
    await assertOrganizationAccess(tx, true);
    await recordAudit(tx, req, {
      userId: auth.userId,
      action: "ORGANIZATION_CREATED",
      resourceType: "organization",
      resourceId: organizationId,
    });
    const [created] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    await assertOrganizationAccess(tx, true);
    if (!created) throw forbidden("Organização fora do seu escopo atual");
    return view(created);
  }));

  res.status(201).json(row);
});

organizationsRouter.patch("/:organizationId", validateBody(UpdateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof UpdateSchema>;
  const auth = currentAuth(req);

  const row = await organizationOperation(() => inTenantContext(req, async (tx) => {
    await assertOrganizationAccess(tx, true);
    const organizationId = param(req, "organizationId");
    // id is immutable. NO KEY UPDATE permits existing building FK checks while
    // serializing edits and giving authorization a fresh statement after waiting.
    const [existing] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).for("no key update").limit(1);
    await assertOrganizationAccess(tx, true);
    if (!existing) throw notFound("Organização não encontrada");
    const [updated] = await tx
      .update(organizations)
      .set({ ...input, updatedAt: sql`clock_timestamp()` })
      .where(eq(organizations.id, organizationId))
      .returning();
    if (!updated) throw notFound("Organização não encontrada");
    await recordAudit(tx, req, {
      userId: auth.userId,
      action: "ORGANIZATION_UPDATED",
      resourceType: "organization",
      resourceId: updated.id,
      metadata: input,
    });
    await assertOrganizationAccess(tx, true);
    return view(updated);
  }));

  res.json(row);
});
