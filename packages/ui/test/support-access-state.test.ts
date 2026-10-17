import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPPORT_CAPABILITY_LABELS, SUPPORT_GRANT_HOURS, sortSupportGrants, supportCapabilityLabel, supportGrantFormError,
  supportGrantStatusLabel, supportPersonLabel, type SupportGrantView } from "../src/support-access-state.ts";

const grant = (id: string, status: SupportGrantView["status"], createdAt: string): SupportGrantView => ({
  id, buildingId: "building-a", supportUserId: "staff-1", supportUserName: null, capability: "telemetry:read", resourceType: null,
  resourceId: null, reason: "Diagnóstico", createdAt, expiresAt: "2026-10-18T12:00:00.000Z", revokedAt: null, grantedByName: "Admin", status,
});
const valid = { supportUserId: "staff-1", capabilities: ["telemetry:read"], reason: "Diagnóstico do medidor", hours: 4 };

test("labels cover exactly the capabilities the database lets a support grant carry", () => {
  // support_grants_valid_ck (014) and SUPPORT_CAPABILITIES in @predioon/shared.
  const allowed = ["telemetry:read", "alerts:read", "devices:read", "work-orders:read-assigned", "support:read"];
  assert.deepEqual(Object.keys(SUPPORT_CAPABILITY_LABELS).sort(), allowed.sort());
  assert.equal(supportCapabilityLabel("alerts:read"), "Alertas");
  assert.equal(supportCapabilityLabel("unknown:read"), "unknown:read");
  assert.equal(supportGrantStatusLabel("REVOKED"), "Revogada");
});

test("deadlines stay within the seven-day database limit", () => {
  assert.ok(SUPPORT_GRANT_HOURS.every(option => Number.isInteger(option.hours) && option.hours >= 1 && option.hours <= 168));
});

test("a hidden staff account is still shown as the platform support team", () => {
  assert.equal(supportPersonLabel({ supportUserName: null }), "Equipe de suporte da plataforma");
  assert.equal(supportPersonLabel({ supportUserName: "  " }), "Equipe de suporte da plataforma");
  assert.equal(supportPersonLabel({ supportUserName: "Ana" }), "Ana");
});

test("active grants come first, then the most recent, without mutating the server list", () => {
  const list = [grant("old-revoked", "REVOKED", "2026-10-15T10:00:00Z"), grant("active", "ACTIVE", "2026-10-14T10:00:00Z"), grant("new-expired", "EXPIRED", "2026-10-16T10:00:00Z")];
  assert.deepEqual(sortSupportGrants(list).map(row => row.id), ["active", "new-expired", "old-revoked"]);
  assert.deepEqual(list.map(row => row.id), ["old-revoked", "active", "new-expired"]);
});

test("the form explains each refusal the API would give", () => {
  assert.equal(supportGrantFormError(valid), null);
  assert.match(supportGrantFormError({ ...valid, supportUserId: "" })!, /equipe de suporte/);
  assert.match(supportGrantFormError({ ...valid, capabilities: [] })!, /ao menos uma/);
  assert.match(supportGrantFormError({ ...valid, capabilities: ["telemetry:read-published"] })!, /não pode receber/);
  assert.match(supportGrantFormError({ ...valid, capabilities: ["alerts:read", "alerts:read"] })!, /repetidas/);
  assert.match(supportGrantFormError({ ...valid, reason: " a " })!, /motivo/);
  assert.match(supportGrantFormError({ ...valid, reason: "x".repeat(501) })!, /500/);
  assert.match(supportGrantFormError({ ...valid, hours: 169 })!, /prazo/);
});
