import { Router, type Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { buildings, buildingFeatureSettings, globalFeatureSettings, lockFeatureChanges, readFeatures, type AppTransaction } from "@predioon/db";
import { FEATURE_CATALOG, FEATURE_KEYS, FeatureKeySchema, FeatureUpdateSchema, REALTIME_CHANNEL, resolveFeatures, type FeatureKey, type FeatureStates } from "@predioon/shared";
import { currentAuth, inTenantContext, requireRole } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { validateBody } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const featuresRouter = Router();
featuresRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

async function assertAdmin(tx: AppTransaction): Promise<void> {
  const [row] = await tx.execute(sql`select app_support_admin() as allowed`);
  if (!row?.allowed) throw forbidden("Acesso exclusivo de administradores ativos da plataforma");
}
async function assertBuilding(tx: AppTransaction, req: Request, buildingId: string): Promise<void> {
  if (currentAuth(req).role === "PLATFORM_ADMIN") {
    await assertAdmin(tx);
    const [building] = await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, buildingId)).limit(1);
    if (!building) throw notFound("Condomínio não encontrado");
  } else {
    const [row] = await tx.execute(sql`select app_governance_access(${buildingId}) as allowed`);
    if (!row?.allowed) throw forbidden("Prédio fora do seu escopo");
  }
}
async function globalView(tx: AppTransaction) {
  const states = resolveFeatures(await tx.select().from(globalFeatureSettings), []);
  return { items: Object.values(states).map(state => ({ ...state, version: state.globalVersion })) };
}
function featureParam(req: Request): FeatureKey {
  const parsed = FeatureKeySchema.safeParse(param(req, "key"));
  if (!parsed.success) throw badRequest("Funcionalidade inválida");
  return parsed.data;
}

featuresRouter.get("/catalog", requireRole("PLATFORM_ADMIN"), async (req, res) => {
  await inTenantContext(req, assertAdmin);
  res.json({ items: FEATURE_CATALOG });
});
featuresRouter.get("/global", requireRole("PLATFORM_ADMIN"), async (req, res) => {
  res.json(await inTenantContext(req, async tx => { await assertAdmin(tx); return globalView(tx); }));
});
featuresRouter.get("/buildings/:buildingId", async (req, res) => {
  const buildingId = param(req, "buildingId");
  res.json(await inTenantContext(req, async tx => {
    await assertBuilding(tx, req, buildingId);
    return { items: Object.values(await readFeatures(tx, buildingId)) };
  }));
});

async function update(req: Request, buildingId: string | null) {
  const key = featureParam(req), input = FeatureUpdateSchema.parse(req.body);
  if (buildingId === null && input.enabled === null) throw badRequest("A configuração global deve ser ligada ou desligada");
  return inTenantContext(req, async tx => {
    await lockFeatureChanges(tx);
    await assertAdmin(tx);
    if (buildingId !== null) await assertBuilding(tx, req, buildingId);
    const targets = buildingId === null ? await tx.select({ id: buildings.id }).from(buildings) : [{ id: buildingId }];
    const priorStates = new Map<string, FeatureStates>();
    for (const target of targets) priorStates.set(target.id, await readFeatures(tx, target.id));
    const [prior] = buildingId === null
      ? await tx.select().from(globalFeatureSettings).where(eq(globalFeatureSettings.key, key)).limit(1)
      : await tx.select().from(buildingFeatureSettings).where(and(eq(buildingFeatureSettings.buildingId, buildingId), eq(buildingFeatureSettings.key, key))).limit(1);
    if ((prior?.version ?? 0) !== input.version) throw conflict("Configuração alterada por outro administrador. Atualize a tela.", { code: "FEATURE_VERSION_CONFLICT" });
    const version = input.version + 1;
    if (buildingId === null) {
      const values = { key, enabled: input.enabled!, version, updatedAt: sql`clock_timestamp()` };
      await tx.insert(globalFeatureSettings).values(values).onConflictDoUpdate({ target: globalFeatureSettings.key, set: values });
    } else {
      const values = { buildingId, key, enabled: input.enabled, version, updatedAt: sql`clock_timestamp()` };
      await tx.insert(buildingFeatureSettings).values(values).onConflictDoUpdate({ target: [buildingFeatureSettings.buildingId, buildingFeatureSettings.key], set: values });
    }
    let affected = 0;
    for (const target of targets) {
      const after = await readFeatures(tx, target.id), before = priorStates.get(target.id)!;
      let changed = false;
      for (const feature of FEATURE_KEYS) if (before[feature].enabled !== after[feature].enabled) {
        await tx.execute(sql`select app_apply_feature_transition(${target.id}, ${feature}, ${after[feature].enabled})`);
        changed = true;
      }
      if (changed) affected++;
    }
    await recordAudit(tx, req, { buildingId, userId: currentAuth(req).userId, action: "FEATURE_CONFIGURATION_CHANGED", resourceType: "feature", resourceId: key,
      metadata: { scope: buildingId === null ? "GLOBAL" : "BUILDING", before: prior?.enabled ?? (buildingId === null ? true : null), after: input.enabled, version, reason: input.reason, affectedBuildings: affected } });
    await tx.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify({ kind: "features-changed", buildingId: buildingId ?? "*" })})`);
    return buildingId === null ? globalView(tx) : { items: Object.values(await readFeatures(tx, buildingId)) };
  }, { featureWrite: true });
}

featuresRouter.put("/global/:key", requireRole("PLATFORM_ADMIN"), validateBody(FeatureUpdateSchema), async (req, res) => res.json(await update(req, null)));
featuresRouter.put("/buildings/:buildingId/:key", requireRole("PLATFORM_ADMIN"), validateBody(FeatureUpdateSchema), async (req, res) => res.json(await update(req, param(req, "buildingId"))));
