import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db, sqlClient, devices, gateways } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { gates } from "../../../packages/db/src/schema-access.js";
import { hashPassword } from "../src/auth/passwords.js";
process.env.MQTT_AUTH_SECRET = "test-access-broker-secret-at-least-32-characters";
const { startTestServer } = await import("./helpers.js");

describe("autorização MQTT dos acessos", { skip: process.env.RUN_ACCESS_DB_TESTS !== "1" }, () => {
  const gatewayId = `gw_access_${randomUUID()}`; const deviceId = `gate_${randomUUID()}`;
  let gateId: string; let server: Awaited<ReturnType<typeof startTestServer>>;
  const username = `gw_${gatewayId}`;
  const topic = (kind: string) => `predio/bld_001/gateway/${gatewayId}/access/${gateId}/${kind}`;
  async function authorize(action: string, topic: string, ingest = false) {
    const response = await fetch(`${server.url}/internal/mqtt/authz`, { method: "POST", headers: { "Content-Type": "application/json", "x-mqtt-secret": process.env.MQTT_AUTH_SECRET! }, body: JSON.stringify({ username: ingest ? "predioon_ingest" : username, clientid: ingest ? "predioon-ingest" : gatewayId, action, topic }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  }
  before(async () => {
    await db.insert(gateways).values({ id: gatewayId, buildingId: "bld_001", name: "Gateway ACL", serialNumber: gatewayId, metadata: { mqttUsername: username, mqttPasswordHash: await hashPassword("gateway-test-password") } });
    await db.insert(devices).values({ id: deviceId, buildingId: "bld_001", gatewayId, name: "Controlador ACL", type: "GATE_CONTROLLER" });
    const [gate] = await db.insert(gates).values({ buildingId: "bld_001", name: "Portão ACL", kind: "GARAGE", gatewayId, deviceId, enabled: true }).returning();
    gateId = gate!.id; server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    if (gateId) await db.delete(gates).where(eq(gates.id, gateId));
    await db.delete(devices).where(eq(devices.id, deviceId)); await db.delete(gateways).where(eq(gateways.id, gatewayId));
    await closeAppDb(); await sqlClient.end();
  });
  it("autentica o gateway pelo pool restrito e nega senha ou cliente incorretos", async () => {
    const authenticate = async (password: string, clientid = gatewayId) => {
      const response = await fetch(`${server.url}/internal/mqtt/authn`, { method: "POST", headers: { "Content-Type": "application/json", "x-mqtt-secret": process.env.MQTT_AUTH_SECRET! }, body: JSON.stringify({ username, clientid, password }) });
      assert.equal(response.status, 200);
      return (await response.json()).result;
    };
    assert.equal(await authenticate("gateway-test-password"), "allow");
    assert.equal(await authenticate("wrong-password"), "deny");
    assert.equal(await authenticate("gateway-test-password", "other-gateway"), "deny");
  });
  it("gateway assina comando exato e publica somente sua confirmação", async () => {
    assert.equal(await authorize("subscribe", topic("command")), "allow");
    assert.equal(await authorize("publish", topic("ack")), "allow");
    assert.equal(await authorize("publish", topic("command")), "deny");
    assert.equal(await authorize("subscribe", topic("ack")), "deny");
    assert.equal(await authorize("subscribe", "predio/+/gateway/+/access/+/command"), "deny");
    assert.equal(await authorize("publish", topic("ack").replace("bld_001", "outro")), "deny");
    assert.equal(await authorize("subscribe", topic("command").replace(gateId, randomUUID())), "deny");
  });
  it("ingestão assina ACK e só publica comandos de acessos habilitados", async () => {
    assert.equal(await authorize("subscribe", "predio/+/gateway/+/access/+/ack", true), "allow");
    assert.equal(await authorize("publish", topic("command"), true), "allow");
    assert.equal(await authorize("publish", topic("ack"), true), "deny");
    await db.update(gates).set({ enabled: false }).where(eq(gates.id, gateId));
    assert.equal(await authorize("publish", topic("command"), true), "deny");
    assert.equal(await authorize("subscribe", topic("command")), "deny");
  });
});
