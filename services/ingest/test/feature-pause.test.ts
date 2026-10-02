import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@predioon/db";
import { telemetryTopic } from "@predioon/shared";
import { handleTelemetry } from "../src/pipeline/telemetry.js";
import { notifyAlert } from "../src/notify/index.js";
import { config } from "../src/config.js";
import { accountUsage } from "../src/analytics/usage.js";
import { resolveFeatures, dayKey } from "@predioon/shared";
import { publishRealtime } from "../src/realtime.js";
import { dispatchAccessOnce } from "../src/access/dispatcher.js";
import type { MqttClient } from "mqtt";
import * as offline from "../src/offline-sweeper.js";

afterEach(() => mock.restoreAll());
test("paused device communication does not create module alerts; gateway communication still does", async () => {
  const state = fixture(); state.device.type = "WATER_LEVEL_SENSOR";
  assert.equal(typeof offline.raiseCommunicationAlert, "function");
  await offline.raiseCommunicationAlert({ buildingId: "building", deviceId: "mixed", message: "Sensor sem comunicação" });
  assert.equal(state.writes.filter(row => row.table === "alerts").length, 0);
  await offline.raiseCommunicationAlert({ buildingId: "building", gatewayId: "gateway", message: "Gateway sem comunicação" });
  assert.equal(state.writes.filter(row => row.table === "alerts").length, 1);
});

/** DB-boundary fixture: exercise the complete pipeline without the live database. */
function fixture() {
  const writes: Array<{ table: string; values: any }> = [];
  const statements: string[] = [];
  const updates: Array<{ table: string; values: any }> = [];
  const globalSettings = [{ key: "WATER_TANK", enabled: false, version: 1, updatedAt: new Date() }];
  const runtime: any[] = [];
  const device = { id: "mixed", buildingId: "building", gatewayId: "gateway", type: "ENERGY_METER", enabled: true };
  const rows: Record<string, any[] | (() => any[])> = {
    devices: [device], gateways: [{ id: "gateway", buildingId: "building", enabled: true }],
    buildings: [{ id: "building", active: true, organizationActive: true, timezone: "America/Sao_Paulo" }],
    global_feature_settings: globalSettings, building_feature_settings: [], feature_runtime: runtime,
  };
  const chain = (result: () => any[]): any => {
    const query: any = { then: (resolve: any, reject: any) => Promise.resolve().then(result).then(resolve, reject) };
    for (const method of ["where", "innerJoin", "limit", "for", "orderBy", "onConflictDoNothing", "onConflictDoUpdate", "returning"]) query[method] = () => query;
    return query;
  };
  const tx: any = {
    select: () => ({ from: (table: any) => chain(() => { const value = rows[getTableName(table)]; return typeof value === "function" ? value() : value ?? []; }) }),
    insert: (table: any) => ({ values: (values: any) => chain(() => { writes.push({ table: getTableName(table), values }); return [{ id: "alert", ...values }]; }) }),
    update: (table: any) => ({ set: (values: any) => chain(() => { updates.push({ table: getTableName(table), values }); return []; }) }),
    execute: async (query: any) => {
      const statement = new PgDialect().sqlToQuery(query).sql;
      statements.push(statement);
      if (statement.includes("app_mark_access_sent")) {
        // This fixture models the transaction boundary. Capability/clock/lock
        // decisions inside the transition are exercised against real Postgres
        // in access-capabilities.integration.test.ts.
        updates.push({ table: "gate_commands", values: { status: "SENT" } });
        return [{ reason: null }];
      }
      return [];
    },
  };
  let activeTransactions = 0;
  mock.method(db, "transaction", async (callback: any) => { activeTransactions++; try { return await callback(tx); } finally { activeTransactions--; } });
  mock.method(db, "execute", tx.execute);
  return { writes, updates, globalSettings, runtime, rows, device, tx, statements, activeTransactions: () => activeTransactions };
}

const message = (metric: string, timestamp = new Date().toISOString()) => Buffer.from(JSON.stringify({
  schemaVersion: 1, eventId: `${metric}-${timestamp}`, buildingId: "building", deviceId: "mixed", metric,
  value: metric === "water_level_percent" ? 40 : 100, quality: "GOOD", timestamp,
}));

