import { Router } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { notices } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const noticesRouter = Router();

const ListQuerySchema = z.object({
  buildingId: z.string().min(1),
  includeExpired: z.coerce.boolean().default(false),
});

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  category: z.enum(["COMMUNICATION", "MAINTENANCE", "EVENT", "WASTE_COLLECTION"]).default("COMMUNICATION"),
  title: z.string().min(3).max(160),
  body: z.string().min(3).max(4000),
  pinned: z.boolean().default(false),
  publishedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

noticesRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const { buildingId, includeExpired } = query<z.infer<typeof ListQuerySchema>>(req);
  assertBuildingAccess(currentAuth(req), buildingId);

  const rows = await inTenantContext(req, (tx) =>
    tx
      .select()
      .from(notices)
      .where(
        includeExpired
          ? eq(notices.buildingId, buildingId)
          : and(eq(notices.buildingId, buildingId), or(isNull(notices.expiresAt), gt(notices.expiresAt, new Date()))),
      )
      .orderBy(desc(notices.pinned), desc(notices.publishedAt)),
  );

  res.json({ items: rows });
});

noticesRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx.insert(notices).values({ ...input, createdBy: auth.userId }).returning();
    await recordAudit(tx, req, {
      buildingId: input.buildingId,
      userId: auth.userId,
      action: "NOTICE_PUBLISHED",
      resourceType: "notice",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(row);
});

noticesRouter.delete("/:noticeId", async (req, res) => {
  const auth = currentAuth(req);

  await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(notices).where(eq(notices.id, param(req, "noticeId"))).limit(1);
    if (!current) throw notFound("Aviso não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");

    await tx.delete(notices).where(eq(notices.id, current.id));
    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "NOTICE_DELETED",
      resourceType: "notice",
      resourceId: current.id,
    });
  });

  res.status(204).end();
});
