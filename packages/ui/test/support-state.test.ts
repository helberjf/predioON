import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupportConfigView, SupportLaunch, SupportRequestView } from "@predioon/shared";
import { supportLaunchIsCurrent, supportRequestForRetry } from "../src/support-state.ts";

const config: SupportConfigView = { buildingId: "building-a", displayName: "Portaria", anydeskId: "123456789", enabled: true, revision: 1, createdAt: "2026-09-23T12:00:00Z", updatedAt: "2026-09-23T12:00:00Z" };
const request: SupportRequestView = { id: "support-1", requestId: "request-1", buildingId: config.buildingId, requestedBy: "admin-1", requestedByName: "Técnico", displayName: config.displayName, anydeskId: config.anydeskId, configRevision: 1, reason: "Verificar gateway", status: "OPEN", notes: null, closedBy: null, createdAt: config.createdAt, closedAt: null };
const launch: SupportLaunch = { request, launchUri: "anydesk:123456789" };

test("a solicitação validada pertence ao condomínio e configuração exibidos", () => {
  assert.equal(supportLaunchIsCurrent(launch, config, "building-a", request), true);
  assert.equal(supportLaunchIsCurrent(launch, config, "building-b", request), false);
  assert.equal(supportLaunchIsCurrent(launch, null, "building-a", request), false);
});

test("alterar ou desabilitar o cadastro invalida a abertura anterior", () => {
  assert.equal(supportLaunchIsCurrent(launch, { ...config, enabled: false }, "building-a", request), false);
  assert.equal(supportLaunchIsCurrent(launch, { ...config, revision: 2 }, "building-a", request), false);
  assert.equal(supportLaunchIsCurrent(launch, { ...config, anydeskId: "987654321" }, "building-a", request), false);
});

test("solicitação encerrada ou ausente no estado atual não oferece abertura", () => {
  assert.equal(supportLaunchIsCurrent(launch, config, "building-a", { ...request, status: "RESOLVED" }), false);
  assert.equal(supportLaunchIsCurrent(launch, config, "building-a", undefined), false);
  assert.equal(supportLaunchIsCurrent({ ...launch, request: { ...request, status: "NOT_CONNECTED" } }, config, "building-a", request), false);
});

test("repetir após falha conserva a chave e o motivo enviados, sem duplicar solicitação", () => {
  const pending = { requestId: "request-1", reason: "Verificar gateway" };
  assert.deepEqual(supportRequestForRetry(pending, "  Verificar gateway  ", () => "new-id"), pending);
  assert.deepEqual(supportRequestForRetry(pending, "Verificar sensor", () => "new-id"), { requestId: "new-id", reason: "Verificar sensor" });
  assert.deepEqual(supportRequestForRetry(null, "Verificar gateway", () => "new-id"), { requestId: "new-id", reason: "Verificar gateway" });
});
