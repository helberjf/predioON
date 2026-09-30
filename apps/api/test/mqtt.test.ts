import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db, sqlClient, devices, gateways } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";

process.env.MQTT_AUTH_SECRET = "test-broker-secret-with-at-least-32-chars";
process.env.MQTT_INGEST_PASSWORD = "test-ingest-password";
const { startTestServer, login, call } = await import("./helpers.js");
const id = `gw_test_${randomUUID().slice(0, 8)}`;
const deviceId = `sensor_${randomUUID().slice(0, 8)}`;
const username = `gw_${id}`;
const localGatewayGrant = randomUUID();
let server: Awaited<ReturnType<typeof startTestServer>>;

async function broker(path: string, body: unknown, secret = process.env.MQTT_AUTH_SECRET) {
  const response = await fetch(`${server.url}/internal/mqtt/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-mqtt-secret": secret! }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, "EMQX requires explicit allow/deny, not ignore from HTTP errors");
  return response.json() as Promise<{ result: string }>;
}

describe("segurança MQTT", () => {
  before(async () => {
    await db.insert(gateways).values({ id, buildingId: "bld_001", name: "Teste MQTT", serialNumber: id,
      metadata: { mqttUsername: username, mqttPasswordHash: await hashPassword("gateway-password") } });
    await db.insert(devices).values({ id: deviceId, buildingId: "bld_001", gatewayId: id, name: "Sensor MQTT", type: "WATER_LEVEL_SENSOR" });
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id)
      select ${localGatewayGrant},id,'bld_001','BUILDING_ADMIN','gateway',${id} from users where email='admin@predioon.local'`;
    server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from role_bindings where id=${localGatewayGrant}`;
    await db.delete(devices).where(eq(devices.id, deviceId));
    await db.delete(gateways).where(eq(gateways.id, id));
    await closeAppDb(); await sqlClient.end();
  });

  it("autentica credencial própria e rejeita senha/segredo incorretos", async () => {
    assert.equal((await broker("authn", { username, password: "gateway-password", clientid: id })).result, "allow");
    assert.equal((await broker("authn", { username, password: "errada", clientid: id })).result, "deny");
    assert.equal((await broker("authn", { username, password: "gateway-password", clientid: id }, "errado")).result, "deny");
  });
  it("autoriza só o sensor e status do gateway autenticado, sem comandos ou assinatura", async () => {
    const base = { username, clientid: id, action: "publish" };
    for (const topic of [`predio/bld_001/device/${deviceId}/telemetry`, `predio/bld_001/caixa_agua/${deviceId}/telemetria`, `predio/bld_001/gateway/${id}/status`]) {
      assert.equal((await broker("authz", { ...base, topic })).result, "allow");
    }
    for (const topic of ["predio/bld_001/device/water_01/telemetry", `predio/outro/device/${deviceId}/telemetry`, "predio/bld_001/gateway/gw_001/status", "predio/bld_001/portao/abrir"]) {
      assert.equal((await broker("authz", { ...base, topic })).result, "deny");
    }
    assert.equal((await broker("authz", { ...base, action: "subscribe", topic: "#" })).result, "deny");
  });
  it("permite ingestão somente assinar e recusa publicações", async () => {
    const base = { username: "predioon_ingest", clientid: "predioon-ingest" };
    assert.equal((await broker("authn", { ...base, password: "test-ingest-password" })).result, "allow");
    assert.equal((await broker("authz", { ...base, action: "subscribe", topic: "predio/+/caixa_agua/+/telemetria" })).result, "allow");
    assert.equal((await broker("authz", { ...base, action: "publish", topic: `predio/bld_001/device/${deviceId}/telemetry` })).result, "deny");
  });
  it("não expõe hash nem permite alterar credenciais através dos metadados", async () => {
    const admin = await login(server.url, "admin@predioon.local");
    const response = await call(server.url, "/gateways", { token: admin.accessToken });
    const list = await response.json();
    assert.equal(list.items.find((g: { id: string }) => g.id === id).metadata.mqttPasswordHash, undefined);
    const patch = await call(server.url, `/gateways/${id}`, { method: "PATCH", token: admin.accessToken,
      body: { metadata: { mqttPasswordHash: "forged" } } });
    assert.equal(patch.status, 400);
  });
  it("revoga publicações e autenticação quando o gateway está desativado", async () => {
    await db.update(gateways).set({ enabled: false }).where(eq(gateways.id, id));
    assert.equal((await broker("authn", { username, clientid: id, password: "gateway-password" })).result, "deny");
    assert.equal((await broker("authz", { username, clientid: id, action: "publish", topic: `predio/bld_001/device/${deviceId}/telemetry` })).result, "deny");
  });
});
