import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { alerts, closeAppDb, dailyUsage, db, devices, monitoringProfiles, sqlClient, withUserContext } from "@predioon/db";
import { dayBounds, dayKey } from "@predioon/shared";
import { accountUsage } from "../../../services/ingest/src/analytics/usage.js";
import { call, json, login, startTestServer, unique, type Session, type TestServer } from "./helpers.js";

describe("consumo, tarifas e análise histórica", () => {
  let server: TestServer, admin: Session, resident: Session, profileId: string;
  const deviceId = unique("usage-meter"), pumpId = unique("usage-pump");
  const now = new Date(), start = new Date(now.getTime() - 60_000);
  const key = dayKey(now, "America/Sao_Paulo");
  const ingest = (value: number | boolean, time: Date, device = deviceId, metric = "energy_total_kwh") => db.transaction(async tx => {
    await tx.select().from(devices).where(eq(devices.id, device)).for("update");
    return accountUsage(tx, { schemaVersion: 1, eventId: randomUUID(), buildingId: "bld_001", deviceId: device, metric, value, quality: "GOOD", timestamp: time.toISOString() });
  });
  before(async () => {
    server = await startTestServer(); admin = await login(server.url, "sindico@predioon.local"); resident = await login(server.url, "morador@predioon.local");
    await db.insert(devices).values([{ id: deviceId, buildingId: "bld_001", name: "Medidor de teste", type: "ENERGY_METER" }, { id: pumpId, buildingId: "bld_001", name: "Bomba de teste", type: "PUMP_MONITOR" }]);
  });
  after(async () => {
    await server?.close();
    for (const id of [deviceId, pumpId]) await db.delete(devices).where(eq(devices.id, id));
    await closeAppDb(); await sqlClient.end();
  });
  it("morador não cria parâmetros e não consulta outro imóvel", async () => {
    assert.equal((await call(server.url, "/monitoring", { token: resident.accessToken, method: "POST", body: { buildingId: "bld_001", deviceId, kind: "ENERGY" } })).status, 403);
    assert.equal((await call(server.url, "/monitoring?buildingId=outro-imovel", { token: resident.accessToken })).status, 403);
  });
  it("configuração valida equipamento, tipo de limite e tarifa", async () => {
    assert.equal((await call(server.url, "/monitoring", { token: admin.accessToken, method: "POST", body: { buildingId: "bld_001", deviceId: "fora-do-imovel", kind: "ENERGY" } })).status, 400);
    assert.equal((await call(server.url, "/monitoring", { token: admin.accessToken, method: "POST", body: { buildingId: "bld_001", deviceId, kind: "ENERGY", tariff: -1 } })).status, 400);
    const response = await call(server.url, "/monitoring", { token: admin.accessToken, method: "POST", body: { buildingId: "bld_001", deviceId, kind: "ENERGY", tariff: 1, dailyCostLimit: 20, dailyLimit: 20 } });
    assert.equal(response.status, 201); profileId = (await json<{ id: string }>(response)).id;
    assert.equal((await call(server.url, "/monitoring", { token: admin.accessToken, method: "POST", body: { buildingId: "bld_001", deviceId, kind: "ENERGY" } })).status, 409);
  });
  it("50 kWh geram R$50 estimados e alertas únicos; repetição não duplica", async () => {
    await ingest(100, start); const notifications = await ingest(150, now);
    assert.ok(notifications.some(n => n.type === "DAILY_ENERGY_COST"));
    await ingest(150, now);
    const [usage] = await db.select().from(dailyUsage).where(and(eq(dailyUsage.profileId, profileId), eq(dailyUsage.day, key)));
    assert.equal(usage?.quantity, 50); assert.equal(usage?.estimatedCost, 50);
    const costs = await db.select().from(alerts).where(and(eq(alerts.deviceId, deviceId), eq(alerts.type, "DAILY_ENERGY_COST")));
    assert.equal(costs.length, 1);
  });
  it("não aprende com dias fora da janela de 28 dias", async () => {
    for (let offset = 40; offset <= 46; offset++) {
      const day = new Date(Date.parse(`${key}T12:00:00Z`) - offset * 86400000).toISOString().slice(0, 10), bounds = dayBounds(day, "America/Sao_Paulo");
      await db.insert(dailyUsage).values({ profileId, buildingId: "bld_001", day, quantity: 10, coveredSeconds: (bounds.end.getTime() - bounds.start.getTime()) / 1000, firstAt: bounds.start, lastAt: bounds.end, samples: 100 });
    }
    const notices = await ingest(150, new Date(now.getTime() + 500));
    assert.equal(notices.some(n => n.type === "ADAPTIVE_ENERGY_ANOMALY"), false);
  });
  it("aprende sete dias válidos e sinaliza aumento de 400%", async () => {
    for (let offset = 1; offset <= 7; offset++) {
      const day = new Date(Date.parse(`${key}T12:00:00Z`) - offset * 86400000).toISOString().slice(0, 10), bounds = dayBounds(day, "America/Sao_Paulo");
      await db.insert(dailyUsage).values({ profileId, buildingId: "bld_001", day, quantity: 10, coveredSeconds: (bounds.end.getTime() - bounds.start.getTime()) / 1000, firstAt: bounds.start, lastAt: bounds.end, samples: 100 });
    }
    const notices = await ingest(150, new Date(now.getTime() + 1000));
    assert.ok(notices.some(n => n.type === "ADAPTIVE_ENERGY_ANOMALY"));
    const response = await call(server.url, "/monitoring?buildingId=bld_001", { token: admin.accessToken });
    assert.equal(response.status, 200);
    const data = await json<{ items: Array<{ id: string; reference: { expected: number }; deviation: { changePercent: number }; today: { estimatedCost: number } }> }>(response);
    const item = data.items.find(p => p.id === profileId)!;
    assert.equal(item.reference.expected, 10); assert.equal(item.deviation.changePercent, 400); assert.equal(item.today.estimatedCost, 50);
  });
  it("RLS impede adulteração de totais e configuração pelo morador", async () => {
    await assert.rejects(withUserContext({ userId: "resident_demo", role: "RESIDENT" }, tx => tx.update(dailyUsage).set({ quantity: 0 }).where(eq(dailyUsage.profileId, profileId))));
    const response = await call(server.url, `/monitoring/${profileId}`, { token: resident.accessToken, method: "PATCH", body: { tariff: 0 } });
    assert.ok([403, 404].includes(response.status), "RLS pode ocultar a linha ao negar bloqueio de escrita");
    const rows = await withUserContext({ userId: "resident_demo", role: "RESIDENT" }, tx => tx.update(monitoringProfiles).set({ tariff: 0 }).where(eq(monitoringProfiles.id, profileId)).returning());
    assert.equal(rows.length, 0);
  });
  it("configuração de bomba aceita minutos e rejeita cobrança sem medidor", async () => {
    const path = "/monitoring", base = { buildingId: "bld_001", deviceId: pumpId, kind: "PUMP" };
    assert.equal((await call(server.url, path, { method: "POST", token: admin.accessToken, body: { ...base, tariff: 1 } })).status, 400);
    const response = await call(server.url, path, { method: "POST", token: admin.accessToken, body: { ...base, dailyLimit: 60, continuousLimitMinutes: 60, maxGapSeconds: 3600 } });
    assert.equal(response.status, 201);
    await ingest(true, new Date(now.getTime() - 7200000), pumpId, "pump_running");
    await ingest(true, new Date(now.getTime() - 3600000), pumpId, "pump_running");
    const result = await ingest(false, now, pumpId, "pump_running");
    assert.ok(result.some(n => n.type === "DAILY_PUMP_LIMIT")); assert.ok(result.some(n => n.type === "PUMP_CONTINUOUS_LIMIT"));
  });
});
