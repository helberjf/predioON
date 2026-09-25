import assert from "node:assert/strict";
import test from "node:test";
import * as features from "../src/feature-state.ts";

const state = (key: string, enabled = true, version = 0) => ({ key, enabled, globalEnabled: true, localEnabled: null, blockedBy: null, version, globalVersion: 0, resumedAt: null });

test("availability fails closed for pending, failed, missing and disabled flags", () => {
  assert.equal(typeof features.featureEnabled, "function");
  assert.equal(features.featureEnabled(null, "NOTICES"), false);
  assert.equal(features.featureEnabled([], "NOTICES"), false);
  assert.equal(features.featureEnabled([state("NOTICES", false)], "NOTICES"), false);
  assert.equal(features.featureEnabled([state("NOTICES")], "NOTICES"), true);
});

test("mixed routes stay available only while an individual module is enabled", () => {
  assert.equal(typeof features.featureRouteAllowed, "function");
  assert.equal(features.featureRouteAllowed("/acessos", [state("PEDESTRIAN_ACCESS")]), true);
  assert.equal(features.featureRouteAllowed("/acessos", [state("NOTICES")]), false);
  assert.equal(features.featureRouteAllowed("/reservas?tab=minhas", [state("RESERVATIONS", false)]), false);
  assert.equal(features.featureRouteAllowed("/#monitoramento", [state("WATER_TANK", false)]), false);
  for (const path of ["/funcionalidades", "/dispositivos", "/gateways", "/auditoria", "/perfil"]) assert.equal(features.featureRouteAllowed(path, null), true);
});

test("flag fingerprints invalidate cached content when a version changes or reading resumes", () => {
  assert.equal(typeof features.featureRevision, "function");
  assert.equal(features.featureRevision([state("NOTICES"), state("PUMP")]), features.featureRevision([state("PUMP"), state("NOTICES")]));
  assert.notEqual(features.featureRevision([state("PUMP")]), features.featureRevision([state("PUMP", true, 2)]));
  assert.notEqual(features.featureRevision([state("PUMP")]), features.featureRevision([{ ...state("PUMP"), resumedAt: "2026-09-24T00:00:00Z" }]));
});

test("sensor readings and module variants use separate feature switches", () => {
  assert.equal(typeof features.readingFeature, "function");
  assert.equal(features.readingFeature("water_level_percent"), "WATER_TANK");
  assert.equal(features.readingFeature("water_consumption_m3"), "WATER_CONSUMPTION");
  assert.equal(features.readingFeature("voltage_l1"), "ELECTRICAL");
  assert.equal(features.readingFeature("energy_kwh"), "ENERGY_CONSUMPTION");
  assert.equal(features.readingFeature("pump_running"), "PUMP");
  assert.equal(features.readingFeature("leak_detected"), "WATER_LEAK");
  assert.equal(features.readingFeature("sewage_leak_detected"), "SEWAGE_LEAK");
});

test("ticket controls cannot submit priority or group actions when their flags are disabled", () => {
  assert.equal(typeof features.ticketFeatureInput, "function");
  const flags = [state("TICKETS")];
  assert.deepEqual(features.ticketFeatureInput({ title: "Portão", priority: "HIGH", applyToGroup: true }, flags, true), { title: "Portão", priority: "NORMAL", applyToGroup: false });
  assert.deepEqual(features.ticketFeatureInput({ status: "DONE", priority: "HIGH", priorityReason: "Avaliação", applyToGroup: true }, flags), { status: "DONE", applyToGroup: false });
});
test("editing base consumption with IA paused leaves stored analysis preferences untouched", () => {
  assert.equal(typeof features.monitoringFeatureInput, "function");
  assert.deepEqual(features.monitoringFeatureInput({ tariff: 1.2, adaptiveEnabled: false, minimumHistoryDays: 7, deviationPercent: 50 }, []), { tariff: 1.2 });
  const input = { tariff: 1.2, adaptiveEnabled: true, minimumHistoryDays: 7, deviationPercent: 50 };
  assert.deepEqual(features.monitoringFeatureInput(input, [state("AI_ANALYSIS")]), input);
});
