import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createGateSimulator } from "../src/access/simulation.js";
const now = new Date("2026-09-22T12:00:00Z");
const identity = { buildingId: "b1", gatewayId: "gw1", gateId: "g1", deviceId: "d1" };
const command = { ...identity, commandId: randomUUID(), action: "OPEN", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15000).toISOString() };
describe("simulador isolado de portão", () => {
  it("confirma um comando uma vez e descarta duplicatas", () => {
    const simulate = createGateSimulator(identity, new Date(now.getTime() - 1));
    assert.deepEqual(simulate(command, now), { ...identity, commandId: command.commandId, result: "EXECUTED" });
    assert.equal(simulate(command, now), null);
  });
  it("ignora retidos, vencidos, fora de escopo e anteriores à reconexão", () => {
    assert.equal(createGateSimulator(identity, now)(command, now, true), null);
    assert.equal(createGateSimulator(identity, now)({ ...command, expiresAt: now.toISOString() }, now), null);
    assert.equal(createGateSimulator(identity, now)({ ...command, deviceId: "outro" }, now), null);
    assert.equal(createGateSimulator(identity, new Date(now.getTime() + 1))(command, now), null);
  });
});
