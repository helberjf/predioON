import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishAccessCommand } from "../src/access/publish.js";
const now = new Date("2026-09-22T12:00:00Z");
const command = { id: "c3a4615e-0770-4b7c-b0d6-e4343e11cc30", buildingId: "b1", gatewayId: "gw1", gateId: "g1", deviceId: "d1", expiresAt: new Date(now.getTime() + 15000), createdAt: now };
describe("entrega de comandos sem fila", () => {
  it("publica uma única vez sem retain nem retransmissão MQTT", async () => {
    const calls: unknown[][] = [];
    await publishAccessCommand({ connected: true, options: { queueQoSZero: false }, publish: (...args) => { calls.push(args); args[3](); } }, command, new Date(now.getTime() - 1), now);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![0], "predio/b1/gateway/gw1/access/g1/command");
    assert.deepEqual(calls[0]![2], { qos: 0, retain: false });
    assert.equal(JSON.parse(calls[0]![1] as string).commandId, command.id);
    assert.equal(JSON.parse(calls[0]![1] as string).action, "OPEN");
  });
  it("nunca publica offline, vencido, com fila habilitada ou criado antes da conexão", async () => {
    let count = 0;
    const client = { connected: true, options: { queueQoSZero: false }, publish: (..._args: any[]) => { count++; } };
    await assert.rejects(publishAccessCommand({ ...client, connected: false }, command, now, now), /indisponível/);
    await assert.rejects(publishAccessCommand({ ...client, options: { queueQoSZero: true } }, command, now, now), /desabilitada/);
    await assert.rejects(publishAccessCommand(client, { ...command, expiresAt: now }, now, now), /expirado/);
    await assert.rejects(publishAccessCommand(client, command, new Date(now.getTime() + 1), now), /reenvio bloqueado/);
    assert.equal(count, 0);
  });
  it("propaga erro de transporte para que o pedido seja marcado como falho", async () => {
    await assert.rejects(publishAccessCommand({ connected: true, options: { queueQoSZero: false }, publish: (...args) => args[3](new Error("offline")) }, command, now, now), /offline/);
  });
});
