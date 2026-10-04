import { and, eq, gt, isNull, or } from "drizzle-orm";
import { alertRules, alerts, type DbTransaction } from "@predioon/db";
import { persistAlert, type AlertNotification, type PersistenceChecks } from "../notify/index.js";

type Reading = { buildingId: string; deviceId: string; metric: string; value: number; time: Date };

export function matches(operator: string, current: number, threshold: number): boolean {
  switch (operator) {
    case "LT": return current < threshold;
    case "LTE": return current <= threshold;
    case "GT": return current > threshold;
    case "GTE": return current >= threshold;
    case "EQ": return current === threshold;
    case "NEQ": return current !== threshold;
    default: return false;
  }
}

/**
 * Evaluates every enabled rule for the metric and creates the alerts that fire.
 * `cooldownSeconds` stops a sensor oscillating around the threshold from flooding the panel.
 */
export async function evaluateRules(tx: DbTransaction, reading: Reading, checks?: PersistenceChecks): Promise<AlertNotification[]> {
  const rules = await tx
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.buildingId, reading.buildingId),
        eq(alertRules.metric, reading.metric),
        eq(alertRules.enabled, true),
        or(isNull(alertRules.deviceId), eq(alertRules.deviceId, reading.deviceId)),
      ),
    );

  const created: AlertNotification[] = [];

  for (const rule of rules) {
    if (!matches(rule.operator, reading.value, rule.threshold)) continue;

    const cooldownFrom = new Date(Date.now() - rule.cooldownSeconds * 1000);
    const [recent] = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.ruleId, rule.id), gt(alerts.triggeredAt, cooldownFrom)))
      .limit(1);
    if (recent) continue;

    const message = rule.messageTemplate.replaceAll("{value}", String(reading.value));
    created.push(await persistAlert(tx, {
      buildingId: reading.buildingId,
      deviceId: reading.deviceId,
      ruleId: rule.id,
      severity: rule.severity,
      type: rule.alertType,
      message,
      triggeredValue: reading.value,
      triggeredAt: reading.time,
    }, checks));
  }

  return created;
}
