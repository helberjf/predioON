import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessAvailability, accessRole, parseAccessTopic, validAccessAck, AccessAckSchema, GateConfigSchema, OpenGateSchema } from "../../../packages/shared/src/access.js";

const now = new Date("2026-09-22T12:00:00Z");
const live = { enabled: true, status: "ONLINE", lastSeenAt: now };
const gate = { enabled: true, allowResidents: true };
const command = { id: "c3a4615e-0770-4b7c-b0d6-e4343e11cc30", buildingId: "b1", gatewayId: "gw1", gateId: "g1", deviceId: "d1", status: "SENT", expiresAt: new Date(now.getTime() + 15000) };
const ack = { commandId: command.id, buildingId: "b1", gatewayId: "gw1", gateId: "g1", deviceId: "d1", result: "EXECUTED" as const };
describe("segurança de acessos sem banco", () => {
  it("usa usuário e vínculo atuais, com início e expiração", () => {
    const user = { active: true, isPlatformAdmin: false };
    const membership = { active: true, role: "RESIDENT" as const, startsAt: null, endsAt: null };
    assert.equal(accessRole(user, membership, now), "RESIDENT");
    assert.equal(accessRole({ ...user, active: false }, membership, now), null);
    assert.equal(accessRole(user, { ...membership, active: false }, now), null);
    assert.equal(accessRole(user, { ...membership, endsAt: now }, now), null);
    assert.equal(accessRole(user, { ...membership, startsAt: new Date(now.getTime() + 1) }, now), null);
    assert.equal(accessRole(user, null, now), null);
  });
  it("bloqueia acesso desativado, morador sem permissão e hardware offline ou obsoleto", () => {
    assert.equal(accessAvailability(gate, live, live, "RESIDENT", now), null);
    assert.match(accessAvailability({ ...gate, enabled: false }, live, live, "BUILDING_ADMIN", now)!, /desativado/);
    assert.match(accessAvailability({ ...gate, allowResidents: false }, live, live, "RESIDENT", now)!, /moradores/);
    assert.match(accessAvailability(gate, { ...live, status: "OFFLINE" }, live, "RESIDENT", now)!, /conexão/);
    assert.match(accessAvailability(gate, live, { ...live, lastSeenAt: new Date(now.getTime() - 61000) }, "RESIDENT", now)!, /conexão/);
    assert.match(accessAvailability(gate, live, live, null, now)!, /permissão/);
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
