import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@predioon/db";
import { currentAuth, inTenantContext, requireRole } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
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

organizationsRouter.use(requireRole("PLATFORM_ADMIN"));

organizationsRouter.get("/", async (req, res) => {
  const rows = await inTenantContext(req, (tx) => tx.select().from(organizations).orderBy(organizations.name));
  res.json({ items: rows });
});

organizationsRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx
      .insert(organizations)
      .values({ id: generateId("org"), ...input, metadata: input.metadata ?? {} })
      .returning();
    await recordAudit(tx, req, {
      userId: auth.userId,
      action: "ORGANIZATION_CREATED",
      resourceType: "organization",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(row);
});

organizationsRouter.patch("/:organizationId", validateBody(UpdateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof UpdateSchema>;
  const auth = currentAuth(req);

  const row = await inTenantContext(req, async (tx) => {
    const [updated] = await tx
      .update(organizations)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(organizations.id, param(req, "organizationId")))
      .returning();
    if (!updated) throw notFound("Organização não encontrada");
    await recordAudit(tx, req, {
      userId: auth.userId,
      action: "ORGANIZATION_UPDATED",
      resourceType: "organization",
      resourceId: updated.id,
      metadata: input,
    });
    return updated;
  });

  res.json(row);
});
