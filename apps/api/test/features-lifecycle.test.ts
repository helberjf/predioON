import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { alerts, auditLogs, buildings, dailyUsage, db, devices, gateCommands, gates, gateways, organizations, parkingLots, sqlClient, telemetry, usageCursors } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { accessTopic, dayKey, telemetryTopic } from "@predioon/shared";
import { handleTelemetry } from "../../../services/ingest/src/pipeline/telemetry.js";
import { dispatchAccessOnce, handleAccessAck } from "../../../services/ingest/src/access/dispatcher.js";
import { notifyAlert } from "../../../services/ingest/src/notify/index.js";
import { config } from "../../../services/ingest/src/config.js";
import { call, login, startTestServer } from "./helpers.js";

describe("pause and resume through the real API, database and ingestion", () => {
  const suffix = randomUUID().slice(0, 8), org = `life_org_${suffix}`, buildingId = `life_${suffix}`, gatewayId = `gw_${suffix}`;
  const meterId = `meter_${suffix}`, controllerId = `gate_${suffix}`, parkingId = `park_${suffix}`;
  let server: Awaited<ReturnType<typeof startTestServer>>, token: string, profileId: string, gateId: string, lotId: string;
  const request = (path: string, method = "GET", body?: unknown) => call(server.url, path, { token, method, body });
  async function ok(path: string, method = "GET", body?: unknown, status = 200) {
    const response = await request(path, method, body), data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  }
  async function set(key: string, enabled: boolean | null) {
    const states = await ok(`/features/buildings/${buildingId}`), state = states.items.find((row: any) => row.key === key);
    return ok(`/features/buildings/${buildingId}/${key}`, "PUT", { enabled, version: state.version, reason: "Teste isolado de pausa e retomada" });
  }
  const ingest = (metric: string, value: number | boolean, time = new Date(), deviceId = meterId) => handleTelemetry(telemetryTopic(buildingId, deviceId), Buffer.from(JSON.stringify({ schemaVersion: 1, eventId: randomUUID(), buildingId, deviceId, metric, value, quality: "GOOD", timestamp: time.toISOString() })));
  async function queuedChange() {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const [row] = await sqlClient`select exists(select 1 from pg_locks where locktype='advisory' and classid=814772 and objid=1 and not granted) as waiting`;
      if (row!.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Feature change did not wait for the in-flight operation");
  }
  before(async () => {
    await db.insert(organizations).values({ id: org, name: "Lifecycle test", slug: org });
    await db.insert(buildings).values({ id: buildingId, organizationId: org, name: "Lifecycle test", code: buildingId });
    await db.insert(gateways).values({ id: gatewayId, buildingId, name: "Test gateway", serialNumber: gatewayId, status: "ONLINE", lastSeenAt: new Date() });
    await db.insert(devices).values([{ id: meterId, buildingId, gatewayId, name: "Mixed meter", type: "ENERGY_METER" }, { id: controllerId, buildingId, gatewayId, name: "Test gate", type: "GATE_CONTROLLER", status: "ONLINE", lastSeenAt: new Date() }, { id: parkingId, buildingId, gatewayId, name: "Test parking", type: "PARKING_SENSOR" }]);
    server = await startTestServer(); token = (await login(server.url, "admin@predioon.local")).accessToken;
    profileId = (await ok("/monitoring", "POST", { buildingId, deviceId: meterId, kind: "ENERGY", tariff: 1 }, 201)).id;
    gateId = (await ok("/access", "POST", { buildingId, gatewayId, deviceId: controllerId, kind: "GARAGE", name: "Test garage", enabled: true, allowResidents: false }, 201)).id;
    lotId = (await ok("/parking", "POST", { buildingId, vehicleType: "CAR", sensorId: parkingId, capacity: 10 }, 201)).id;
  });
  after(async () => {
    await server?.close();
    await db.delete(gateCommands).where(eq(gateCommands.buildingId, buildingId));
    await db.delete(gates).where(eq(gates.buildingId, buildingId));
    await db.delete(auditLogs).where(eq(auditLogs.buildingId, buildingId));
    await db.delete(buildings).where(eq(buildings.id, buildingId));
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeAppDb(); await sqlClient.end();
  });
  it("discards only paused metrics and preserves hardware liveness", async () => {
    await ingest("water_level_percent", 30, new Date(Date.now() - 1000));
    await set("WATER_TANK", false);
    await db.update(devices).set({ status: "OFFLINE", lastSeenAt: new Date(0) }).where(eq(devices.id, meterId));
    await ingest("water_level_percent", 99);
    await ingest("temperature_c", 21);
    const samples = await db.select().from(telemetry).where(eq(telemetry.deviceId, meterId));
    assert.equal(samples.filter(row => row.metric === "water_level_percent").length, 1);
    assert.equal(samples.filter(row => row.metric === "temperature_c").length, 1);
    const [device] = await db.select().from(devices).where(eq(devices.id, meterId)); assert.equal(device!.status, "ONLINE");
    const [gateway] = await db.select().from(gateways).where(eq(gateways.id, gatewayId)); assert.equal(gateway!.status, "ONLINE");
    const states = await set("WATER_TANK", true), resumedAt = new Date(states.items.find((row: any) => row.key === "WATER_TANK").resumedAt);
    await ingest("water_level_percent", 88, new Date(resumedAt.getTime() - 1));
    assert.equal((await db.select().from(telemetry).where(and(eq(telemetry.deviceId, meterId), eq(telemetry.metric, "water_level_percent")))).length, 1);
    await ingest("water_level_percent", 32, new Date(resumedAt.getTime() + 1));
    assert.equal((await db.select().from(telemetry).where(and(eq(telemetry.deviceId, meterId), eq(telemetry.metric, "water_level_percent")))).length, 2);
  });
  it("resets the meter baseline, keeps old totals and marks the resumed day incomplete", async () => {
    const now = Date.now(); await ingest("energy_total_kwh", 100, new Date(now - 5000)); await ingest("energy_total_kwh", 101, new Date(now - 4000));
    await set("ENERGY_CONSUMPTION", false);
    assert.equal((await db.select().from(usageCursors).where(eq(usageCursors.profileId, profileId))).length, 0);
    await ingest("energy_total_kwh", 999);
    const states = await set("ENERGY_CONSUMPTION", true), resumed = Date.parse(states.items.find((row: any) => row.key === "ENERGY_CONSUMPTION").resumedAt);
    await ingest("energy_total_kwh", 1000, new Date(resumed + 1)); await ingest("energy_total_kwh", 1002, new Date(resumed + 1001));
    const [day] = await db.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profileId), eq(dailyUsage.day, dayKey(new Date(resumed), "America/Sao_Paulo"))));
    assert.equal(day!.quantity, 3); assert.equal(day!.estimatedCost, 3); assert.equal(day!.incomplete, true);
    const response = await ok(`/monitoring?buildingId=${buildingId}`); assert.equal(response.items[0].today.incomplete, true); assert.equal(response.items[0].deviation, null);
  });
  it("pausing AI allows tariff changes without resetting the configured analysis preference", async () => {
    await set("AI_ANALYSIS", false);
    await ok(`/monitoring/${profileId}`, "PATCH", { tariff: 2 });
    const paused = (await ok(`/monitoring?buildingId=${buildingId}`)).items[0]; assert.equal(paused.adaptiveEnabled, false); assert.equal(paused.reference, null);
    await set("AI_ANALYSIS", true);
    assert.equal((await ok(`/monitoring?buildingId=${buildingId}`)).items[0].adaptiveEnabled, true);
  });
  it("invalidates parking observations and waits for a fresh sample after reactivation", async () => {
    await ingest("parking_occupied", 4, new Date(), parkingId);
    assert.equal((await ok(`/parking?buildingId=${buildingId}`)).items[0].available, 6);
    await set("CAR_PARKING", false); await ingest("parking_occupied", 9, new Date(), parkingId);
    const states = await set("CAR_PARKING", true), resumed = Date.parse(states.items.find((row: any) => row.key === "CAR_PARKING").resumedAt);
    assert.equal((await ok(`/parking?buildingId=${buildingId}`)).items[0].available, null);
    // Parking rejects future device clocks, so use current wall time once past the DB boundary.
    const waitForClock = Math.max(1, resumed + 2 - Date.now());
    assert.ok(waitForClock < 2000, "Database and device test clocks must be synchronized");
    await new Promise(resolve => setTimeout(resolve, waitForClock));
    await ingest("parking_occupied", 3, new Date(), parkingId);
    assert.equal((await db.select().from(parkingLots).where(eq(parkingLots.id, lotId)))[0]!.occupied, 3);
  });
  it("feature pause cancels queued gate commands and reactivation never resends them", async () => {
    const command = await ok(`/access/${gateId}/open`, "POST", { requestId: randomUUID() }, 202);
    await set("GARAGE_ACCESS", false);
    const [cancelled] = await db.select().from(gateCommands).where(eq(gateCommands.id, command.id)); assert.equal(cancelled!.status, "FAILED");
    assert.equal((await request(`/access/${gateId}/open`, "POST", { requestId: randomUUID() })).status, 403);
    await set("GARAGE_ACCESS", true);
    let published = 0;
    await dispatchAccessOnce({ connected: true, options: { queueQoSZero: false }, publish: (_t: unknown, _p: unknown, _o: unknown, done: () => void) => { published++; done(); } } as Parameters<typeof dispatchAccessOnce>[0], new Date(0));
    assert.equal(published, 0);
  });
  it("pause waits for an in-flight publish and still accepts its acknowledgement", async () => {
    const state = (await ok(`/features/buildings/${buildingId}`)).items.find((row: any) => row.key === "GARAGE_ACCESS");
    // The resume boundary comes from PostgreSQL; the host clock can lag behind
    // it. This fixture must represent a new command after the recorded resume.
    const createdAt = new Date(Math.max(Date.now(), state.resumedAt ? Date.parse(state.resumedAt) + 1 : 0));
    const expiresAt = new Date(createdAt.getTime() + 15000);
    const [command] = await db.insert(gateCommands).values({ requestId: randomUUID(), gateId, buildingId, gatewayId, deviceId: controllerId, requestedBy: "platform_admin", createdAt, expiresAt }).returning();
    let entered!: () => void, finish!: () => void;
    let publicationStarted = false;
    const publishing = new Promise<void>(resolve => { entered = resolve; });
    const dispatch = dispatchAccessOnce({ connected: true, options: { queueQoSZero: false }, publish: (_t: unknown, _p: unknown, _o: unknown, done: () => void) => { publicationStarted = true; finish = done; entered(); } } as Parameters<typeof dispatchAccessOnce>[0], new Date(0));
    let publicationTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        publishing,
        dispatch.then(async () => {
          if (publicationStarted) return;
          const [outcome] = await db.select({ status: gateCommands.status, reason: gateCommands.failureReason })
            .from(gateCommands).where(eq(gateCommands.id, command!.id));
          assert.fail(`Dispatch ended before publishing: ${outcome?.status} (${outcome?.reason ?? "no reason"})`);
        }),
        new Promise<never>((_resolve, reject) => {
          publicationTimeout = setTimeout(() => reject(new Error("Dispatch did not begin publishing within 10 seconds")), 10_000);
        }),
      ]);
    } finally { clearTimeout(publicationTimeout); }
    let completed = false;
    const change = ok(`/features/buildings/${buildingId}/GARAGE_ACCESS`, "PUT", { enabled: false, version: state.version, reason: "Concorrência com envio em andamento" }).then(result => { completed = true; return result; });
    try { await queuedChange(); assert.equal(completed, false); } finally { finish(); }
    await dispatch; await change;
    const [sent] = await db.select().from(gateCommands).where(eq(gateCommands.id, command!.id)); assert.equal(sent!.status, "SENT");
    await handleAccessAck(accessTopic(buildingId, gatewayId, gateId, "ack"), Buffer.from(JSON.stringify({ commandId: command!.id, buildingId, gatewayId, gateId, deviceId: controllerId, result: "EXECUTED" })));
    assert.equal((await db.select().from(gateCommands).where(eq(gateCommands.id, command!.id)))[0]!.status, "ACKNOWLEDGED");
  });
  it("alert delivery serializes with pause and old alerts are not delivered afterwards", async () => {
    const [alert] = await db.insert(alerts).values({ buildingId, deviceId: meterId, type: "DAILY_ENERGY_LIMIT", severity: "HIGH", message: "Lifecycle alert", triggeredAt: new Date() }).returning();
    let entered!: () => void, finish!: () => void, deliveries = 0;
    const receiving = new Promise<void>(resolve => { entered = resolve; });
    const webhook = createServer((req, res) => { req.resume(); deliveries++; finish = () => { res.writeHead(204); res.end(); }; entered(); });
    await new Promise<void>(resolve => webhook.listen(0, "127.0.0.1", resolve));
    const port = (webhook.address() as { port: number }).port, previous = config.ALERT_WEBHOOK_URL;
    config.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}`;
    const notification = { alertId: alert!.id, buildingId, deviceId: meterId, severity: "HIGH", type: alert!.type, message: alert!.message, triggeredAt: alert!.triggeredAt.toISOString() };
    try {
      const delivery = notifyAlert(notification); await receiving;
      const state = (await ok(`/features/buildings/${buildingId}`)).items.find((row: any) => row.key === "ENERGY_CONSUMPTION");
      const change = ok(`/features/buildings/${buildingId}/ENERGY_CONSUMPTION`, "PUT", { enabled: false, version: state.version, reason: "Concorrência com entrega de alerta" });
      try { await queuedChange(); } finally { finish(); }
      await delivery; await change;
      await notifyAlert(notification); assert.equal(deliveries, 1);
    } finally { config.ALERT_WEBHOOK_URL = previous; webhook.closeAllConnections(); await new Promise<void>(resolve => webhook.close(() => resolve())); }
  });
  it("support blocks new launches and keeps the result of an existing request recordable", async () => {
    await ok(`/support/${buildingId}`, "PUT", { displayName: "Test host", anydeskId: "123456789", enabled: true });
    const launch = await ok(`/support/${buildingId}/requests`, "POST", { requestId: randomUUID(), reason: "Registro técnico sem conexão externa" }, 201);
    await set("REMOTE_SUPPORT", false);
    assert.equal((await request(`/support/${buildingId}/requests`, "POST", { requestId: randomUUID(), reason: "Nova tentativa bloqueada" })).status, 403);
    await ok(`/support/${buildingId}/requests/${launch.request.id}`, "PATCH", { outcome: "NOT_CONNECTED", notes: "Teste sem abertura do AnyDesk" });
    await set("REMOTE_SUPPORT", true);
    assert.equal((await ok(`/support?buildingId=${buildingId}`)).requests[0].status, "NOT_CONNECTED");
  });
});
