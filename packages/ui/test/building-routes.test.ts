import assert from "node:assert/strict";
import { test } from "node:test";
import type { BuildingOverview } from "@predioon/contracts";
import { ROLE_CAPABILITIES } from "../../shared/src/rbac.ts";
import { buildingRouteAllowed, buildingRoutesNeedCoverage, type BuildingRouteScope } from "../src/building-routes.ts";

// Every route the condominium portal declares in apps/building-web/src/App.tsx.
const ROUTES = ["/", "/alertas", "/agua", "/energia", "/consumo", "/sensores", "/dispositivos", "/acessos", "/vagas", "/chamados", "/ordens-servico", "/ativos",
  "/avisos", "/areas", "/transparencia", "/unidades-equipes", "/regras", "/automacoes", "/auditoria", "/acesso-suporte", "/sessoes"];
const none: BuildingOverview["coverage"] = { devices: "none", gateways: "none", alerts: "none", telemetry: "none", occurrences: "partial" };
const offered = (scope: BuildingRouteScope) => ROUTES.filter(path => buildingRouteAllowed(path, scope));

test("a resident is offered only the community pages, never readings, equipment or administration", () => {
  const resident = { capabilities: ROLE_CAPABILITIES.RESIDENT, coverage: none, gatesListed: false };
  assert.deepEqual(offered(resident), ["/", "/vagas", "/chamados", "/avisos", "/areas", "/transparencia", "/sessoes"]);
  // Gates appear only when the administration released one to residents.
  assert.deepEqual(offered({ ...resident, gatesListed: true }), ["/", "/acessos", "/vagas", "/chamados", "/avisos", "/areas", "/transparencia", "/sessoes"]);
  // Without the summary nothing is promoted either.
  assert.deepEqual(offered({ ...resident, coverage: null }), offered(resident));
});

test("the building administrator keeps every page", () => {
  const capabilities = ROLE_CAPABILITIES.BUILDING_ADMIN;
  assert.equal(buildingRoutesNeedCoverage(capabilities), false);
  assert.deepEqual(offered({ capabilities, coverage: null, gatesListed: false }), ROUTES);
});

test("maintenance staff keep monitoring and their work, not the administration", () => {
  const scope = { capabilities: ROLE_CAPABILITIES.MAINTENANCE, coverage: null, gatesListed: false };
  for (const path of ["/agua", "/energia", "/consumo", "/sensores", "/dispositivos", "/alertas", "/ordens-servico", "/ativos", "/automacoes"]) assert.equal(buildingRouteAllowed(path, scope), true, path);
  for (const path of ["/unidades-equipes", "/regras", "/auditoria", "/acesso-suporte", "/acessos"]) assert.equal(buildingRouteAllowed(path, scope), false, path);
  assert.equal(buildingRouteAllowed("/unidades-equipes", { ...scope, capabilities: ROLE_CAPABILITIES.MAINTENANCE_MANAGER }), true);
});

test("a grant on single devices or alerts reaches its pages through the summary coverage", () => {
  const scope = { capabilities: [], coverage: { ...none, telemetry: "partial", devices: "partial" }, gatesListed: false } satisfies BuildingRouteScope;
  assert.equal(buildingRoutesNeedCoverage(scope.capabilities), true);
  for (const path of ["/agua", "/energia", "/consumo", "/sensores", "/dispositivos"]) assert.equal(buildingRouteAllowed(path, scope), true, path);
  assert.equal(buildingRouteAllowed("/alertas", scope), false);
  assert.equal(buildingRouteAllowed("/alertas", { ...scope, coverage: { ...scope.coverage, alerts: "partial" } }), true);
  assert.equal(buildingRouteAllowed("/dispositivos", { ...scope, coverage: { ...none, gateways: "whole" } }), true);
});

test("paths are normalized and unknown routes are never offered", () => {
  const scope = { capabilities: ROLE_CAPABILITIES.BUILDING_ADMIN, coverage: null, gatesListed: false };
  assert.equal(buildingRouteAllowed("/agua/?dia=1#topo", scope), true);
  assert.equal(buildingRouteAllowed("", scope), true);
  assert.equal(buildingRouteAllowed("/funcionalidades", scope), false);
  assert.equal(buildingRouteAllowed("/agua", { capabilities: [], coverage: null, gatesListed: true }), false);
});
