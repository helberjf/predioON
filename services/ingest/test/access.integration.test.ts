import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type { MqttClient } from "mqtt";
import { eq, and } from "drizzle-orm";
import { db, sqlClient, organizations, buildings, devices, gateways, gates, gateCommands, memberships, users, auditLogs } from "@predioon/db";
import { accessTopic } from "@predioon/shared";
import { dispatchAccessOnce, handleAccessAck } from "../src/access/dispatcher.js";

describe("comando e ACK persistidos", { skip: process.env.RUN_ACCESS_DB_TESTS !== "1" }, () => {
  const suffix = randomUUID(); const gatewayId = `gw_ack_${suffix}`; const deviceId = `device_${suffix}`; const userId = `resident_${suffix}`;
  const organizationId = `org_ack_${suffix}`, buildingId = `building_ack_${suffix}`;
  let gateId: string; const sent: Array<{ topic: string; payload: string }> = [];
  const client = { connected: true, options: { queueQoSZero: false }, publish: (topic: string, payload: string, _options: unknown, done: (error?: Error) => void) => { sent.push({ topic, payload }); done(); } } as unknown as MqttClient;
  before(async () => {
    await db.insert(organizations).values({ id: organizationId, name: "Organization ACK", slug: organizationId });
    await db.insert(buildings).values({ id: buildingId, organizationId, name: "Building ACK", code: buildingId });
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, name: "Morador ACK" });
    await db.insert(memberships).values({ userId, buildingId, role: "RESIDENT" });
    await db.insert(gateways).values({ id: gatewayId, buildingId, name: "Gateway ACK", serialNumber: gatewayId, status: "ONLINE", lastSeenAt: new Date() });
    await db.insert(devices).values({ id: deviceId, buildingId, gatewayId, name: "Portão ACK", type: "GATE_CONTROLLER", status: "ONLINE", lastSeenAt: new Date() });
    const [gate] = await db.insert(gates).values({ buildingId, gatewayId, deviceId, name: "Portão ACK", kind: "PEDESTRIAN", enabled: true, allowResidents: true }).returning(); gateId = gate!.id;
  });
  beforeEach(async () => {
    sent.length = 0; client.connected = true;
    await db.delete(gateCommands).where(eq(gateCommands.gateId, gateId));
    await db.update(memberships).set({ active: true }).where(eq(memberships.userId, userId));
    await db.update(organizations).set({ active: true }).where(eq(organizations.id, organizationId));
  });
  after(async () => {
    if (gateId) { await db.delete(gateCommands).where(eq(gateCommands.gateId, gateId)); await db.delete(auditLogs).where(eq(auditLogs.resourceId, gateId)); await db.delete(gates).where(eq(gates.id, gateId)); }
    await db.delete(devices).where(eq(devices.id, deviceId)); await db.delete(gateways).where(eq(gateways.id, gatewayId)); await db.delete(users).where(eq(users.id, userId));
    await db.delete(buildings).where(eq(buildings.id, buildingId)); await db.delete(organizations).where(eq(organizations.id, organizationId)); await sqlClient.end();
  });
  async function request(ago = 0) {
    const createdAt = new Date(Date.now() - ago);
    const [command] = await db.insert(gateCommands).values({ requestId: randomUUID(), gateId, buildingId, gatewayId, deviceId, requestedBy: userId, createdAt, expiresAt: new Date(createdAt.getTime() + 15000) }).returning(); return command!;
  }
  const read = async (id: string) => (await db.select().from(gateCommands).where(eq(gateCommands.id, id)))[0]!;
  it("mantém SENT sem ACK e ignora forjados antes de confirmar uma única vez", async () => {
    const command = await request();
    await dispatchAccessOnce(client, new Date(command.createdAt.getTime() - 1));
    assert.equal(sent.length, 1); assert.equal((await read(command.id)).status, "SENT");
    const ack = { commandId: command.id, buildingId, gatewayId, gateId, deviceId, result: "EXECUTED" };
    const topic = accessTopic(buildingId, gatewayId, gateId, "ack");
    await handleAccessAck(topic, Buffer.from(JSON.stringify({ ...ack, gatewayId: "forged" })));
    await handleAccessAck(topic, Buffer.from(JSON.stringify({ ...ack, commandId: randomUUID() })));
    assert.equal((await read(command.id)).status, "SENT");
    await handleAccessAck(topic, Buffer.from(JSON.stringify(ack)));
    await handleAccessAck(topic, Buffer.from(JSON.stringify(ack)));
    assert.equal((await read(command.id)).status, "ACKNOWLEDGED");
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, gateId), eq(auditLogs.action, "ACCESS_COMMAND_ACKNOWLEDGED")));
    assert.equal(logs.filter(log => log.metadata.commandId === command.id).length, 1);
  });
  it("falha offline e não reenvia ao reconectar", async () => {
    const command = await request(); client.connected = false;
    await dispatchAccessOnce(client, command.createdAt);
    assert.equal((await read(command.id)).status, "FAILED");
    client.connected = true; await dispatchAccessOnce(client, new Date()); assert.equal(sent.length, 0);
  });
  it("recusa vínculo revogado entre o pedido e o envio", async () => {
    const command = await request();
    await db.update(memberships).set({ active: false }).where(eq(memberships.userId, userId));
    await dispatchAccessOnce(client, command.createdAt);
    assert.equal((await read(command.id)).status, "FAILED"); assert.equal(sent.length, 0);
  });
  it("não envia um pedido pendente após desativar a organização e não o repete ao reativar", async () => {
    const command = await request();
    await db.update(organizations).set({ active: false }).where(eq(organizations.id, organizationId));
    await dispatchAccessOnce(client, command.createdAt);
    const rejected = await read(command.id);
    assert.equal(rejected.status, "FAILED");
    assert.equal(rejected.sentAt, null);
    assert.equal(sent.length, 0, "organization revocation must prevent physical publication");
    const events = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, gateId));
    assert.deepEqual(events.filter(event => event.metadata.commandId === command.id).map(event => event.action), ["ACCESS_COMMAND_FAILED"]);
    await db.update(organizations).set({ active: true }).where(eq(organizations.id, organizationId));
    await dispatchAccessOnce(client, command.createdAt);
    assert.equal((await read(command.id)).status, "FAILED");
    assert.equal(sent.length, 0, "reactivation must never replay a rejected physical intent");
  });
  it("ACK vencido não confirma e varredura registra EXPIRED", async () => {
    const command = await request(20000);
    await db.update(gateCommands).set({ status: "SENT", sentAt: command.createdAt }).where(eq(gateCommands.id, command.id));
    await handleAccessAck(accessTopic(buildingId, gatewayId, gateId, "ack"), Buffer.from(JSON.stringify({ commandId: command.id, buildingId, gatewayId, gateId, deviceId, result: "EXECUTED" })));
    assert.equal((await read(command.id)).status, "SENT");
    await dispatchAccessOnce(client, command.createdAt);
    assert.equal((await read(command.id)).status, "EXPIRED"); assert.equal(sent.length, 0);
  });
});
