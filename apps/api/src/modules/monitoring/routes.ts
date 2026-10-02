import { featureDisabled, observationIsCurrent } from "../../auth/features.js";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { dailyUsage, monitoringProfiles, readFeatures, usageCursors } from "@predioon/db/runtime";
import { assessDeviation, CreateMonitoringSchema, dayBounds, dayKey, learnReference, MonitoringConfigSchema, MonitoringPatchSchema, USAGE_UNITS, kindFeature } from "@predioon/shared";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, forbidden, notFound } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { assertActiveMonitoringDevice, assertMonitoringConfiguration, authorizedMonitoringProfiles, currentMonitoringProfiles, monitoringScope, monitoringWrite } from "./authorization.js";

export const monitoringRouter = Router();
const Query = z.object({ buildingId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

monitoringRouter.get("/", validateQuery(Query), async (req, res) => {
  const { buildingId, day } = query<z.infer<typeof Query>>(req);
  const result = await inTenantContext(req, async tx => {
    const building = await monitoringScope(tx, buildingId);
    const features = await readFeatures(tx, buildingId);
    const key = day ?? dayKey(new Date(), building.timezone);
    let bounds: ReturnType<typeof dayBounds>;
    try { bounds = dayBounds(key, building.timezone); } catch { throw badRequest("Data ou fuso inválido"); }
    const startKey = new Date(Date.parse(`${key}T12:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
    const contexts = await authorizedMonitoringProfiles(tx, buildingId);
    const profiles = await tx.select().from(monitoringProfiles).where(eq(monitoringProfiles.buildingId, buildingId));
    const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
    const candidates = contexts.flatMap(context => {
      const profile = profilesById.get(context.profile_id);
      return profile && profile.deviceId === context.device_id
        ? [{ profile, device: { name: context.device_name, type: context.device_type, enabled: context.device_enabled, status: context.device_status } }]
        : [];
    });
    const rows = candidates.filter(({ profile }) => features[kindFeature(profile.kind)].enabled);
    const ids = rows.map(row => row.profile.id);
    const history = ids.length ? await tx.select().from(dailyUsage).where(and(inArray(dailyUsage.profileId, ids), gte(dailyUsage.day, startKey), lte(dailyUsage.day, key))).orderBy(desc(dailyUsage.day)) : [];
    const cursors = ids.length ? await tx.select().from(usageCursors).where(inArray(usageCursors.profileId, ids)) : [];
    const currentContexts = await currentMonitoringProfiles(tx, buildingId);
    const contextsById = new Map(currentContexts.map(context => [context.profile_id, context]));
    const currentRows = rows.flatMap(row => {
      const context = contextsById.get(row.profile.id);
      return context && context.device_id === row.profile.deviceId
        ? [{ profile: row.profile, device: { name: context.device_name, type: context.device_type, enabled: context.device_enabled, status: context.device_status } }]
        : [];
    });
    return { buildingId, timezone: building.timezone, day: key, items: currentRows.map(({ profile, device }) => {
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
  const auth = currentAuth(req);
  if (input.kind === "PUMP" && (input.tariff !== null || input.dailyCostLimit !== null)) throw badRequest("Bomba usa minutos; configure custos no medidor de energia");
  if (input.kind !== "PUMP" && input.continuousLimitMinutes !== null) throw badRequest("Limite contínuo é exclusivo da bomba");
  const result = await monitoringWrite(() => inTenantContext(req, async tx => {
    await monitoringScope(tx, input.buildingId);
    await assertActiveMonitoringDevice(tx, input.buildingId, input.deviceId);
    await assertMonitoringConfiguration(tx, input.buildingId, input.deviceId);
    const features = await readFeatures(tx, input.buildingId);
    if (!features[kindFeature(input.kind)].enabled) throw featureDisabled(kindFeature(input.kind));
    const id = randomUUID();
    await tx.insert(monitoringProfiles).values({ ...input, id });
    // A fresh statement can authorize the inserted row under owner STABLE helpers.
    const [row] = await tx.select().from(monitoringProfiles).where(eq(monitoringProfiles.id, id)).limit(1);
    if (!row) throw forbidden();
    await recordAudit(tx, req, { buildingId: input.buildingId, userId: auth.userId, action: "MONITORING_CREATED", resourceType: "monitoring_profile", resourceId: row.id });
    return row;
  }));
  res.status(201).json(result);
});

monitoringRouter.patch("/:profileId", validateBody(MonitoringPatchSchema), async (req, res) => {
  const auth = currentAuth(req);
  const id = param(req, "profileId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound("Monitoramento não encontrado");
  const result = await monitoringWrite(() => inTenantContext(req, async tx => {
    const [visible] = await tx.select().from(monitoringProfiles).where(eq(monitoringProfiles.id, id)).limit(1);
    if (!visible) throw notFound("Monitoramento não encontrado");
    await assertMonitoringConfiguration(tx, visible.buildingId, visible.deviceId);
    const [locked] = await tx.select().from(monitoringProfiles).where(eq(monitoringProfiles.id, id)).limit(1).for("update");
    if (!locked) throw forbidden();
    // Grants/windows can change while PostgreSQL waits for the row lock.
    const [current] = await tx.select().from(monitoringProfiles).where(eq(monitoringProfiles.id, id)).limit(1);
    if (!current) throw forbidden();
    await assertMonitoringConfiguration(tx, current.buildingId, current.deviceId);
    const features = await readFeatures(tx, current.buildingId);
    if (!features[kindFeature(current.kind)].enabled) throw featureDisabled(kindFeature(current.kind));
    if (["adaptiveEnabled", "minimumHistoryDays", "deviationPercent"].some(key => Object.hasOwn(req.body, key)) && !features.AI_ANALYSIS.enabled) throw featureDisabled("AI_ANALYSIS");
    const values = MonitoringConfigSchema.parse({ ...current, ...req.body });
    if (current.kind === "PUMP" && (values.tariff !== null || values.dailyCostLimit !== null)) throw badRequest("Bomba usa minutos; configure custos no medidor de energia");
    if (current.kind !== "PUMP" && values.continuousLimitMinutes !== null) throw badRequest("Limite contínuo é exclusivo da bomba");
    const [row] = await tx.update(monitoringProfiles).set({ ...values, updatedAt: new Date() }).where(eq(monitoringProfiles.id, current.id)).returning();
    if (!row) throw forbidden();
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "MONITORING_UPDATED", resourceType: "monitoring_profile", resourceId: current.id, metadata: values });
    return row;
  }));
  res.json(result);
});
