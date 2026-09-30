import { assertFeature, buildingFeatures, observationIsCurrent } from "../../auth/features.js";
import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { buildings, dailyUsage, devices, monitoringProfiles, usageCursors } from "@predioon/db/runtime";
import { assessDeviation, CreateMonitoringSchema, dayBounds, dayKey, learnReference, MonitoringConfigSchema, MonitoringPatchSchema, USAGE_UNITS, kindFeature } from "@predioon/shared";
import { assertBuildingAccess, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const monitoringRouter = Router();
const Query = z.object({ buildingId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

monitoringRouter.get("/", validateQuery(Query), async (req, res) => {
  const { buildingId, day } = query<z.infer<typeof Query>>(req);
  assertBuildingAccess(currentAuth(req), buildingId);
  const result = await inTenantContext(req, async tx => {
    const features = await buildingFeatures(tx, buildingId);
    const [building] = await tx.select().from(buildings).where(eq(buildings.id, buildingId)).limit(1);
    if (!building) throw notFound("Imóvel não encontrado");
    const key = day ?? dayKey(new Date(), building.timezone);
    let bounds: ReturnType<typeof dayBounds>;
    try { bounds = dayBounds(key, building.timezone); } catch { throw badRequest("Data ou fuso inválido"); }
    const startKey = new Date(Date.parse(`${key}T12:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
    const candidates = await tx.select({ profile: monitoringProfiles, device: devices }).from(monitoringProfiles)
      .innerJoin(devices, eq(devices.id, monitoringProfiles.deviceId)).where(eq(monitoringProfiles.buildingId, buildingId)).orderBy(asc(monitoringProfiles.kind), asc(devices.name));
    const rows = candidates.filter(({ profile }) => features[kindFeature(profile.kind)].enabled);
    if (!rows.length) return { buildingId, timezone: building.timezone, day: key, items: [] };
    const ids = rows.map(row => row.profile.id);
    const history = await tx.select().from(dailyUsage).where(and(inArray(dailyUsage.profileId, ids), gte(dailyUsage.day, startKey), lte(dailyUsage.day, key))).orderBy(desc(dailyUsage.day));
    const cursors = await tx.select().from(usageCursors).where(inArray(usageCursors.profileId, ids));
    return { buildingId, timezone: building.timezone, day: key, items: rows.map(({ profile, device }) => {
      const series = history.filter(row => row.profileId === profile.id);
      const current = series.find(row => row.day === key);
      const cursor = cursors.find(row => row.profileId === profile.id);
      const elapsed = Math.max(0, (Math.min(Date.now(), bounds.end.getTime()) - bounds.start.getTime()) / 1000);
      const coveragePercent = current && elapsed > 0 ? Math.min(100, current.coveredSeconds / elapsed * 100) : 0;
      const currentObservation = observationIsCurrent(features, [kindFeature(profile.kind)], cursor?.lastAt ?? null);
      const fresh = currentObservation && !!cursor && cursor.good && Date.now() - cursor.lastAt.getTime() <= profile.maxGapSeconds * 1000 && device.enabled && device.status !== "DISABLED";
      const training = features.AI_ANALYSIS.enabled ? series.filter(row => { const b = dayBounds(row.day, building.timezone); return row.day < key && !row.incomplete && row.resets === 0 && row.coveredSeconds >= (b.end.getTime() - b.start.getTime()) / 1000 * 0.8; }) : [];
      const adaptiveEnabled = features.AI_ANALYSIS.enabled && profile.adaptiveEnabled;
      const reference = adaptiveEnabled ? learnReference(training.map(row => row.quantity), profile.minimumHistoryDays) : null;
      const observed = current && current.coveredSeconds > 0 ? current.quantity : null;
      const deviation = reference && observed !== null && !current?.incomplete ? assessDeviation(observed, reference, profile.deviationPercent) : null;
      return { ...profile, adaptiveEnabled, deviceName: device.name, deviceType: device.type, unit: USAGE_UNITS[profile.kind],
        today: current ? { ...current, quantity: observed, estimatedCost: observed === null ? null : current.estimatedCost, coveragePercent } : null,
        fresh, lastReadingAt: currentObservation ? cursor?.lastAt ?? null : null, continuousMinutes: profile.kind === "PUMP" && fresh ? cursor!.continuousSeconds / 60 : null,
        reference, deviation, learningDays: training.length,
        analysisStatus: !adaptiveEnabled ? "DISABLED" : !reference ? "LEARNING" : !fresh ? "STALE" : deviation?.anomalous ? "ANOMALY" : "WITHIN_REFERENCE",
        history: [...series].reverse() };
    }) };
  });
  res.json(result);
});

monitoringRouter.post("/", validateBody(CreateMonitoringSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateMonitoringSchema>;
  const auth = currentAuth(req); assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");
  if (input.kind === "PUMP" && (input.tariff !== null || input.dailyCostLimit !== null)) throw badRequest("Bomba usa minutos; configure custos no medidor de energia");
  if (input.kind !== "PUMP" && input.continuousLimitMinutes !== null) throw badRequest("Limite contínuo é exclusivo da bomba");
  try {
    const result = await inTenantContext(req, async tx => {
      const features = await assertFeature(tx, input.buildingId, kindFeature(input.kind), true);
      const [device] = await tx.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.buildingId, input.buildingId), eq(devices.enabled, true))).limit(1);
      if (!device) throw badRequest("Selecione um equipamento ativo deste imóvel");
      const [row] = await tx.insert(monitoringProfiles).values(input).returning();
      await recordAudit(tx, req, { buildingId: input.buildingId, userId: auth.userId, action: "MONITORING_CREATED", resourceType: "monitoring_profile", resourceId: row!.id });
      return row;
    });
    res.status(201).json(result);
  } catch (error) { if (pgErrorCode(error) === "23505") throw conflict("Este equipamento já possui monitoramento desse tipo"); throw error; }
});

monitoringRouter.patch("/:profileId", validateBody(MonitoringPatchSchema), async (req, res) => {
  const auth = currentAuth(req);
  const result = await inTenantContext(req, async tx => {
    const [current] = await tx.select().from(monitoringProfiles).where(eq(monitoringProfiles.id, param(req, "profileId"))).limit(1).for("update");
    if (!current) throw notFound("Monitoramento não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, kindFeature(current.kind), true);
    if (["adaptiveEnabled", "minimumHistoryDays", "deviationPercent"].some(key => Object.hasOwn(req.body, key))) await assertFeature(tx, current.buildingId, "AI_ANALYSIS", true);
    const values = MonitoringConfigSchema.parse({ ...current, ...req.body });
    if (current.kind === "PUMP" && (values.tariff !== null || values.dailyCostLimit !== null)) throw badRequest("Bomba usa minutos; configure custos no medidor de energia");
    if (current.kind !== "PUMP" && values.continuousLimitMinutes !== null) throw badRequest("Limite contínuo é exclusivo da bomba");
    const [row] = await tx.update(monitoringProfiles).set({ ...values, updatedAt: new Date() }).where(eq(monitoringProfiles.id, current.id)).returning();
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "MONITORING_UPDATED", resourceType: "monitoring_profile", resourceId: current.id, metadata: values });
    return row;
  });
  res.json(result);
});