test("one device keeps enabled metrics while paused metrics leave no raw or dedup rows", async () => {
  const state = fixture();
  await handleTelemetry(telemetryTopic("building", "mixed"), message("water_level_percent"));
  await handleTelemetry(telemetryTopic("building", "mixed"), message("energy_total_kwh"));
  assert.deepEqual(state.writes.filter(row => row.table === "telemetry").map(row => row.values.metric), ["energy_total_kwh"]);
  assert.equal(state.writes.filter(row => row.table === "ingest_events").length, 1);
});

test("realtime delivery rechecks a paused module while gateway status remains core", async () => {
  const state = fixture();
  await publishRealtime({ kind: "telemetry", buildingId: "building", deviceId: "mixed", metric: "water_level_percent", value: 40, time: new Date().toISOString() });
  assert.equal(state.statements.filter(query => query.includes("pg_notify")).length, 0);
  await publishRealtime({ kind: "gateway-status", buildingId: "building", gatewayId: "gateway", status: "ONLINE" });
  assert.equal(state.statements.filter(query => query.includes("pg_notify")).length, 1);
});

function accessFixture() {
  const state = fixture(), createdAt = new Date(Date.now() - 100);
  Object.assign(state.device, { type: "GATE_CONTROLLER", status: "ONLINE", lastSeenAt: new Date() });
  state.rows.gateways = [{ id: "gateway", buildingId: "building", enabled: true, status: "ONLINE", lastSeenAt: new Date() }];
  state.rows.gates = [{ id: "gate", buildingId: "building", gatewayId: "gateway", deviceId: "mixed", kind: "GARAGE", enabled: true, allowResidents: true }];
  state.rows.gate_commands = [{ id: "0c98c434-2071-4e57-9b8c-5f99948a51ad", gateId: "gate", buildingId: "building", gatewayId: "gateway", deviceId: "mixed", requestedBy: "user", createdAt, expiresAt: new Date(Date.now() + 15000), status: "PENDING" }];
  return { ...state, createdAt };
}

test("a pending gate command is failed without publishing when its feature is paused", async () => {
  const state = accessFixture(); state.globalSettings.push({ key: "GARAGE_ACCESS", enabled: false, version: 1, updatedAt: new Date() });
  let published = 0;
  const client = { connected: true, options: { queueQoSZero: false }, publish: (...args: any[]) => { published++; args[3](); } } as MqttClient;
  await dispatchAccessOnce(client, state.createdAt);
  assert.equal(published, 0);
  assert.ok(state.updates.some(row => row.table === "gate_commands" && row.values.status === "FAILED"));
  assert.ok(!state.updates.some(row => row.values.status === "SENT"));
});

test("physical gate publish happens after SENT commit while the feature lock transaction stays open", async () => {
  const state = accessFixture(); let published = 0, activeAtPublish = -1, sentAtPublish = false;
  const client = { connected: true, options: { queueQoSZero: false }, publish: (...args: any[]) => {
    published++;
    activeAtPublish = state.activeTransactions();
    sentAtPublish = state.updates.some(row => row.table === "gate_commands" && row.values.status === "SENT");
    args[3]();
  } } as MqttClient;
  await dispatchAccessOnce(client, state.createdAt);
  assert.equal(published, 1);
  assert.equal(activeAtPublish, 1, "outer feature transaction must outlive the committed command claim");
  assert.equal(sentAtPublish, true);
});

test("a fully paused sensor still refreshes both hardware heartbeats", async () => {
  const state = fixture();
  await handleTelemetry(telemetryTopic("building", "mixed"), message("water_level_percent"));
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.updates.map(row => row.table).sort(), ["devices", "gateways"]);
  assert.ok(state.updates.every(row => row.values.status === "ONLINE" && row.values.lastSeenAt instanceof Date));
});

