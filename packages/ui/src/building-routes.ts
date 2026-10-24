import type { BuildingOverview, OverviewCoverage } from "@predioon/contracts";
import type { Capability } from "@predioon/shared";

/**
 * What the condominium portal may offer in one building. Navigation evidence
 * only: every page keeps asking its own API, which remains the boundary.
 */
export type BuildingRouteScope = {
  /** Whole-building capabilities from /v1/authorization; resource grants are not promoted here. */
  capabilities: readonly Capability[];
  /** Coverage from /overview/building, which also counts grants on single devices or alerts. null when not read. */
  coverage: BuildingOverview["coverage"] | null;
  /** /access listed a gate: the API leaves out every gate not released to this account. */
  gatesListed: boolean;
};
type Rule = (scope: BuildingRouteScope) => boolean;

const has = (...keys: Capability[]): Rule => scope => keys.some(key => scope.capabilities.includes(key));
const reaches = (domain: keyof BuildingOverview["coverage"]): Rule => scope => {
  const coverage: OverviewCoverage | undefined = scope.coverage?.[domain];
  return coverage === "whole" || coverage === "partial";
};
const either = (...rules: Rule[]): Rule => scope => rules.some(rule => rule(scope));
const always: Rule = () => true;
const readings = either(has("telemetry:read"), reaches("telemetry"));

/**
 * One rule per route of the condominium portal. A resident holds only the
 * community grants, so readings, equipment, maintenance and administration
 * stay out of reach; staff with grants on single devices keep what they reach.
 */
const RULES: Record<string, Rule> = {
  "/": always,
  "/sessoes": always,
  "/alertas": either(has("alerts:read"), reaches("alerts")),
  "/agua": readings,
  "/energia": readings,
  "/consumo": readings,
  "/sensores": readings,
  "/dispositivos": either(has("devices:read"), reaches("devices"), reaches("gateways")),
  "/acessos": scope => has("gates:manage")(scope) || scope.gatesListed,
  "/vagas": has("parking:read", "parking:manage"),
  "/chamados": has("occurrences:read-own", "occurrences:manage"),
  "/ordens-servico": has("work-orders:assign", "work-orders:read-assigned"),
  "/ativos": has("devices:read"),
  "/avisos": has("notices:read", "notices:manage"),
  "/areas": has("common-areas:read"),
  "/transparencia": has("finance:read-published", "finance:read", "notices:read"),
  // units:read alone is a resident's own unit, not the building's directory.
  "/unidades-equipes": has("units:manage", "teams:read", "memberships:read"),
  "/regras": has("alert-rules:read"),
  "/automacoes": has("automations:read"),
  "/auditoria": has("audit:read"),
  "/acesso-suporte": has("support:read"),
};

/** Whole-building grants decide alone when they already cover every reading, equipment and alert. */
export function buildingRoutesNeedCoverage(capabilities: readonly Capability[]): boolean {
  return !(["telemetry:read", "devices:read", "alerts:read"] as const).every(key => capabilities.includes(key));
}

/** An unknown route is never offered. */
export function buildingRouteAllowed(path: string, scope: BuildingRouteScope): boolean {
  const pathname = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return RULES[pathname]?.(scope) ?? false;
}
