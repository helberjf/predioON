import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
const sources = ["pipeline/telemetry", "pipeline/gateway-status", "offline-sweeper", "analytics/usage", "rules/evaluate", "parking/index", "notify/index", "features", "realtime"];
for (const name of sources) it(`${name} uses only the restricted observation entrypoint`, () => {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']@predioon\/db["']/);
  assert.doesNotMatch(source, /public\.(outbox_events|event_deliveries|delivery_witnesses|delivery_witness_features)/);
  assert.match(source, /@predioon\/db\/ingest/);
});
