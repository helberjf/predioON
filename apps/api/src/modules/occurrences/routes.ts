import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { occurrenceEvents, occurrences } from "@predioon/db";
import { assertBuildingAccess, buildingRole, currentAuth, inTenantContext, scopedBuildingIds } from "../../auth/middleware.js";
import { forbidden, notFound } from "../../http/errors.js";
import { PaginationSchema } from "../../http/pagination.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const occurrencesRouter = Router();

const OPEN_STATUSES = ["OPEN", "IN_ANALYSIS", "IN_PROGRESS"] as const;

const ListQuerySchema = PaginationSchema.extend({
  buildingId: z.string().optional(),
  status: z.enum(["OPEN", "IN_ANALYSIS", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  onlyOpen: z.coerce.boolean().default(false),
});

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  category: z.string().min(2).max(60),
  title: z.string().min(3).max(160),
  description: z.string().min(3).max(4000),
  location: z.string().max(160).optional(),
  unit: z.string().max(40).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

const UpdateSchema = z.object({
  status: z.enum(["OPEN", "IN_ANALYSIS", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedTo: z.string().min(1).nullable().optional(),
});

const CommentSchema = z.object({ message: z.string().min(1).max(2000) });

/** RLS already hides other people's tickets from a resident; these filters are for the UI. */
occurrencesRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId, status, onlyOpen, limit, offset } = query<z.infer<typeof ListQuerySchema>>(req);
  if (buildingId) assertBuildingAccess(auth, buildingId);
  const scope = scopedBuildingIds(auth);

  const rows = await inTenantContext(req, (tx) => {
    const filters = [
      buildingId ? eq(occurrences.buildingId, buildingId) : undefined,
      scope && !buildingId ? inArray(occurrences.buildingId, scope.length ? scope : [""]) : undefined,
      status ? eq(occurrences.status, status) : undefined,
      onlyOpen ? inArray(occurrences.status, [...OPEN_STATUSES]) : undefined,
    ].filter(Boolean);
    return tx
      .select()
      .from(occurrences)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(occurrences.createdAt))
      .limit(limit)
      .offset(offset);
  });

  res.json({ items: rows, limit, offset });
});

occurrencesRouter.get("/:occurrenceId", async (req, res) => {
  const payload = await inTenantContext(req, async (tx) => {
    const [occurrence] = await tx.select().from(occurrences).where(eq(occurrences.id, param(req, "occurrenceId"))).limit(1);
    if (!occurrence) throw notFound("Chamado não encontrado");

    const timeline = await tx
      .select()
      .from(occurrenceEvents)
      .where(eq(occurrenceEvents.occurrenceId, occurrence.id))
      .orderBy(occurrenceEvents.createdAt);

    return { ...occurrence, timeline };
  });

  res.json(payload);
});

occurrencesRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId);

  const row = await inTenantContext(req, async (tx) => {
    const [{ protocol }] = (await tx.execute(
      sql`select next_occurrence_protocol() as protocol`,
    )) as unknown as Array<{ protocol: string }>;

    const [created] = await tx
      .insert(occurrences)
      .values({ ...input, protocol, openedBy: auth.userId })
      .returning();

    await tx.insert(occurrenceEvents).values({
      occurrenceId: created!.id,
      buildingId: created!.buildingId,
      authorId: auth.userId,
      kind: "CREATED",
      message: input.title,
    });

    return created!;
  });

  res.status(201).json(row);
});

occurrencesRouter.patch("/:occurrenceId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(occurrences).where(eq(occurrences.id, param(req, "occurrenceId"))).limit(1);
    if (!current) throw notFound("Chamado não encontrado");

    // Residents may cancel their own ticket; everything else is the building admin's call.
    const isAdmin = buildingRole(auth, current.buildingId) !== "RESIDENT";
    const residentCancelling = input.status === "CANCELLED" && current.openedBy === auth.userId && !input.assignedTo;
    if (!isAdmin && !residentCancelling) throw forbidden("Apenas a administração pode alterar este chamado");

    const closing = input.status === "DONE" || input.status === "CANCELLED";
    const [updated] = await tx
      .update(occurrences)
      .set({ ...input, closedAt: closing ? new Date() : null, updatedAt: new Date() })
      .where(eq(occurrences.id, current.id))
      .returning();

    if (input.status && input.status !== current.status) {
      await tx.insert(occurrenceEvents).values({
        occurrenceId: current.id,
        buildingId: current.buildingId,
        authorId: auth.userId,
        kind: "STATUS_CHANGED",
        message: `${current.status} → ${input.status}`,
      });
    }

    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "OCCURRENCE_UPDATED",
      resourceType: "occurrence",
      resourceId: current.id,
      metadata: input,
    });

    return updated!;
  });

  res.json(row);
});

occurrencesRouter.post("/:occurrenceId/comments", validateBody(CommentSchema), async (req, res) => {
  const auth = currentAuth(req);
  const { message } = req.body as z.infer<typeof CommentSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(occurrences).where(eq(occurrences.id, param(req, "occurrenceId"))).limit(1);
    if (!current) throw notFound("Chamado não encontrado");

    const [created] = await tx
      .insert(occurrenceEvents)
      .values({
        occurrenceId: current.id,
        buildingId: current.buildingId,
        authorId: auth.userId,
        kind: "COMMENT",
        message,
      })
      .returning();

    await tx.update(occurrences).set({ updatedAt: new Date() }).where(eq(occurrences.id, current.id));
    return created!;
  });

  res.status(201).json(row);
});
