import assert from "node:assert/strict";
import test from "node:test";
import { transparencyPermissions } from "../src/transparency-state.ts";

test("building authority and published reading never grant finance management", () => {
  for (const capabilities of [undefined, [], ["buildings:read", "buildings:manage"], ["finance:read-published"], ["finance:manage"]]) {
    assert.deepEqual(transparencyPermissions(capabilities), { readDrafts: false, manageReports: false, manageUpdates: false });
  }
  assert.deepEqual(transparencyPermissions(["finance:read"]), { readDrafts: true, manageReports: false, manageUpdates: false });
});

test("finance and management updates require separate current read/write conjunctions", () => {
  assert.deepEqual(transparencyPermissions(["finance:read", "finance:manage"]), { readDrafts: true, manageReports: true, manageUpdates: false });
  assert.deepEqual(transparencyPermissions(["notices:read", "notices:manage"]), { readDrafts: false, manageReports: false, manageUpdates: true });
  assert.equal(transparencyPermissions(["notices:manage"]).manageUpdates, false);
  assert.equal(transparencyPermissions(["finance:read", "notices:manage"]).manageReports, false);
  assert.equal(transparencyPermissions(["finance:manage", "notices:read"]).manageReports, false);
});
