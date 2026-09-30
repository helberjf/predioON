import assert from "node:assert/strict";
import { it } from "node:test";
import * as shared from "@predioon/shared";

it("feature catalog covers independent controls and preserves default availability", () => {
  assert.equal(typeof shared.resolveFeatures, "function", "central resolver is required");
  const states = shared.resolveFeatures([], []);
  assert.equal(Object.keys(states).length, 23);
  assert.ok(Object.values(states).every(state => state.enabled));
});

it("global disable wins over local enable and local preference survives", () => {
  const local = [{ key: "GAS" as const, enabled: true, version: 3 }];
  const off = shared.resolveFeatures([{ key: "GAS", enabled: false, version: 1 }], local);
  assert.equal(off.GAS.enabled, false);
  assert.equal(off.GAS.localEnabled, true);
  assert.equal(off.GAS.blockedBy, "GLOBAL");
  assert.equal(shared.resolveFeatures([{ key: "GAS", enabled: true, version: 2 }], local).GAS.enabled, true);
});

it("ticket dependencies and source-independent finance resolve separately", () => {
  const states = shared.resolveFeatures([], [{ key: "TICKETS", enabled: false, version: 1 }, { key: "TRANSPARENCY", enabled: false, version: 1 }]);
  assert.equal(states.TICKET_GROUPING.enabled, false);
  assert.equal(states.TICKET_PRIORITY.blockedBy, "TICKETS");
  assert.equal(states.FINANCE.enabled, true);
  assert.equal(states.NOTICES.enabled, true);
});

it("metric mapping distinguishes mixed sensors and independent parking kinds", () => {
  assert.equal(shared.metricFeature("water_total_m3"), "WATER_CONSUMPTION");
  assert.equal(shared.metricFeature("water_level_percent"), "WATER_TANK");
  assert.equal(shared.metricFeature("leak_detected"), "WATER_LEAK");
  assert.equal(shared.metricFeature("parking_occupied", "MOTORCYCLE"), "MOTORCYCLE_PARKING");
  assert.equal(shared.metricFeature("parking_occupied"), null);
  assert.equal(shared.metricFeature("unknown_metric"), null);
});

it("updates validate scope, reason and optimistic version", () => {
  assert.equal(shared.FeatureUpdateSchema.safeParse({ enabled: null, version: 0, reason: "Configuração do condomínio" }).success, true);
  assert.equal(shared.FeatureUpdateSchema.safeParse({ enabled: false, version: 0, reason: " " }).success, false);
  assert.equal(shared.FeatureUpdateSchema.safeParse({ enabled: false, version: -1, reason: "Configuração do condomínio" }).success, false);
});
