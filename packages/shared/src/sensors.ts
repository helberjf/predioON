/** Canonical gateway metrics. Bounds validate the transport, not alarm thresholds. */
export type SensorMetricDefinition = {
  label: string;
  dataType: "number" | "boolean";
  unit?: string;
  min?: number;
  max?: number;
  decimals: number;
};

export const SENSOR_METRICS = {
  water_level_percent: { label: "Nível do reservatório", dataType: "number", unit: "%", min: 0, max: 100, decimals: 1 },
  volume_liters: { label: "Volume de água", dataType: "number", unit: "L", min: 0, decimals: 0 },
  distance_mm: { label: "Distância medida", dataType: "number", unit: "mm", min: 0, decimals: 0 },
  water_total_m3: { label: "Hidrômetro acumulado", dataType: "number", unit: "m³", min: 0, decimals: 3 },
  energy_total_kwh: { label: "Energia acumulada", dataType: "number", unit: "kWh", min: 0, decimals: 3 },
  pump_running: { label: "Bomba ligada", dataType: "boolean", decimals: 0 },
  voltage_l1: { label: "Tensão L1", dataType: "number", unit: "V", min: 0, max: 1000, decimals: 1 },
  voltage_l2: { label: "Tensão L2", dataType: "number", unit: "V", min: 0, max: 1000, decimals: 1 },
  voltage_l3: { label: "Tensão L3", dataType: "number", unit: "V", min: 0, max: 1000, decimals: 1 },
  current_l1: { label: "Corrente L1", dataType: "number", unit: "A", min: 0, max: 100000, decimals: 2 },
  current_l2: { label: "Corrente L2", dataType: "number", unit: "A", min: 0, max: 100000, decimals: 2 },
  current_l3: { label: "Corrente L3", dataType: "number", unit: "A", min: 0, max: 100000, decimals: 2 },
  frequency_hz: { label: "Frequência da rede", dataType: "number", unit: "Hz", min: 0, max: 100, decimals: 2 },
  temperature_c: { label: "Temperatura", dataType: "number", unit: "°C", min: -273.15, max: 1000, decimals: 1 },
  gas_detected: { label: "Gás detectado", dataType: "boolean", decimals: 0 },
  gas_ppm: { label: "Concentração de gás", dataType: "number", unit: "ppm", min: 0, max: 1000000, decimals: 0 },
  smoke_detected: { label: "Alarme da central de incêndio", dataType: "boolean", decimals: 0 },
  water_leak_detected: { label: "Vazamento de água", dataType: "boolean", decimals: 0 },
  sewage_leak_detected: { label: "Vazamento de esgoto", dataType: "boolean", decimals: 0 },
  leak_detected: { label: "Vazamento de água (legado)", dataType: "boolean", decimals: 0 },
} as const satisfies Record<string, SensorMetricDefinition>;

export type SensorMetric = keyof typeof SENSOR_METRICS;

export function sensorMetricDefinition(metric: string): SensorMetricDefinition | undefined {
  return Object.hasOwn(SENSOR_METRICS, metric) ? SENSOR_METRICS[metric as SensorMetric] : undefined;
}

export const SENSOR_DEVICE_TYPES = [
  { value: "WATER_LEVEL_SENSOR", label: "Nível e volume de caixa d'água" },
  { value: "WATER_METER", label: "Hidrômetro de consumo" },
  { value: "ENERGY_METER", label: "Medidor de energia" },
  { value: "PUMP_MONITOR", label: "Monitor de bomba" },
  { value: "PHASE_MONITOR", label: "Monitor de fases" },
  { value: "LEAK_SENSOR", label: "Sensor de vazamento de água" },
  { value: "SEWAGE_LEAK_SENSOR", label: "Sensor de vazamento de esgoto" },
  { value: "GAS_SENSOR", label: "Detector de gás" },
  { value: "TEMPERATURE_SENSOR", label: "Sensor de temperatura" },
  { value: "SMOKE_PANEL_RELAY", label: "Relé da central de incêndio" },
] as const;

export type SensorReadingStatus = "missing" | "invalid" | "stale" | "disabled" | "detected" | "clear" | "reading";
type SensorReading = { value: unknown; quality: string; time: string };

/** UI freshness is independent of configurable alarm thresholds and equipment health. */
export function sensorReadingState(reading: SensorReading | undefined, now = Date.now(), enabled = true): { status: SensorReadingStatus; label: string } {
  if (!enabled) return { status: "disabled", label: "Sensor desativado" };
  if (!reading) return { status: "missing", label: "Sem leitura recebida" };
  const timestamp = Date.parse(reading.time.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (reading.quality !== "GOOD" || !Number.isFinite(timestamp) || timestamp > now + 60_000
    || !(typeof reading.value === "boolean" || (typeof reading.value === "number" && Number.isFinite(reading.value)))) {
    return { status: "invalid", label: "Leitura não validada" };
  }
  if (now - timestamp > 15 * 60_000) return { status: "stale", label: "Leitura antiga · estado atual desconhecido" };
  if (typeof reading.value === "number") return { status: "reading", label: "Leitura recente" };
  return reading.value ? { status: "detected", label: "Detecção ativa" } : { status: "clear", label: "Sem detecção nesta leitura" };
}
