import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db, buildings, devices, gateways, ingestEvents, telemetry, lockFeatures, readFeatures } from "@predioon/db";
import type { Telemetry } from "@predioon/shared";
import { assertPersisted, PersistenceChecks, type AlertNotification } from "../notify/index.js";
import { publishRealtime } from "../realtime.js";
import { evaluateRules } from "../rules/evaluate.js";
import { normalizeTelemetry } from "./normalize.js";
import { accountUsage } from "../analytics/usage.js";
import { applyParkingTelemetry } from "../parking/index.js";
import { permitsReading } from "../features.js";

// postgres.js already decodes JSONB scalars; the generic JSONB column mapper
// parses strings a second time (e.g. "10" -> 10). Decode the text encoding once
// so confirmation preserves the literal source type as well as its value.
const telemetryProjection = { ...getTableColumns(telemetry),
  value: sql<Telemetry["value"]>`${telemetry.value}::text`.mapWith((encoded: string): Telemetry["value"] => JSON.parse(encoded)),
};

export type RejectionCategory = "INVALID_ENVELOPE" | "FUTURE_TIMESTAMP" | "UNKNOWN_SOURCE" | "CONTENT_CONFLICT" | "RETAINED_REPLAY";
type Executor = Pick<typeof db, "execute">;

/**
 * Bounded counters of what was refused or set aside: day, category and, only
 * for a validated source, the condominium. Never the payload or its identifiers.
 */
async function countRejection(executor: Executor, category: RejectionCategory, buildingId = ""): Promise<void> {
  await executor.execute(sql`insert into ingest_rejections(day,building_id,category) values((clock_timestamp() at time zone 'UTC')::date,${buildingId},${category})
    on conflict (day,building_id,category) do update set total=ingest_rejections.total+1, last_at=clock_timestamp()`);
}

/**
 * What makes two deliveries the same reading. Transport facts (QoS, DUP,
 * retain, arrival time) are deliberately left out; the value's type is kept,
 * so the text "10" never equals the number 10.
 */
export function readingFingerprint(data: Telemetry): string {
  return createHash("sha256").update(JSON.stringify([1, data.buildingId, data.deviceId, data.eventId, data.metric,
    typeof data.value, data.value, data.unit ?? null, data.quality, new Date(data.timestamp).toISOString()])).digest("hex");
}

/**
 * Persist an envelope atomically, then publish only accepted readings. The
 * broker receives the acknowledgement only after this function returns, so a
 * QoS 1 reading is either committed here or delivered again.
 *
 * A retained delivery is the broker replaying its last stored message, not a
 * new contact: it is kept as history once, without heartbeat, consumption,
 * parking, alerts or a live update.
 */
