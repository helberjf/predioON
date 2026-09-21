import type { Device, LatestReading } from "./types.js";

type Sensor = Pick<Device, "id" | "name" | "type" | "enabled">;
export type SensorChoice = { value: string; label: string };
export type HistoryBucket = "5m" | "1h" | "1d";
export const HISTORY_PERIODS = [
  { value: "5m" as const, label: "Últimas 6 horas" },
  { value: "1h" as const, label: "Últimas 24 horas" },
  { value: "1d" as const, label: "Últimos 30 dias" },
];

export function sensorChoices(readings: LatestReading[], metrics: readonly string[], devices: Sensor[] = [], types: readonly string[] = []): SensorChoice[] {
  const names = new Map<string, string>();
  for (const reading of readings) {
    if (metrics.includes(reading.metric)) names.set(reading.device_id, reading.device_name);
  }
  for (const device of devices) {
    if (types.includes(device.type) || names.has(device.id)) names.set(device.id, `${device.name}${device.enabled ? "" : " (desativado)"}`);
  }
  return [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function findReading(readings: LatestReading[], deviceId: string, metric: string): LatestReading | undefined {
  return readings.find((reading) => reading.device_id === deviceId && reading.metric === metric);
}

export function numericReading(reading?: LatestReading): number | null {
  if (!reading || reading.quality !== "GOOD" || reading.numeric_value === null || reading.numeric_value === undefined) return null;
  const value = Number(reading.numeric_value);
  return Number.isFinite(value) ? value : null;
}

export function booleanReading(reading?: LatestReading): boolean | null {
  if (!reading || reading.quality !== "GOOD") return null;
  if (reading.value === true || reading.value === 1 || reading.value === "true") return true;
  if (reading.value === false || reading.value === 0 || reading.value === "false") return false;
  return null;
}

/** A display freshness threshold, not an alarm rule or a declaration of equipment health. */
export function readingStatus(reading?: LatestReading, now = Date.now()): string {
  if (!reading) return "Sem leitura";
  if (reading.quality !== "GOOD") return "Leitura não validada";
  const time = new Date(reading.time.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime();
  if (!Number.isFinite(time)) return "Horário indisponível";
  return now - time > 15 * 60_000 ? "Leitura antiga" : "Leitura recente";
}

/** The caller owns the interval anchor; rerendering must never create another request URL. */
export function seriesPath(deviceId: string, metric: string, bucket: HistoryBucket, anchor: number): string | null {
  if (!deviceId) return null;
  const hours = { "5m": 6, "1h": 24, "1d": 720 }[bucket];
  const query = new URLSearchParams({ deviceId, metric, bucket,
    from: new Date(anchor - hours * 3_600_000).toISOString(), to: new Date(anchor).toISOString() });
  return `/telemetry/series?${query}`;
}
