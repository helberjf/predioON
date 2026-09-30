import { assertFeature } from "../../auth/features.js";
import { Router, type Request } from "express";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { buildings, supportHosts, supportRequests, users, type AppTransaction } from "@predioon/db/runtime";
import { anydeskUri, SupportConfigSchema, SupportOutcomeSchema, SupportRequestSchema } from "@predioon/shared";
import { currentAuth, inTenantContext, requireRole } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const supportRouter = Router();
supportRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
supportRouter.use(requireRole("PLATFORM_ADMIN"));
const BuildingId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const ListQuery = z.object({ buildingId: BuildingId }).strict();

function validatedParam(req: Request, name: string, schema: z.ZodString): string {
  const result = schema.safeParse(param(req, name));
  if (!result.success) throw badRequest("Identificador de condomínio ou atendimento inválido");
  return result.data;
}

async function authorize(tx: AppTransaction, req: Request, buildingId: string): Promise<void> {
  const [user] = await tx.select({ active: users.active, admin: users.isPlatformAdmin }).from(users)
    .where(eq(users.id, currentAuth(req).userId)).limit(1);
  if (!user?.active || !user.admin) throw forbidden("Acesso exclusivo de administradores ativos da plataforma");
  const [building] = await tx.select({ id: buildings.id }).from(buildings)
    .where(and(eq(buildings.id, buildingId), eq(buildings.active, true))).limit(1);
  if (!building) throw notFound("Condomínio indisponível para suporte");
}

async function audit(tx: AppTransaction, req: Request, buildingId: string, resourceId: string, action: string, metadata: Record<string, unknown> = {}) {
  await recordAudit(tx, req, { buildingId, userId: currentAuth(req).userId, resourceType: "remote_support", resourceId, action, metadata });
}

async function requestView(tx: AppTransaction, row: typeof supportRequests.$inferSelect) {
  const [user] = await tx.select({ name: users.name }).from(users).where(eq(users.id, row.requestedBy)).limit(1);
  return { ...row, requestedByName: user?.name ?? "Técnico" };
}

supportRouter.get("/", validateQuery(ListQuery), async (req, res) => {
  const { buildingId } = query<z.infer<typeof ListQuery>>(req);
  const result = await inTenantContext(req, async tx => {
    await authorize(tx, req, buildingId);
    await assertFeature(tx, buildingId, "REMOTE_SUPPORT", true);
    const [config] = await tx.select().from(supportHosts).where(eq(supportHosts.buildingId, buildingId)).limit(1);
    const requests = await tx.select({ ...getTableColumns(supportRequests), requestedByName: users.name }).from(supportRequests)
      .innerJoin(users, eq(users.id, supportRequests.requestedBy)).where(eq(supportRequests.buildingId, buildingId))
      .orderBy(desc(supportRequests.createdAt), desc(supportRequests.id)).limit(50);
    return { config: config ?? null, requests };
  });
  res.json(result);
});

supportRouter.put("/:buildingId", validateBody(SupportConfigSchema), async (req, res) => {
  const buildingId = validatedParam(req, "buildingId", BuildingId);
  const input = req.body as z.infer<typeof SupportConfigSchema>;
  const config = await inTenantContext(req, async tx => {
    await authorize(tx, req, buildingId);
    await assertFeature(tx, buildingId, "REMOTE_SUPPORT", true);
    const [row] = await tx.insert(supportHosts).values({ buildingId, ...input }).onConflictDoUpdate({
      target: supportHosts.buildingId,
      set: { ...input, revision: sql`${supportHosts.revision} + 1`, updatedAt: sql`clock_timestamp()` },
    }).returning();
    await audit(tx, req, buildingId, buildingId, "SUPPORT_CONFIG_SAVED", { revision: row!.revision, enabled: row!.enabled });
    return row!;
  });
  res.json(config);
});

supportRouter.post("/:buildingId/requests", validateBody(SupportRequestSchema), async (req, res) => {
  const buildingId = validatedParam(req, "buildingId", BuildingId);
  const input = req.body as z.infer<typeof SupportRequestSchema>;
  const userId = currentAuth(req).userId;
  const result = await inTenantContext(req, async tx => {
    await authorize(tx, req, buildingId);
    await assertFeature(tx, buildingId, "REMOTE_SUPPORT", true);
    // Serializes duplicate HTTP deliveries across API workers, including different buildings.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`support:${userId}:${input.requestId}`}, 0))`);
    const [config] = await tx.select().from(supportHosts).where(eq(supportHosts.buildingId, buildingId)).limit(1).for("update");
    if (!config?.enabled) throw conflict("Cadastre e habilite o computador deste condomínio antes de iniciar o atendimento");
    const [existing] = await tx.select().from(supportRequests)
      .where(and(eq(supportRequests.requestedBy, userId), eq(supportRequests.requestId, input.requestId))).limit(1).for("update");
    if (existing) {
      if (existing.buildingId !== buildingId || existing.reason !== input.reason) throw conflict("Esta solicitação já foi usada em outro atendimento");
      if (existing.status !== "OPEN") throw conflict("Atendimento já encerrado. Registre uma nova solicitação");
      if (existing.configRevision !== config.revision || existing.anydeskId !== config.anydeskId) throw conflict("A configuração mudou. Atualize os dados e registre uma nova solicitação");
      return { request: await requestView(tx, existing), launchUri: anydeskUri(config.anydeskId), repeated: true };
    }
    const [row] = await tx.insert(supportRequests).values({
      requestId: input.requestId, buildingId, requestedBy: userId, displayName: config.displayName,
      anydeskId: config.anydeskId, configRevision: config.revision, reason: input.reason,
    }).returning();
    await audit(tx, req, buildingId, row!.id, "SUPPORT_REQUESTED");
    return { request: await requestView(tx, row!), launchUri: anydeskUri(config.anydeskId), repeated: false };
  });
  res.status(result.repeated ? 200 : 201).json({ request: result.request, launchUri: result.launchUri });
});

supportRouter.patch("/:buildingId/requests/:id", validateBody(SupportOutcomeSchema), async (req, res) => {
  const buildingId = validatedParam(req, "buildingId", BuildingId);
  const id = validatedParam(req, "id", z.string().uuid());
  const input = req.body as z.infer<typeof SupportOutcomeSchema>;
  const result = await inTenantContext(req, async tx => {
    await authorize(tx, req, buildingId);
    const [row] = await tx.select().from(supportRequests)
      .where(and(eq(supportRequests.id, id), eq(supportRequests.buildingId, buildingId))).limit(1).for("update");
    if (!row) throw notFound("Atendimento não encontrado neste condomínio");
    if (row.status !== "OPEN") {
      if (row.status === input.outcome && row.notes === input.notes) return requestView(tx, row);
      throw conflict("Este atendimento já foi encerrado. O resultado registrado é preservado");
    }
    const [updated] = await tx.update(supportRequests).set({
      // Creation and completion use the same clock, independent of the API host's clock skew.
      status: input.outcome, notes: input.notes, closedBy: currentAuth(req).userId, closedAt: sql`clock_timestamp()`,
    }).where(eq(supportRequests.id, row.id)).returning();
    await audit(tx, req, buildingId, row.id, "SUPPORT_RESULT_RECORDED", { outcome: input.outcome });
    return requestView(tx, updated!);
  });
  res.json(result);
});
