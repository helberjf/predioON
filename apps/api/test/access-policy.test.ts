import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessCapabilityAvailability, parseAccessTopic, validAccessAck, AccessAckSchema, GateConfigSchema, GatePatchSchema, OpenGateSchema } from "../../../packages/shared/src/access.js";

const now = new Date("2026-09-22T12:00:00Z");
const live = { enabled: true, status: "ONLINE", lastSeenAt: now };
const gate = { enabled: true, allowResidents: true };
const command = { id: "c3a4615e-0770-4b7c-b0d6-e4343e11cc30", buildingId: "b1", gatewayId: "gw1", gateId: "g1", deviceId: "d1", status: "SENT", expiresAt: new Date(now.getTime() + 15000) };
const ack = { commandId: command.id, buildingId: "b1", gatewayId: "gw1", gateId: "g1", deviceId: "d1", result: "EXECUTED" as const };
describe("segurança de acessos sem banco", () => {
  it("preserva campos omitidos no PATCH em vez de aplicar defaults de criação", () => {
    assert.deepEqual(GatePatchSchema.parse({name:"Novo nome"}), {name:"Novo nome"});
    assert.deepEqual(GatePatchSchema.parse({enabled:false}), {enabled:false});
    assert.deepEqual(GatePatchSchema.parse({allowResidents:false}), {allowResidents:false});
  });
  it("exige permissão atual, acesso habilitado e hardware com conexão recente", () => {
    assert.equal(accessCapabilityAvailability(gate, live, live, true, now), null);
    assert.match(accessCapabilityAvailability({ ...gate, enabled: false }, live, live, true, now)!, /desativado/);
    assert.match(accessCapabilityAvailability(gate, { ...live, status: "OFFLINE" }, live, true, now)!, /conexão/);
    assert.match(accessCapabilityAvailability(gate, live, { ...live, lastSeenAt: new Date(now.getTime() - 61000) }, true, now)!, /conexão/);
    assert.match(accessCapabilityAvailability(gate, live, { ...live, lastSeenAt: new Date(now.getTime() + 5001) }, true, now)!, /conexão/);
    assert.match(accessCapabilityAvailability(gate, live, live, false, now)!, /permissão/);
  });
  it("aceita apenas tópicos exatos e nunca curingas", () => {
    assert.deepEqual(parseAccessTopic("predio/b1/gateway/gw1/access/g1/command"), { buildingId: "b1", gatewayId: "gw1", gateId: "g1", kind: "command" });
    for (const topic of ["predio/+/gateway/gw1/access/g1/ack", "predio/b1/gateway/gw1/access/#/command", "predio/b1/gateway/gw1/access/g1/command/extra"]) assert.equal(parseAccessTopic(topic), null);
  });
  it("rejeita confirmação forjada, fora do prazo e de comando ainda não enviado", () => {
    assert.equal(validAccessAck(command, ack, now), true);
    for (const field of ["commandId", "buildingId", "gatewayId", "gateId", "deviceId"]) assert.equal(validAccessAck(command, { ...ack, [field]: "forged" }, now), false);
    assert.equal(validAccessAck({ ...command, status: "PENDING" }, ack, now), false);
    assert.equal(validAccessAck({ ...command, expiresAt: now }, ack, now), false);
  });
  it("exige idempotência, rejeita campos extras e nasce desativado", () => {
    assert.equal(OpenGateSchema.safeParse({}).success, false);
    assert.equal(OpenGateSchema.safeParse({ requestId: command.id, retained: true }).success, false);
    assert.equal(AccessAckSchema.safeParse({ ...ack, result: "OPEN" }).success, false);
    const config = GateConfigSchema.parse({ buildingId: "b1", name: "Garagem", kind: "GARAGE", gatewayId: "gw1", deviceId: "d1" });
    assert.equal(config.enabled, false);
    assert.equal(config.allowResidents, false);
  });
});
