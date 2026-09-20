import { Router } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { alertRules } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole, scopedBuildingIds } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const alertRulesRouter = Router();

const ListQuerySchema = z.object({ buildingId: z.string().optional() });

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  deviceId: z.string().min(1).nullable().optional(),
  name: z.string().min(2).max(120),
  metric: z.string().min(1).max(64),
  operator: z.enum(["LT", "LTE", "GT", "GTE", "EQ", "NEQ"]),
  threshold: z.number(),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  alertType: z.string().min(2).max(60),
  messageTemplate: z.string().min(3).max(300),
  /** Seconds before the same rule may fire again. Without it a noisy sensor floods the panel. */
  cooldownSeconds: z.number().int().min(0).max(86_400).default(300),
});
const UpdateSchema = CreateSchema.partial().omit({ buildingId: true }).extend({ enabled: z.boolean().optional() });

alertRulesRouter.use(requireRole("BUILDING_ADMIN"));

alertRulesRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId } = query<z.infer<typeof ListQuerySchema>>(req);
  if (buildingId) assertBuildingAccess(auth, buildingId, "BUILDING_ADMIN");
  const scope = scopedBuildingIds(auth);

  const rows = await inTenantContext(req, (tx) => {
    const filters = [
      buildingId ? eq(alertRules.buildingId, buildingId) : undefined,
      scope && !buildingId ? inArray(alertRules.buildingId, scope.length ? scope : [""]) : undefined,
    ].filter(Boolean);
    return tx.select().from(alertRules).where(filters.length ? and(...filters) : undefined).orderBy(asc(alertRules.name));
  });

  res.json({ items: rows });
});

alertRulesRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx.insert(alertRules).values({ ...input, createdBy: auth.userId }).returning();
    await recordAudit(tx, req, {
      buildingId: input.buildingId,
      userId: auth.userId,
      action: "ALERT_RULE_CREATED",
      resourceType: "alert_rule",
      resourceId: created!.id,
      metadata: { metric: input.metric, operator: input.operator, threshold: input.threshold },
    });
    return created!;
  });

  res.status(201).json(row);
});

alertRulesRouter.patch("/:ruleId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(alertRules).where(eq(alertRules.id, param(req, "ruleId"))).limit(1);
    if (!current) throw notFound("Regra não encontrada");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");

    const [updated] = await tx
      .update(alertRules)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(alertRules.id, current.id))
      .returning();
    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "ALERT_RULE_UPDATED",
      resourceType: "alert_rule",
      resourceId: current.id,
      metadata: input,
    });
    return updated!;
  });

  res.json(row);
});

alertRulesRouter.delete("/:ruleId", async (req, res) => {
  const auth = currentAuth(req);

  await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(alertRules).where(eq(alertRules.id, param(req, "ruleId"))).limit(1);
    if (!current) throw notFound("Regra não encontrada");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");

    await tx.delete(alertRules).where(eq(alertRules.id, current.id));
    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "ALERT_RULE_DELETED",
      resourceType: "alert_rule",
      resourceId: current.id,
    });
  });

  res.status(204).end();
});
