// One short line saying when a rule raises an alert, for the sensor cards. Dependency-free
// so it can be unit tested on its own: the caller passes what it knows about the metric.
export type RuleSummaryInput = { operator: string; threshold: number; severity: string; cooldownSeconds: number; enabled: boolean; metric: string };
export type RuleMetricInfo = { label: string; dataType: string; unit?: string };

const OPERATORS: Record<string, string> = { LT: "abaixo de", LTE: "até", GT: "acima de", GTE: "a partir de", EQ: "igual a", NEQ: "diferente de" };
const SEVERITIES: Record<string, string> = { INFO: "informativo", LOW: "baixo", MEDIUM: "médio", HIGH: "alto", CRITICAL: "crítico" };

const number = (value: number) => String(value).replace(".", ",");

export function formatRuleInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${number(Math.round(seconds / 6) / 10)} min`.replace(",0 min", " min");
  return `${number(Math.round(seconds / 360) / 10)} h`.replace(",0 h", " h");
}

export function alertRuleSummary(rule: RuleSummaryInput, metric?: RuleMetricInfo): string {
  const severity = SEVERITIES[rule.severity] ?? rule.severity.toLowerCase();
  const detection = metric?.dataType === "boolean";
  const condition = detection
    ? rule.operator === "EQ" && rule.threshold === 1 ? "quando detectado" : `quando ${OPERATORS[rule.operator] ?? rule.operator} ${number(rule.threshold)}`
    : `${(metric?.label ?? rule.metric).toLowerCase()} ${OPERATORS[rule.operator] ?? rule.operator} ${number(rule.threshold)}${metric?.unit ? ` ${metric.unit}` : ""}`;
  const every = rule.cooldownSeconds > 0 ? ` · avisa de novo só após ${formatRuleInterval(rule.cooldownSeconds)}` : "";
  return `Alerta ${severity} ${condition}${every}${rule.enabled ? "" : " (regra desativada)"}`;
}
