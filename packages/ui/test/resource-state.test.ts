import assert from "node:assert/strict";
import test from "node:test";
import * as resource from "../src/resource-state.ts";

test("retry removes previous errors and a successful fetch supplies fresh data", () => {
  assert.equal(typeof resource.resourceReducer, "function");
  const failed = { path: "/tank/a", data: null, error: "Unavailable", loading: false };
  const pending = resource.resourceReducer(failed, { type: "start", path: "/tank/a" });
  assert.equal(pending.error, null);
  assert.equal(pending.loading, true);
  const loaded = resource.resourceReducer(pending, { type: "success", data: { level: 42 } });
  assert.deepEqual(loaded.data, { level: 42 });
  assert.equal(loaded.loading, false);
});

test("changing sensor and failed refresh discard values that cannot be used for the current reading", () => {
  assert.equal(typeof resource.resourceReducer, "function");
  const loaded = { path: "/tank/a", data: { level: 42 }, error: null, loading: false };
  assert.equal(resource.resourceReducer(loaded, { type: "start", path: "/tank/b" }).data, null);
  assert.equal(resource.resourceReducer(loaded, { type: "error", error: "Offline" }).data, null);
  const disabled = resource.resourceReducer(loaded, { type: "start", path: null });
  assert.equal(disabled.loading, false);
  assert.equal(disabled.data, null);
});