test("reactivation rejects queued readings at or before the restart boundary", async () => {
  const state = fixture(); state.globalSettings.length = 0;
  const resumedAt = new Date(Date.now() - 1000);
  state.runtime.push({ buildingId: "building", key: "WATER_TANK", resumedAt, pausedAt: null, generation: 2 });
  for (const offset of [-1, 0, 1]) await handleTelemetry(telemetryTopic("building", "mixed"), message("water_level_percent", new Date(resumedAt.getTime() + offset).toISOString()));
  assert.equal(state.writes.filter(row => row.table === "telemetry").length, 1);
  assert.equal(state.updates.filter(row => row.table === "devices").length, 3);
});

test("first resumed cumulative reading establishes a new baseline and an incomplete day", async () => {
  const state = fixture();
  const now = Date.now(), resumedAt = new Date(now - 1000), before = new Date(now - 2000);
  state.rows.monitoring_profiles = [{ id: "profile", buildingId: "building", deviceId: "mixed", kind: "ENERGY", enabled: true,
    maxGapSeconds: 3600, tariff: 1, adaptiveEnabled: false, dailyLimit: null, dailyCostLimit: null, continuousLimitMinutes: null }];
  state.rows.usage_cursors = [{ profileId: "profile", lastAt: before, lastValue: 100, good: true, continuousSeconds: 0 }];
  const features = resolveFeatures([], []); features.ENERGY_CONSUMPTION.resumedAt = resumedAt.toISOString();
  await accountUsage(state.tx, JSON.parse(message("energy_total_kwh").toString()), features);
  const day = state.writes.find(row => row.table === "daily_usage")?.values;
  assert.equal(day?.coveredSeconds, 0, "paused interval cannot contribute measurement coverage");
  assert.equal(day?.incomplete, true, "a day containing a pause must not train adaptive alerts");
});

test("delivery rechecks a rule metric after the module was paused", async () => {
  const state = fixture();
  state.rows.alerts = [{ id: "alert", buildingId: "building", deviceId: "mixed", ruleId: "rule", type: "CUSTOM_WATER", triggeredAt: new Date() }];
  state.rows.alert_rules = [{ id: "rule", metric: "water_level_percent" }];
  const delivered: string[] = [];
  mock.method(console, "log", (...args: any[]) => { delivered.push(args.join(" ")); });
  mock.method(globalThis, "fetch", async () => { delivered.push("webhook"); return new Response(); });
  const previous = config.ALERT_WEBHOOK_URL; config.ALERT_WEBHOOK_URL = "https://alerts.example.test";
  try {
    await notifyAlert({ alertId: "alert", buildingId: "building", deviceId: "mixed", severity: "HIGH", type: "CUSTOM_WATER", message: "Old queued alert", triggeredAt: new Date().toISOString() });
    assert.deepEqual(delivered, []);
  } finally { config.ALERT_WEBHOOK_URL = previous; }
});

for (const scenario of ["AI paused", "incomplete training days"]) test(`${scenario} skips adaptive alerts while preserving base usage limits`, async () => {
  const state = fixture(), features = resolveFeatures([], []), now = new Date();
  features.AI_ANALYSIS.enabled = scenario !== "AI paused";
  const day = dayKey(now, "America/Sao_Paulo");
  state.rows.monitoring_profiles = [{ id: "profile", buildingId: "building", deviceId: "mixed", kind: "ENERGY", enabled: true,
    maxGapSeconds: 3600, tariff: 1, adaptiveEnabled: true, minimumHistoryDays: 7, deviationPercent: 50,
    dailyLimit: 10, dailyCostLimit: null, continuousLimitMinutes: null }];
  const today = { profileId: "profile", day, quantity: 100, coveredSeconds: 86000, estimatedCost: 100, resets: 0, samples: 10, firstAt: now, lastAt: now, incomplete: false };
  let dailyReads = 0;
  state.rows.daily_usage = () => ++dailyReads <= 2 ? [today] : Array.from({ length: 7 }, (_, index) => ({
    ...today, day: new Date(Date.parse(`${day}T12:00:00Z`) - (index + 1) * 86400000).toISOString().slice(0, 10), quantity: 1, incomplete: scenario === "incomplete training days",
  }));
  await accountUsage(state.tx, JSON.parse(message("energy_total_kwh").toString()), features);
  assert.deepEqual(state.writes.filter(row => row.table === "alerts").map(row => row.values.type), ["DAILY_ENERGY_LIMIT"]);
});
