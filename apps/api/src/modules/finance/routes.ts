import { assertFeature } from "../../auth/features.js";
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { financialReports } from "@predioon/db/runtime";
import { FinancialContentSchema, financialTotals } from "@predioon/shared";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { PaginationSchema } from "../../http/pagination.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const financeRouter = Router();
financeRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const List = PaginationSchema.extend({ buildingId: z.string().min(1), month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).optional() });
const Create = FinancialContentSchema.safeExtend({ buildingId: z.string().min(1) });
const Edit = FinancialContentSchema.safeExtend({ version: z.number().int().positive() });
const Publish = z.object({ version: z.number().int().positive() }).strict();
const view = (row: typeof financialReports.$inferSelect) => ({ ...row, totals: financialTotals(row) });
function idParam(req: Parameters<typeof param>[0]) {
  const parsed = z.string().uuid().safeParse(param(req, "id"));
  if (!parsed.success) throw badRequest("Identificador de prestação inválido"); return parsed.data;
}

financeRouter.get("/", validateQuery(List), async (req, res) => {
  const { buildingId, month, limit, offset } = query<z.infer<typeof List>>(req);
  const items = await inTenantContext(req, async tx => {
    await assertFeature(tx, buildingId, "FINANCE");
    return tx.select().from(financialReports).where(and(eq(financialReports.buildingId, buildingId), month ? eq(financialReports.month, month) : undefined))
      .orderBy(desc(financialReports.month), desc(financialReports.revision)).limit(limit).offset(offset);
  });
  res.json({ items: items.map(view), limit, offset });
});
financeRouter.post("/", validateBody(Create), async (req, res) => {
  const input = req.body as z.infer<typeof Create>, auth = currentAuth(req);
  const row = await inTenantContext(req, async tx => {
    await assertFeature(tx, input.buildingId, "FINANCE", true);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`finance:${input.buildingId}:${input.month}`}, 0))`);
    const [previous] = await tx.select({ revision: financialReports.revision }).from(financialReports)
      .where(and(eq(financialReports.buildingId, input.buildingId), eq(financialReports.month, input.month)))
      .orderBy(desc(financialReports.revision)).limit(1);
    const [created] = await tx.insert(financialReports).values({ ...input, revision: (previous?.revision ?? 0) + 1, createdBy: auth.userId }).returning();
    await recordAudit(tx, req, { buildingId: input.buildingId, userId: auth.userId, action: "FINANCIAL_DRAFT_CREATED", resourceType: "financial_report", resourceId: created!.id });
    return created!;
  });
  res.status(201).json(view(row));
});
financeRouter.put("/:id", validateBody(Edit), async (req, res) => {
  const id = idParam(req), { version, ...input } = req.body as z.infer<typeof Edit>;
  const row = await inTenantContext(req, async tx => {
    const [current] = await tx.select().from(financialReports).where(eq(financialReports.id, id)).limit(1);
    if (!current) throw notFound("Prestação de contas não encontrada");
    await assertFeature(tx, current.buildingId, "FINANCE", true);
    if (current.publishedAt) throw conflict("Prestação publicada é preservada. Crie uma nova revisão para corrigir.");
    if (input.month !== current.month) throw badRequest("O mês de um rascunho não pode ser alterado. Crie outro rascunho.");
    const [updated] = await tx.update(financialReports).set({ ...input, version: version + 1, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(financialReports.id, id), eq(financialReports.version, version))).returning();
    if (!updated) throw conflict("Este rascunho foi alterado. Atualize a página antes de salvar.");
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: currentAuth(req).userId, action: "FINANCIAL_DRAFT_UPDATED", resourceType: "financial_report", resourceId: id });
    return updated;
  });
  res.json(view(row));
});
financeRouter.post("/:id/publish", validateBody(Publish), async (req, res) => {
  const id = idParam(req), { version } = req.body as z.infer<typeof Publish>, auth = currentAuth(req);
  const row = await inTenantContext(req, async tx => {
    const [current] = await tx.select().from(financialReports).where(eq(financialReports.id, id)).limit(1);
    if (!current) throw notFound("Prestação de contas não encontrada");
    await assertFeature(tx, current.buildingId, "FINANCE", true);
    if (current.publishedAt) return current;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`finance:${current.buildingId}:${current.month}`}, 0))`);
    const newer = await tx.execute(sql`select id from financial_reports where building_id = ${current.buildingId} and month = ${current.month} and revision > ${current.revision} and published_at is not null limit 1`);
    if (newer.length) throw conflict("Já existe uma revisão mais recente publicada. Crie uma nova correção.");
    const [updated] = await tx.update(financialReports).set({ publishedAt: sql`clock_timestamp()`, publishedBy: auth.userId, version: version + 1, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(financialReports.id, id), eq(financialReports.version, version))).returning();
    if (!updated) throw conflict("Este rascunho foi alterado. Atualize e confira antes de publicar.");
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "FINANCIAL_REPORT_PUBLISHED", resourceType: "financial_report", resourceId: id, metadata: { month: current.month, revision: current.revision } });
    return updated;
  });
  res.json(view(row));
});