export async function handleTelemetry(topic: string, raw: Buffer, delivery: { retain?: boolean } = {}): Promise<void> {
  const retained = delivery.retain === true;
  const readings = normalizeTelemetry(topic, raw);
  const identity = readings[0];
  if (!identity) return countRejection(db, "INVALID_ENVELOPE");
  if (readings.some(reading => Date.parse(reading.timestamp) > Date.now() + 60_000)) return countRejection(db, "FUTURE_TIMESTAMP");

  const result = await db.transaction(async (tx) => {
    await lockFeatures(tx);
    const accepted: Telemetry[] = [];
    const createdAlerts: AlertNotification[] = [];
    const checks = new PersistenceChecks();
    const unknown = { accepted, createdAlerts, unknown: true };
    // Serialize a sensor's messages so concurrent deliveries share one cooldown check.
    const [device] = await tx.select().from(devices).where(and(
      eq(devices.id, identity.deviceId), eq(devices.buildingId, identity.buildingId), eq(devices.enabled, true),
    )).limit(1).for("update");
    if (!device) return unknown;
    const [building] = await tx.select({ active: buildings.active }).from(buildings).where(eq(buildings.id, identity.buildingId)).limit(1);
    if (!building?.active) return unknown;
    let gateway: typeof gateways.$inferSelect | undefined;
    if (device.gatewayId) {
      [gateway] = await tx.select().from(gateways).where(and(
        eq(gateways.id, device.gatewayId), eq(gateways.buildingId, identity.buildingId),
      )).limit(1).for("update");
      if (!gateway?.enabled) return unknown;
    }

    const features = await readFeatures(tx, identity.buildingId);
    for (const data of readings) {
      const time = new Date(data.timestamp);
      if (!await permitsReading(tx, features, data.buildingId, device, data.metric, time)) continue;
      const receipt: typeof ingestEvents.$inferSelect = { eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId, source: "MQTT", receivedAt: new Date(), fingerprint: readingFingerprint(data) };
      // The event belongs to its condominium and device: a homonym elsewhere is another reading.
      const sameEvent = and(eq(ingestEvents.buildingId, data.buildingId), eq(ingestEvents.deviceId, data.deviceId), eq(ingestEvents.eventId, data.eventId));
      const receipts = await tx.insert(ingestEvents).values(receipt).onConflictDoNothing().returning();
      if (!receipts.length) {
        const [duplicate] = await tx.select().from(ingestEvents).where(sameEvent).limit(1);
        if (!duplicate) throw new Error("Telemetry receipt write was not persisted");
        // The first body stands. A different body under the same identity produces no effect;
        // a row older than the fingerprint cannot be compared and keeps suppressing its identity.
        if (duplicate.fingerprint !== null && duplicate.fingerprint !== receipt.fingerprint) await countRejection(tx, "CONTENT_CONFLICT", data.buildingId);
        continue;
      }
      assertPersisted(receipts.length === 1 ? receipts[0] : undefined, receipt, "Telemetry receipt");
      const [persistedReceipt] = await tx.select().from(ingestEvents).where(sameEvent).limit(1);
      assertPersisted(persistedReceipt, receipt, "Telemetry receipt");
      checks.remember(`receipt:${receipt.buildingId}:${receipt.deviceId}:${receipt.eventId}`, async () => {
        const [persisted] = await tx.select().from(ingestEvents).where(sameEvent).limit(1);
        assertPersisted(persisted, receipt, "Telemetry receipt");
      });
      const sample: typeof telemetry.$inferSelect = {
        id: randomUUID(), receivedAt: new Date(),
        eventId: data.eventId, buildingId: data.buildingId, deviceId: data.deviceId,
        metric: data.metric, value: data.value,
        numericValue: typeof data.value === "number" ? data.value : typeof data.value === "boolean" ? Number(data.value) : null,
        unit: data.unit ?? null, quality: data.quality, time,
      };
      const samples = await tx.insert(telemetry).values(sample).returning(telemetryProjection);
      assertPersisted(samples.length === 1 ? samples[0] : undefined, sample, "Telemetry source");
      const [persistedSample] = await tx.select(telemetryProjection).from(telemetry).where(and(eq(telemetry.id, sample.id), eq(telemetry.time, sample.time))).limit(1);
      assertPersisted(persistedSample, sample, "Telemetry source");
      checks.remember(`sample:${sample.id}`, async () => {
        const [persisted] = await tx.select(telemetryProjection).from(telemetry).where(and(eq(telemetry.id, sample.id), eq(telemetry.time, sample.time))).limit(1);
        assertPersisted(persisted, sample, "Telemetry source");
      });
      if (retained) { await countRejection(tx, "RETAINED_REPLAY", data.buildingId); continue; }
      accepted.push(data);
      createdAlerts.push(...await accountUsage(tx, data, features, checks));
      await applyParkingTelemetry(tx, data);
      if (data.quality === "GOOD" && (typeof data.value === "number" || typeof data.value === "boolean")) {
        createdAlerts.push(...await evaluateRules(tx, {
          buildingId: data.buildingId, deviceId: data.deviceId, metric: data.metric, value: Number(data.value), time,
        }, checks));
      }
    }

    // A valid packet proves transport liveness even when every module is paused;
    // a retained replay proves nothing about the source being alive now.
    if (!retained) {
      const now = new Date();
      const expectedDevice = { ...device, status: "ONLINE" as const, lastSeenAt: now, updatedAt: now };
      const updatedDevices = await tx.update(devices).set({ status: "ONLINE", lastSeenAt: now, updatedAt: now }).where(eq(devices.id, device.id)).returning();
      assertPersisted(updatedDevices.length === 1 ? updatedDevices[0] : undefined, expectedDevice, "Device heartbeat");
      const [persistedDevice] = await tx.select().from(devices).where(eq(devices.id, device.id)).limit(1);
      assertPersisted(persistedDevice, expectedDevice, "Device heartbeat");
      checks.remember(`device:${device.id}`, async () => {
        const [persisted] = await tx.select().from(devices).where(eq(devices.id, device.id)).limit(1);
        assertPersisted(persisted, expectedDevice, "Device heartbeat");
      });
      if (gateway) {
        const expectedGateway = { ...gateway, status: "ONLINE" as const, lastSeenAt: now, updatedAt: now };
        const updatedGateways = await tx.update(gateways).set({ status: "ONLINE", lastSeenAt: now, updatedAt: now }).where(eq(gateways.id, gateway.id)).returning();
        assertPersisted(updatedGateways.length === 1 ? updatedGateways[0] : undefined, expectedGateway, "Gateway heartbeat");
        const [persistedGateway] = await tx.select().from(gateways).where(eq(gateways.id, gateway.id)).limit(1);
        assertPersisted(persistedGateway, expectedGateway, "Gateway heartbeat");
        checks.remember(`gateway:${gateway.id}`, async () => {
          const [persisted] = await tx.select().from(gateways).where(eq(gateways.id, expectedGateway.id)).limit(1);
          assertPersisted(persisted, expectedGateway, "Gateway heartbeat");
        });
      }
    }
    // Immediate triggers from later alerts, parking or heartbeats must not
    // invalidate a source already confirmed earlier in this transaction.
    await checks.verify();
    return { accepted, createdAlerts, unknown: false };
  });
  if (result.unknown) await countRejection(db, "UNKNOWN_SOURCE");

  for (const data of result.accepted) {
    await publishRealtime({ kind: "telemetry", buildingId: data.buildingId, deviceId: data.deviceId,
      metric: data.metric, value: data.value, unit: data.unit ?? null, quality: data.quality, time: new Date(data.timestamp).toISOString() });
  }
  for (const alert of result.createdAlerts) {
    await publishRealtime({ kind: "alert", buildingId: alert.buildingId, alertId: alert.alertId,
      deviceId: alert.deviceId, severity: alert.severity, type: alert.type, message: alert.message, status: "OPEN" });
  }
}
