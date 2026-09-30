import { z } from "zod";

export const FEATURE_KEYS = ["WATER_TANK", "WATER_CONSUMPTION", "ENERGY_CONSUMPTION", "ELECTRICAL", "PUMP", "WATER_LEAK", "SEWAGE_LEAK", "SMOKE", "TEMPERATURE", "GAS", "AI_ANALYSIS", "GARAGE_ACCESS", "PEDESTRIAN_ACCESS", "CAR_PARKING", "MOTORCYCLE_PARKING", "NOTICES", "RESERVATIONS", "TICKETS", "TICKET_GROUPING", "TICKET_PRIORITY", "TRANSPARENCY", "FINANCE", "REMOTE_SUPPORT"] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];
export const FeatureKeySchema = z.enum(FEATURE_KEYS);
export const FeatureUpdateSchema = z.object({ enabled: z.boolean().nullable(), version: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(1000) }).strict();
export type FeatureDefinition = { key: FeatureKey; label: string; group: string; dependencies: FeatureKey[] };
export const FEATURE_CATALOG: FeatureDefinition[] = [
  ...([
    ["WATER_TANK", "Caixa d’água"], ["WATER_CONSUMPTION", "Consumo de água"], ["ENERGY_CONSUMPTION", "Consumo de energia"],
    ["ELECTRICAL", "Fases e parâmetros elétricos"], ["PUMP", "Bomba"], ["WATER_LEAK", "Vazamento de água"],
    ["SEWAGE_LEAK", "Vazamento de esgoto"], ["SMOKE", "Fumaça"], ["TEMPERATURE", "Temperatura"], ["GAS", "Gás"], ["AI_ANALYSIS", "Análise de desvios por IA"],
  ] as const).map(([key, label]) => ({ key, label, group: "Monitoramento", dependencies: [] })),
  ...([
    ["GARAGE_ACCESS", "Portão da garagem"], ["PEDESTRIAN_ACCESS", "Portão de pedestres"], ["CAR_PARKING", "Vagas de carros"], ["MOTORCYCLE_PARKING", "Vagas de motos"],
  ] as const).map(([key, label]) => ({ key, label, group: "Acessos e vagas", dependencies: [] })),
  ...([
    ["NOTICES", "Avisos"], ["RESERVATIONS", "Reservas de áreas comuns"], ["TICKETS", "Chamados"],
  ] as const).map(([key, label]) => ({ key, label, group: "Rotina", dependencies: [] })),
  { key: "TICKET_GROUPING", label: "Agrupamento de chamados", group: "Atendimento", dependencies: ["TICKETS"] },
  { key: "TICKET_PRIORITY", label: "Gravidade dos chamados", group: "Atendimento", dependencies: ["TICKETS"] },
  ...([
    ["TRANSPARENCY", "Transparência da gestão"], ["FINANCE", "Prestação de contas"], ["REMOTE_SUPPORT", "Suporte remoto"],
  ] as const).map(([key, label]) => ({ key, label, group: "Administração", dependencies: [] })),
];

export type FeatureSetting = { key: FeatureKey; enabled: boolean | null; version: number };
export type FeatureState = {
  key: FeatureKey; enabled: boolean; globalEnabled: boolean; localEnabled: boolean | null;
  blockedBy: string | null; version: number; globalVersion: number; resumedAt: string | null;
};
export type FeatureStates = Record<FeatureKey, FeatureState>;

/** Global disable is a ceiling. Local intent survives global changes. Catalog order is topological. */
export function resolveFeatures(global: FeatureSetting[], local: FeatureSetting[]): FeatureStates {
  const result = {} as FeatureStates;
  for (const definition of FEATURE_CATALOG) {
    const g = global.find(row => row.key === definition.key), b = local.find(row => row.key === definition.key);
    const globalEnabled = g?.enabled ?? true, localEnabled = b?.enabled ?? null;
    const blockedBy = !globalEnabled ? "GLOBAL" : localEnabled === false ? "BUILDING"
      : definition.dependencies.find(key => !result[key].enabled) ?? null;
    result[definition.key] = { key: definition.key, enabled: blockedBy === null, globalEnabled, localEnabled,
      blockedBy, version: b?.version ?? 0, globalVersion: g?.version ?? 0, resumedAt: null };
  }
  return result;
}

const METRICS: Record<string, FeatureKey> = {
  water_level_percent: "WATER_TANK", volume_liters: "WATER_TANK", distance_mm: "WATER_TANK",
  water_total_m3: "WATER_CONSUMPTION", energy_total_kwh: "ENERGY_CONSUMPTION", pump_running: "PUMP",
  voltage_l1: "ELECTRICAL", voltage_l2: "ELECTRICAL", voltage_l3: "ELECTRICAL", current_l1: "ELECTRICAL", current_l2: "ELECTRICAL", current_l3: "ELECTRICAL", frequency_hz: "ELECTRICAL",
  temperature_c: "TEMPERATURE", gas_detected: "GAS", gas_ppm: "GAS", smoke_detected: "SMOKE",
  water_leak_detected: "WATER_LEAK", leak_detected: "WATER_LEAK", sewage_leak_detected: "SEWAGE_LEAK",
};
export function metricFeature(metric: string, vehicleType?: string): FeatureKey | null {
  if (metric === "parking_occupied") return vehicleType === "CAR" || vehicleType === "MOTORCYCLE" ? parkingFeature(vehicleType) : null;
  return Object.hasOwn(METRICS, metric) ? METRICS[metric]! : null;
}
export function kindFeature(kind: "WATER" | "ENERGY" | "PUMP"): FeatureKey {
  return { WATER: "WATER_CONSUMPTION", ENERGY: "ENERGY_CONSUMPTION", PUMP: "PUMP" }[kind] as FeatureKey;
}
export function gateFeature(kind: string): FeatureKey { return kind === "GARAGE" ? "GARAGE_ACCESS" : "PEDESTRIAN_ACCESS"; }
export function parkingFeature(vehicleType: string): FeatureKey { return vehicleType === "CAR" ? "CAR_PARKING" : "MOTORCYCLE_PARKING"; }
const DEVICES: Record<string, FeatureKey[]> = {
  WATER_LEVEL_SENSOR: ["WATER_TANK"], WATER_METER: ["WATER_CONSUMPTION"], ENERGY_METER: ["ENERGY_CONSUMPTION", "ELECTRICAL"],
  PUMP_MONITOR: ["PUMP"], PHASE_MONITOR: ["ELECTRICAL"], LEAK_SENSOR: ["WATER_LEAK"], SEWAGE_LEAK_SENSOR: ["SEWAGE_LEAK"],
  GAS_SENSOR: ["GAS"], TEMPERATURE_SENSOR: ["TEMPERATURE"], SMOKE_PANEL_RELAY: ["SMOKE"],
  GARAGE_GATE: ["GARAGE_ACCESS"], PEDESTRIAN_GATE: ["PEDESTRIAN_ACCESS"], GATE_CONTROLLER: ["GARAGE_ACCESS", "PEDESTRIAN_ACCESS"],
  PARKING_SENSOR: ["CAR_PARKING", "MOTORCYCLE_PARKING"],
};
export function deviceFeatures(type: string): FeatureKey[] { return Object.hasOwn(DEVICES, type) ? [...DEVICES[type]!] : []; }
