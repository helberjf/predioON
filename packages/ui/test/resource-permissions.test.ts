import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizationResponse } from "@predioon/contracts/tenancy";
import { alertAuthorizationTargets, alertPermissions, authorizationPath, occurrencePermissions, occurrenceWorkspacePermissions } from "../src/resource-permissions.ts";

const alert = { id: "a", buildingId: "building", deviceId: "d", gatewayId: "g" };
const snapshot = (resourceType: AuthorizationResponse["resourceType"], resourceId: string | undefined, capabilities: AuthorizationResponse["capabilities"], buildingId = "building"): AuthorizationResponse => ({ buildingId, resourceType, resourceId, capabilities });
const ticket = { id: "o", buildingId: "building", openedBy: "author", status: "OPEN" };

test("alert actions combine only the selected alert and its real parents, with read required", () => {
  assert.deepEqual(alertPermissions("building", alert, [snapshot("alert", "a", ["alerts:acknowledge", "alerts:resolve"])]), { read: false, acknowledge: false, resolve: false });
  assert.deepEqual(alertPermissions("building", alert, [snapshot("device", "d", ["alerts:read"]), snapshot("gateway", "g", ["alerts:resolve"])]), { read: true, acknowledge: false, resolve: true });
  assert.deepEqual(alertPermissions("building", alert, [snapshot("alert", "a", ["alerts:read", "alerts:acknowledge"])]), { read: true, acknowledge: true, resolve: false });
  assert.deepEqual(alertAuthorizationTargets({ ...alert, deviceId: null, gatewayId: null }), [{ buildingId: "building", resourceType: "alert", resourceId: "a" }]);
});

test("neighbor, previous tenant, rule and unrelated gateway responses cannot authorize this alert", () => {
  const responses = [snapshot("alert", "other", ["alerts:read", "alerts:resolve"]), snapshot("gateway", "not-parent", ["alerts:read", "alerts:resolve"]), snapshot("alert_rule", "rule", ["alerts:read", "alerts:resolve"]), snapshot("alert", "a", ["alerts:read", "alerts:acknowledge"], "previous")];
  assert.deepEqual(alertPermissions("building", alert, responses), { read: false, acknowledge: false, resolve: false });
  assert.equal(alertPermissions("previous", alert, [snapshot("alert", "a", ["alerts:read", "alerts:resolve"])]).resolve, false);
  assert.equal(alertPermissions("building", { ...alert, gatewayId: null }, [snapshot("gateway", "g", ["alerts:read", "alerts:resolve"])]).resolve, false);
});

test("read-own requires actual authorship; exact manage permits individual actions but not cancel-own", () => {
  const own = snapshot("occurrence", "o", ["occurrences:read-own"]);
  assert.deepEqual(occurrencePermissions("building", "author", ticket, own), { read: true, manage: false, comment: true, cancelOwn: true });
  assert.deepEqual(occurrencePermissions("building", "neighbor", ticket, own), { read: false, manage: false, comment: false, cancelOwn: false });
  assert.equal(occurrencePermissions("building", "author", { ...ticket, openedBy: null }, own).read, false);
  assert.deepEqual(occurrencePermissions("building", "neighbor", ticket, snapshot("occurrence", "o", ["occurrences:manage"])), { read: true, manage: true, comment: true, cancelOwn: false });
  for (const status of ["DONE", "CANCELLED"]) assert.equal(occurrencePermissions("building", "author", { ...ticket, status }, own).cancelOwn, false);
});

test("an exact grant never authorizes creation or a group; creation needs broad read-own plus create-own", () => {
  const all = ["occurrences:read-own", "occurrences:create-own", "occurrences:manage"] as const;
  assert.deepEqual(occurrenceWorkspacePermissions("building", snapshot("occurrence", "o", [...all])), { create: false, manageGroup: false });
  assert.deepEqual(occurrenceWorkspacePermissions("building", snapshot(undefined, undefined, [...all])), { create: true, manageGroup: true });
  assert.deepEqual(occurrenceWorkspacePermissions("building", snapshot(undefined, undefined, ["occurrences:create-own"])), { create: false, manageGroup: false });
  assert.deepEqual(occurrenceWorkspacePermissions("building", snapshot(undefined, undefined, ["occurrences:read-own"])), { create: false, manageGroup: false });
  assert.deepEqual(occurrenceWorkspacePermissions("building", snapshot(undefined, undefined, [...all], "previous")), { create: false, manageGroup: false });
});

test("late, revoked and failed authorization snapshots remove individual controls", () => {
  for (const response of [null, undefined, snapshot("occurrence", "previous", ["occurrences:manage"]), snapshot("occurrence", "o", []), snapshot("occurrence", "o", ["occurrences:manage"], "previous"), snapshot(undefined, undefined, ["occurrences:manage"])]) {
    assert.deepEqual(occurrencePermissions("building", "author", ticket, response), { read: false, manage: false, comment: false, cancelOwn: false });
  }
  assert.equal(occurrencePermissions("other", "author", ticket, snapshot("occurrence", "o", ["occurrences:manage"])).manage, false);
  assert.equal(authorizationPath({ buildingId: "a&b", resourceType: "occurrence", resourceId: "id /?" }), "/v1/authorization?buildingId=a%26b&resourceType=occurrence&resourceId=id+%2F%3F");
});
