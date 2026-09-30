import type { FeatureKey, FeatureState } from "@predioon/shared";

export const ROUTE_FEATURES: Record<string, FeatureKey[]> = {
  "/agua": ["WATER_TANK", "WATER_CONSUMPTION", "PUMP"], "/energia": ["ELECTRICAL", "ENERGY_CONSUMPTION"],
  "/consumo": ["WATER_CONSUMPTION", "ENERGY_CONSUMPTION", "PUMP"],
  "/sensores": ["WATER_LEAK", "SEWAGE_LEAK", "SMOKE", "TEMPERATURE", "GAS"],
  "/acessos": ["GARAGE_ACCESS", "PEDESTRIAN_ACCESS"], "/vagas": ["CAR_PARKING", "MOTORCYCLE_PARKING"],
  "/avisos": ["NOTICES"], "/reservas": ["RESERVATIONS"], "/areas": ["RESERVATIONS"], "/chamados": ["TICKETS"],
  "/transparencia": ["TRANSPARENCY", "FINANCE"], "/suporte-remoto": ["REMOTE_SUPPORT"],
  "/operacao": ["WATER_CONSUMPTION", "ENERGY_CONSUMPTION", "PUMP", "GARAGE_ACCESS", "PEDESTRIAN_ACCESS", "CAR_PARKING", "MOTORCYCLE_PARKING"],
};
export function featureEnabled(items: readonly FeatureState[] | null, key: FeatureKey): boolean {
  return items?.some(item => item.key === key && item.enabled === true) ?? false;
}
export function featureRouteAllowed(path: string, items: readonly FeatureState[] | null): boolean {
  const keys = path === "/#monitoramento" ? ["WATER_TANK" as const] : ROUTE_FEATURES[path.split(/[?#]/)[0]!];
  return !keys || keys.some(key => featureEnabled(items, key));
}
export function featureRevision(items: readonly FeatureState[]): string {
  return items.map(item => `${item.key}:${item.enabled}:${item.version}:${item.globalVersion}:${item.resumedAt ?? ""}`).sort().join("|");
}
export const USAGE_FEATURES: Record<string, FeatureKey> = { WATER: "WATER_CONSUMPTION", ENERGY: "ENERGY_CONSUMPTION", PUMP: "PUMP" };
export const ACCESS_FEATURES: Record<string, FeatureKey> = { GARAGE: "GARAGE_ACCESS", PEDESTRIAN: "PEDESTRIAN_ACCESS" };
export const PARKING_FEATURES: Record<string, FeatureKey> = { CAR: "CAR_PARKING", MOTORCYCLE: "MOTORCYCLE_PARKING" };
export function ticketFeatureInput(input: Record<string, unknown>, items: readonly FeatureState[] | null, creating = false): Record<string, unknown> {
  const result = { ...input };
  if (!featureEnabled(items, "TICKET_GROUPING")) result.applyToGroup = false;
  if (!featureEnabled(items, "TICKET_PRIORITY")) {
    delete result.priority; delete result.priorityReason;
    if (creating) result.priority = "NORMAL";
  }
  return result;
}
export function readingFeature(metric: string): FeatureKey | null {
  if (["water_level_percent", "distance_mm", "volume_liters"].includes(metric)) return "WATER_TANK";
  if (["water_consumption_m3", "water_total_m3", "water_m3", "water_flow_m3h"].includes(metric)) return "WATER_CONSUMPTION";
  if (["energy_kwh", "energy_total_kwh", "power_kw"].includes(metric)) return "ENERGY_CONSUMPTION";
  if (metric === "frequency_hz" || metric.startsWith("voltage_") || metric.startsWith("current_") || metric.startsWith("phase_")) return "ELECTRICAL";
  if (metric === "pump_running") return "PUMP";
  if (["leak_detected", "water_leak_detected"].includes(metric)) return "WATER_LEAK";
  if (metric === "sewage_leak_detected") return "SEWAGE_LEAK";
  if (metric === "smoke_detected") return "SMOKE";
  if (metric === "temperature_c") return "TEMPERATURE";
  if (metric.startsWith("gas_")) return "GAS";
  return null;
}
export function monitoringFeatureInput(input: Record<string, unknown>, items: readonly FeatureState[] | null): Record<string, unknown> {
  const result = { ...input };
  if (!featureEnabled(items, "AI_ANALYSIS")) {
    delete result.adaptiveEnabled; delete result.minimumHistoryDays; delete result.deviationPercent;
  }
  return result;
}
