import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlatformServiceHealth } from "@predioon/contracts";
import { formatBytes, serviceStatuses } from "../src/service-health-state.ts";

const now = "2026-10-17T12:00:00.000Z";
const minutesAgo = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();
const healthy = (): PlatformServiceHealth => ({
  checkedAt: now,
  ingest: { lastReadingAt: minutesAgo(1), lastReceivedAt: minutesAgo(1), readingsLastHour: 3000, gatewaysOnline: 2, gatewaysEnabled: 2 },
  notifications: { waiting: 0, oldestWaitingSince: null, deliveredLastDay: 4, failedLastDay: 0 },
  physicalCommands: { waiting: 0, acknowledgedLastDay: 3, failedLastDay: 0 },
  jobs: [{ name: "automations", scheduled: true, intervalSeconds: 300, lastStatus: "Success", lastSuccessAt: minutesAgo(3), failures: 0, nextStartAt: minutesAgo(-2) }],
  database: { bytes: 3 * 1024 ** 3, telemetryBytes: 512 * 1024 ** 2 },
});
const tones = (health: PlatformServiceHealth) => Object.fromEntries(serviceStatuses(health).map(status => [status.key, status.tone]));

test("everything working reads as ok, with the database as information only", () => {
  assert.deepEqual(tones(healthy()), { ingest: "ok", notifications: "ok", commands: "ok", scheduler: "ok", database: "idle" });
  const [ingest, , , scheduler, database] = serviceStatuses(healthy());
  assert.equal(ingest!.detail, "3000 leituras na última hora; última há 1 min.");
  assert.equal(scheduler!.detail, "Automações executadas há 3 min.");
  assert.equal(database!.detail, "3,0 GB no total, 512,0 MB de leituras.");
});

test("ingestion stopped is flagged only when gateways are online to send", () => {
  const stale = healthy(); stale.ingest.lastReceivedAt = minutesAgo(40);
  assert.equal(tones(stale).ingest, "attention");
  assert.match(serviceStatuses(stale)[0]!.detail, /há 40 min, com 2 gateways online/);
  const offline = healthy(); offline.ingest.lastReceivedAt = minutesAgo(40); offline.ingest.gatewaysOnline = 0;
  assert.equal(tones(offline).ingest, "ok", "the gateways tile already reports them offline");
  const none = healthy(); none.ingest.gatewaysEnabled = 0;
  assert.equal(tones(none).ingest, "idle");
  const never = healthy(); never.ingest.lastReceivedAt = null;
  assert.equal(tones(never).ingest, "attention");
});

test("a queue not draining or failed deliveries need attention", () => {
  const queued = healthy(); queued.notifications.waiting = 3; queued.notifications.oldestWaitingSince = minutesAgo(25);
  assert.equal(serviceStatuses(queued)[1]!.detail, "3 avisos aguardando há 25 min.");
  const failed = healthy(); failed.notifications.failedLastDay = 1;
  assert.equal(serviceStatuses(failed)[1]!.detail, "1 falha nas últimas 24 h.");
  const fresh = healthy(); fresh.notifications.waiting = 1; fresh.notifications.oldestWaitingSince = minutesAgo(2);
  assert.equal(tones(fresh).notifications, "ok");
});

test("commands without answer and scheduler problems are explained", () => {
  const commands = healthy(); commands.physicalCommands.failedLastDay = 2;
  assert.equal(tones(commands).commands, "attention");
  const missing = healthy(); missing.jobs = [];
  assert.match(serviceStatuses(missing)[3]!.detail, /não está registrada/);
  const failing = healthy(); failing.jobs[0]!.lastStatus = "Failed";
  failing.jobs.push({ name: "telemetry-retention", scheduled: false, intervalSeconds: 86400, lastStatus: null, lastSuccessAt: null, failures: 0, nextStartAt: null });
  assert.equal(serviceStatuses(failing)[3]!.detail, "automações: última execução falhou; retenção: pausada.");
});

test("sizes use Brazilian decimal commas", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1,5 KB");
});
