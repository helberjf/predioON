import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceUsage, dayKey, dayBounds, learnReference, assessDeviation } from "../../../packages/shared/src/usage.js";

const base = { kind: "ENERGY" as const, timezone: "America/Sao_Paulo", maxGapSeconds: 3600, tariff: 1 };
const reading = (time: string, value: number | boolean, quality: "GOOD" | "BAD" = "GOOD") => ({ time: new Date(time), value, quality });
test("counter deltas produce measured quantity and estimated cost", () => {
  const first = advanceUsage(null, reading("2026-09-22T12:00:00Z", 100), base);
  const next = advanceUsage(first.state, reading("2026-09-22T13:00:00Z", 150), base);
  assert.equal(next.parts[0]?.quantity, 50);
  assert.equal(next.parts[0]?.estimatedCost, 50);
  assert.equal(next.parts[0]?.coveredSeconds, 3600);
});
test("retransmission and out of order samples do not increase usage", () => {
  const first = advanceUsage(null, reading("2026-09-22T12:00:00Z", 100), base);
  for (const date of ["2026-09-22T12:00:00Z", "2026-09-22T11:00:00Z"]) {
    const next = advanceUsage(first.state, reading(date, 150), base);
    assert.equal(next.ignored, true);
    assert.equal(next.parts.length, 0);
    assert.deepEqual(next.state, first.state);
  }
});
test("meter resets and missing intervals never create negative or invented usage", () => {
  const first = advanceUsage(null, reading("2026-09-22T12:00:00Z", 100), base);
  const reset = advanceUsage(first.state, reading("2026-09-22T13:00:00Z", 5), base);
  assert.equal(reset.parts[0]?.quantity, 0);
  assert.equal(reset.parts[0]?.resets, 1);
  assert.equal(reset.parts[0]?.coveredSeconds, 0);
  const gap = advanceUsage(reset.state, reading("2026-09-22T16:00:00Z", 50), base);
  assert.equal(gap.parts.reduce((sum, p) => sum + p.quantity, 0), 0);
  assert.equal(gap.parts.reduce((sum, p) => sum + p.coveredSeconds, 0), 0);
});
test("bad quality breaks a continuous run and does not accrue pump time", () => {
  const policy = { ...base, kind: "PUMP" as const, tariff: null };
  const first = advanceUsage(null, reading("2026-09-22T12:00:00Z", true), policy);
  const bad = advanceUsage(first.state, reading("2026-09-22T12:10:00Z", true, "BAD"), policy);
  const next = advanceUsage(bad.state, reading("2026-09-22T12:20:00Z", true), policy);
  assert.equal(bad.parts[0]?.quantity, 0);
  assert.equal(next.state.continuousSeconds, 0);
});
test("pump counts several cycles and resets the continuous timer on OFF", () => {
  const policy = { ...base, kind: "PUMP" as const, tariff: null };
  let state = advanceUsage(null, reading("2026-09-22T12:00:00Z", true), policy).state;
  let total = 0;
  for (const [time, value] of [["2026-09-22T13:00:00Z", false], ["2026-09-22T13:30:00Z", true], ["2026-09-22T14:30:00Z", false]] as const) {
    const next = advanceUsage(state, reading(time, value), policy);
    total += next.parts.reduce((sum, p) => sum + p.quantity, 0); state = next.state;
  }
  assert.equal(total, 120);
  assert.equal(state.continuousSeconds, 0);
});
test("local midnight splits pump time between actual days", () => {
  const policy = { ...base, kind: "PUMP" as const, tariff: null };
  const first = advanceUsage(null, reading("2026-09-22T02:30:00Z", true), policy);
  const next = advanceUsage(first.state, reading("2026-09-22T03:30:00Z", true), policy);
  assert.deepEqual(next.parts.map(p => [p.day, p.quantity]), [["2026-09-21", 30], ["2026-09-22", 30]]);
  assert.equal(dayKey(new Date("2026-09-22T02:00:00Z"), base.timezone), "2026-09-21");
});
test("day boundaries support IANA timezones and daylight saving", () => {
  const bounds = dayBounds("2026-03-08", "America/New_York");
  assert.equal((bounds.end.getTime() - bounds.start.getTime()) / 3600000, 23);
});
test("learned reference needs seven valid days and ignores one extreme day", () => {
  assert.equal(learnReference([10, 10], 7), null);
  const model = learnReference([10, 11, 9, 10, 10, 10, 100], 7)!;
  assert.equal(model.expected, 10);
  const result = assessDeviation(50, model, 50);
  assert.equal(result.anomalous, true);
  assert.equal(result.changePercent, 400);
  assert.equal(assessDeviation(11, model, 50).anomalous, false);
});
test("unconfigured tariff remains unknown and invalid values are rejected", () => {
  const first = advanceUsage(null, reading("2026-09-22T12:00:00Z", 100), { ...base, tariff: null });
  const next = advanceUsage(first.state, reading("2026-09-22T13:00:00Z", 110), { ...base, tariff: null });
  assert.equal(next.parts[0]?.estimatedCost, null);
  assert.throws(() => advanceUsage(null, reading("2026-09-22T12:00:00Z", -1), base));
  assert.throws(() => advanceUsage(null, reading("2026-09-22T12:00:00Z", Infinity), base));
});
