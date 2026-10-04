import { and, desc, eq, gte, lt } from "drizzle-orm";
import { alerts, buildings, dailyUsage, monitoringProfiles, usageCursors, readFeatures, type DbTransaction } from "@predioon/db";
import { advanceUsage, assessDeviation, dayBounds, dayKey, learnReference, kindFeature, USAGE_METRICS, USAGE_UNITS, type FeatureStates, type Telemetry } from "@predioon/shared";
import { assertPersisted, persistAlert, type AlertNotification, type PersistenceChecks } from "../notify/index.js";
import { permitsFeature } from "../features.js";

/** Called under the sensor row lock, in the same transaction as the raw reading. */
export async function accountUsage(tx: DbTransaction, reading: Telemetry, features?: FeatureStates, checks?: PersistenceChecks): Promise<AlertNotification[]> {
  if (!Object.values(USAGE_METRICS).includes(reading.metric as typeof USAGE_METRICS[keyof typeof USAGE_METRICS])) return [];
  const time = new Date(reading.timestamp);
  if (time.getTime() > Date.now() + 60_000) return [];
  const profiles = await tx.select().from(monitoringProfiles).where(and(eq(monitoringProfiles.deviceId, reading.deviceId), eq(monitoringProfiles.buildingId, reading.buildingId), eq(monitoringProfiles.enabled, true))).for("update");
  if (!profiles.length) return [];
  const [building] = await tx.select().from(buildings).where(eq(buildings.id, reading.buildingId)).limit(1);
  if (!building?.active) return [];
  features ??= await readFeatures(tx, reading.buildingId);
  const notifications: AlertNotification[] = [];
  for (const profile of profiles) {
    if (reading.metric !== USAGE_METRICS[profile.kind]) continue;
    const feature = kindFeature(profile.kind);
    if (!permitsFeature(features, feature, time)) continue;
    const resumedAt = features[feature].resumedAt ? new Date(features[feature].resumedAt!) : null;
    if (profile.kind === "PUMP" ? typeof reading.value !== "boolean" : typeof reading.value !== "number") continue;
    const [cursor] = await tx.select().from(usageCursors).where(eq(usageCursors.profileId, profile.id)).limit(1);
    const next = advanceUsage(cursor && (!resumedAt || cursor.lastAt > resumedAt) ? { time: cursor.lastAt, value: profile.kind === "PUMP" ? cursor.lastValue === 1 : cursor.lastValue, good: cursor.good, continuousSeconds: cursor.continuousSeconds } : null,
      { time, value: reading.value as number | boolean, quality: reading.quality }, { kind: profile.kind, timezone: building.timezone, maxGapSeconds: profile.maxGapSeconds, tariff: profile.tariff });
    if (next.ignored) continue;
    for (const part of next.parts) {
      const [old] = await tx.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profile.id), eq(dailyUsage.day, part.day))).limit(1);
      const cost = !old || old.coveredSeconds === 0 ? part.estimatedCost : part.coveredSeconds === 0 ? old.estimatedCost
        : old.estimatedCost === null || part.estimatedCost === null ? null : old.estimatedCost + part.estimatedCost;
      const values = { profileId: profile.id, buildingId: profile.buildingId, day: part.day,
        incomplete: (old?.incomplete ?? false) || (!!resumedAt && part.day === dayKey(resumedAt, building.timezone)),
        quantity: (old?.quantity ?? 0) + part.quantity, estimatedCost: cost,
        coveredSeconds: (old?.coveredSeconds ?? 0) + part.coveredSeconds, resets: (old?.resets ?? 0) + part.resets,
        samples: (old?.samples ?? 0) + 1, firstAt: old?.firstAt ?? part.firstAt, lastAt: part.lastAt };
      const written = await tx.insert(dailyUsage).values(values).onConflictDoUpdate({ target: [dailyUsage.profileId, dailyUsage.day], set: values }).returning();
      assertPersisted(written.length === 1 ? written[0] : undefined, values, "Daily usage");
      const [persisted] = await tx.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profile.id), eq(dailyUsage.day, part.day))).limit(1);
      assertPersisted(persisted, values, "Daily usage");
      checks?.remember(`daily:${profile.id}:${part.day}`, async () => {
        const [persisted] = await tx.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profile.id), eq(dailyUsage.day, part.day))).limit(1);
        assertPersisted(persisted, values, "Daily usage");
      });
    }
    const cursorValues = { profileId: profile.id, buildingId: profile.buildingId,
      lastAt: next.state.time, lastValue: Number(next.state.value), good: next.state.good, continuousSeconds: next.state.continuousSeconds };
    const cursors = await tx.insert(usageCursors).values(cursorValues).onConflictDoUpdate({ target: usageCursors.profileId, set: cursorValues }).returning();
    assertPersisted(cursors.length === 1 ? cursors[0] : undefined, cursorValues, "Usage cursor");
    const [persistedCursor] = await tx.select().from(usageCursors).where(eq(usageCursors.profileId, profile.id)).limit(1);
    assertPersisted(persistedCursor, cursorValues, "Usage cursor");
    checks?.remember(`cursor:${profile.id}`, async () => {
      const [persisted] = await tx.select().from(usageCursors).where(eq(usageCursors.profileId, profile.id)).limit(1);
      assertPersisted(persisted, cursorValues, "Usage cursor");
    });

    // Backfilled history trains the model, but must not page somebody about an old incident.
    if (reading.quality !== "GOOD" || Date.now() - time.getTime() > 300_000) continue;
    const key = dayKey(time, building.timezone), bounds = dayBounds(key, building.timezone);
    const [today] = await tx.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profile.id), eq(dailyUsage.day, key))).limit(1);
    if (!today || today.coveredSeconds <= 0) continue;
    async function emit(type: string, value: number, message: string) {
      const [existing] = await tx.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.buildingId, profile.buildingId), eq(alerts.deviceId, profile.deviceId), eq(alerts.type, type), gte(alerts.triggeredAt, bounds.start), lt(alerts.triggeredAt, bounds.end))).limit(1);
      if (existing) return;
      notifications.push(await persistAlert(tx, { buildingId: profile.buildingId, deviceId: profile.deviceId, severity: "HIGH", type, message, triggeredValue: value, triggeredAt: time }, checks));
    }
    const label = { ENERGY: "Energia", WATER: "Água", PUMP: "Bomba" }[profile.kind], unit = USAGE_UNITS[profile.kind];
    if (profile.dailyLimit !== null && today.quantity > profile.dailyLimit) await emit(`DAILY_${profile.kind}_LIMIT`, today.quantity,
      `${label}: ${today.quantity.toFixed(2)} ${unit} acumulados em ${key}; limite diário ${profile.dailyLimit} ${unit}. Verifique a operação.`);
    if (profile.dailyCostLimit !== null && today.estimatedCost !== null && today.estimatedCost > profile.dailyCostLimit) await emit(`DAILY_${profile.kind}_COST`, today.estimatedCost,
      `${label}: custo estimado de R$ ${today.estimatedCost.toFixed(2)} em ${key}; limite R$ ${profile.dailyCostLimit.toFixed(2)}. A estimativa usa a tarifa configurada.`);
    if (profile.kind === "PUMP" && profile.continuousLimitMinutes !== null && next.peakContinuousSeconds / 60 > profile.continuousLimitMinutes) await emit("PUMP_CONTINUOUS_LIMIT", next.peakContinuousSeconds / 60,
      `Bomba: ${Math.round(next.peakContinuousSeconds / 60)} minutos no ciclo contínuo; limite ${profile.continuousLimitMinutes} minutos.`);
    if (profile.adaptiveEnabled && !today.incomplete && permitsFeature(features, "AI_ANALYSIS", time)) {
      const startKey = new Date(Date.parse(`${key}T12:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
      const history = await tx.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profile.id), gte(dailyUsage.day, startKey), lt(dailyUsage.day, key))).orderBy(desc(dailyUsage.day)).limit(28);
      const training = history.filter(row => { const b = dayBounds(row.day, building.timezone); return !row.incomplete && row.resets === 0 && row.coveredSeconds >= (b.end.getTime() - b.start.getTime()) / 1000 * 0.8; });
      const model = learnReference(training.map(row => row.quantity), profile.minimumHistoryDays);
      if (model) {
        const result = assessDeviation(today.quantity, model, profile.deviationPercent);
        if (result.anomalous) await emit(`ADAPTIVE_${profile.kind}_ANOMALY`, today.quantity,
          `${label} fora do histórico: ${today.quantity.toFixed(2)} ${unit} hoje; referência aprendida ${model.expected.toFixed(2)} ${unit}/dia em ${model.samples} dias válidos. ${result.changePercent === null ? "Aumento sobre referência zero." : `Aumento de ${result.changePercent.toFixed(0)}%.`} Investigue a causa.`);
      }
    }
  }
  return notifications;
}
