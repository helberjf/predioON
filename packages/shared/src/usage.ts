/** Deterministic measurement accounting and an explainable, learned anomaly model. */
export type UsageKind = "ENERGY" | "WATER" | "PUMP";
export type UsagePolicy = { kind: UsageKind; timezone: string; maxGapSeconds: number; tariff: number | null };
export type UsageState = { time: Date; value: number | boolean; good: boolean; continuousSeconds: number };
export type UsagePart = { day: string; quantity: number; coveredSeconds: number; resets: number; estimatedCost: number | null; firstAt: Date; lastAt: Date };
export type UsageReading = { time: Date; value: number | boolean; quality: string };
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatterCache.set(timeZone, value);
  }
  return value;
}
function localParts(date: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(formatter(timezone).formatToParts(date).map(p => [p.type, p.value]));
}
export function dayKey(date: Date, timezone: string): string {
  const p = localParts(date, timezone); return `${p.year}-${p.month}-${p.day}`;
}
function localMidnight(key: string, timezone: string): Date {
  const target = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== key) throw new Error("Dia inválido");
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const p = localParts(new Date(guess), timezone);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const adjusted = guess + target - represented;
    if (adjusted === guess) break;
    guess = adjusted;
  }
  return new Date(guess);
}
export function dayBounds(key: string, timezone: string) {
  const next = new Date(Date.parse(`${key}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: localMidnight(key, timezone), end: localMidnight(next, timezone) };
}

export function advanceUsage(previous: UsageState | null, reading: UsageReading, policy: UsagePolicy) {
  const { time, value } = reading;
  if (!Number.isFinite(time.getTime())) throw new Error("Horário inválido");
  if (policy.kind === "PUMP" ? typeof value !== "boolean" : typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Leitura inválida");
  if (!Number.isFinite(policy.maxGapSeconds) || policy.maxGapSeconds <= 0) throw new Error("Intervalo inválido");
  if (policy.tariff !== null && (!Number.isFinite(policy.tariff) || policy.tariff < 0)) throw new Error("Tarifa inválida");
  if (previous && time <= previous.time) return { state: previous, parts: [] as UsagePart[], ignored: true, peakContinuousSeconds: previous.continuousSeconds };
  const good = reading.quality === "GOOD";
  const elapsed = previous ? (time.getTime() - previous.time.getTime()) / 1000 : 0;
  const reset = !!previous && policy.kind !== "PUMP" && good && previous.good && Number(value) < Number(previous.value);
  const known = !!previous && good && previous.good && elapsed <= policy.maxGapSeconds && !reset;
  const peakContinuousSeconds = policy.kind === "PUMP" && known && previous!.value === true ? previous!.continuousSeconds + elapsed : 0;
  const state: UsageState = { time, value, good, continuousSeconds: value === true ? peakContinuousSeconds : 0 };
  const amount = known ? policy.kind === "PUMP" ? previous!.value === true ? elapsed / 60 : 0 : Number(value) - Number(previous!.value) : 0;
  const parts: UsagePart[] = [];
  // A long outage must not create thousands of empty rows; absence remains unknown.
  let cursor = previous && elapsed <= 32 * 86400 ? previous.time : time;
  do {
    const day = dayKey(cursor, policy.timezone);
    const end = new Date(Math.min(dayBounds(day, policy.timezone).end.getTime(), time.getTime()));
    const seconds = Math.max(0, (end.getTime() - cursor.getTime()) / 1000);
    const quantity = elapsed > 0 ? amount * seconds / elapsed : 0;
    parts.push({ day, quantity, coveredSeconds: known ? seconds : 0, resets: reset && parts.length === 0 ? 1 : 0,
      estimatedCost: policy.tariff === null || policy.kind === "PUMP" ? null : quantity * policy.tariff, firstAt: cursor, lastAt: end });
    if (end >= time) break;
    if (end <= cursor) throw new Error("Fuso sem progresso no intervalo");
    cursor = end;
  } while (parts.length <= 33);
  return { state, parts, ignored: false, peakContinuousSeconds };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export type LearnedReference = { method: "robust-history-v1"; expected: number; scale: number; samples: number };
/** Robust unsupervised fit: median and median absolute deviation, resistant to a few abnormal days. */
export function learnReference(history: number[], minimum = 7): LearnedReference | null {
  const valid = history.filter(v => Number.isFinite(v) && v >= 0);
  if (valid.length < minimum) return null;
  const expected = median(valid);
  const mad = median(valid.map(v => Math.abs(v - expected)));
  return { method: "robust-history-v1", expected, scale: Math.max(mad * 1.4826, expected * 0.1, 0.1), samples: valid.length };
}
export function assessDeviation(current: number, reference: LearnedReference, minimumPercent = 50) {
  const score = (current - reference.expected) / reference.scale;
  const changePercent = reference.expected > 0 ? (current / reference.expected - 1) * 100 : null;
  return { anomalous: score >= 3 && current > reference.expected * (1 + minimumPercent / 100), score, changePercent, expected: reference.expected };
}
