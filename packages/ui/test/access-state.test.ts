import assert from "node:assert/strict";
import { test } from "node:test";
import { isAccessRequestSettled, reconcileAccessCommand } from "../src/access-state.ts";

const command = { id: "command-1", requestId: "request-1", gateId: "gate-1", status: "SENT" as const, createdAt: "2026-09-22T12:00:00Z", expiresAt: "2026-09-22T12:00:15Z", failureReason: null };

test("a confirmação recuperada da API substitui o estado local após queda de rede", () => {
  const local = { ...command, status: "EXPIRED" as const, failureReason: "Falha de rede" };
  const confirmed = { ...command, status: "ACKNOWLEDGED" as const };
  assert.deepEqual(reconcileAccessCommand(local, confirmed), confirmed);
});

test("uma resposta atrasada não regride uma confirmação já recebida", () => {
  const confirmed = { ...command, status: "ACKNOWLEDGED" as const };
  assert.deepEqual(reconcileAccessCommand(confirmed, command), confirmed);
  assert.equal(reconcileAccessCommand(command, { ...command, status: "PENDING" })?.status, "SENT");
  assert.deepEqual(reconcileAccessCommand(confirmed, { ...command, status: "EXPIRED" }), confirmed);
});

test("o pedido mais recente prevalece entre respostas de solicitações diferentes", () => {
  const newer = { ...command, id: "request-2", createdAt: "2026-09-22T12:01:00Z" };
  assert.deepEqual(reconcileAccessCommand(command, newer), newer);
  assert.deepEqual(reconcileAccessCommand(newer, command), newer);
  assert.equal(reconcileAccessCommand(null, undefined), null);
});

test("uma resposta antiga não libera a chave idempotente de outra abertura em andamento", () => {
  const oldConfirmation = { ...command, status: "ACKNOWLEDGED" as const };
  assert.equal(isAccessRequestSettled("new-request", oldConfirmation), false);
  assert.equal(isAccessRequestSettled(undefined, oldConfirmation), false);
  assert.equal(isAccessRequestSettled(command.requestId, command), false);
  assert.equal(isAccessRequestSettled(command.requestId, oldConfirmation), true);
});
