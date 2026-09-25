import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { db, sqlClient, parkingLots } from "@predioon/db";
import { eq } from "drizzle-orm";
import { handleTelemetry } from "../src/pipeline/telemetry.js";

const suffix = randomUUID().slice(0, 8);
const buildingId = `parking_ingest_${suffix}`;
const organizationId = `parking_org_${suffix}`;
const deviceId = `parking_car_${suffix}`;
const motoId = `parking_moto_${suffix}`;
const otherId = `parking_other_${suffix}`;
const gatewayId = `parking_gw_${suffix}`;
let lotId: string;
const send = (value: unknown, extra: Record<string, unknown> = {}) => {
  const data = { schemaVersion: 1, buildingId, deviceId, metric: "parking_occupied", quality: "GOOD", value, timestamp: new Date(Date.now() - 100).toISOString(), eventId: randomUUID(), ...extra };
  return handleTelemetry(`predio/${data.buildingId}/device/${data.deviceId}/telemetry`, Buffer.from(JSON.stringify(data)));
};
const readLot = async () => (await db.select().from(parkingLots).where(eq(parkingLots.id, lotId)))[0]!;

describe("parking ingest integration", () => {
  before(async () => {
    await sqlClient`insert into organizations (id, name, slug) values (${organizationId}, 'Parking ingest', ${organizationId})`;
    await sqlClient`insert into buildings (id, organization_id, name, code) values (${buildingId}, ${organizationId}, 'Parking ingest', ${buildingId})`;
    await sqlClient`insert into gateways (id, building_id, name, serial_number) values (${gatewayId}, ${buildingId}, 'Parking gateway', ${gatewayId})`;
    for (const id of [deviceId, motoId, otherId]) await sqlClient`insert into devices (id, building_id, gateway_id, name, type) values (${id}, ${buildingId}, ${gatewayId}, 'Parking sensor', 'PARKING_SENSOR')`;
    const [car] = await db.insert(parkingLots).values({ buildingId, vehicleType: "CAR", capacity: 20, sensorId: deviceId }).returning();
    lotId = car!.id;
    await db.insert(parkingLots).values({ buildingId, vehicleType: "MOTORCYCLE", capacity: 6, sensorId: motoId });
  });
  after(async () => {
    await sqlClient`delete from telemetry where building_id = ${buildingId}`;
    await sqlClient`delete from audit_logs where building_id = ${buildingId}`;
    await sqlClient`delete from buildings where id = ${buildingId}`;
    await sqlClient`delete from organizations where id = ${organizationId}`;
    await sqlClient.end();
  });
  it("starts unknown and updates only the configured vehicle type", async () => {
    assert.equal((await readLot()).occupied, null);
    await send(9);
    assert.equal((await readLot()).occupied, 9);
    assert.equal((await readLot()).source, "SENSOR");
    const [moto] = await sqlClient`select occupied from parking_lots where building_id = ${buildingId} and vehicle_type = 'MOTORCYCLE'`;
    assert.equal(moto!.occupied, null);
  });
  it("rejects invalid counts, unconfigured sensors, stale data and bad quality", async () => {
    const before = await readLot();
    for (const value of [-1, 21, 1.2, "10", false]) await send(value);
    await send(2, { deviceId: otherId });
    await send(2, { quality: "BAD" });
    await send(2, { timestamp: new Date(Date.now() - 600_000).toISOString() });
    await send(2, { timestamp: new Date(Date.now() + 60_000).toISOString() });
    await send(2, { buildingId: "bld_001" });
    const after = await readLot();
    assert.equal(after.occupied, before.occupied);
    assert.equal(after.version, before.version);
  });
  it("does not let delayed telemetry overwrite a manual count, but resumes on a newer reading", async () => {
    const manualTime = new Date(Date.now() - 50);
    await db.update(parkingLots).set({ occupied: 4, source: "MANUAL", observedAt: manualTime }).where(eq(parkingLots.id, lotId));
    await send(8, { timestamp: new Date(manualTime.getTime() - 1).toISOString() });
    assert.equal((await readLot()).occupied, 4);
    await send(8, { timestamp: new Date(manualTime.getTime() + 1).toISOString() });
    assert.equal((await readLot()).occupied, 8);
    assert.equal((await readLot()).source, "SENSOR");
    await send(3, { timestamp: manualTime.toISOString() });
    assert.equal((await readLot()).occupied, 8);
  });
  it("ignores disabled devices and disabled gateways", async () => {
    const before = await readLot();
    await sqlClient`update devices set enabled = false where id = ${deviceId}`;
    await send(1);
    await sqlClient`update devices set enabled = true where id = ${deviceId}`;
    await sqlClient`update gateways set enabled = false where id = ${gatewayId}`;
    await send(1);
    assert.equal((await readLot()).version, before.version);
  });
  it("records a sensor update audit trail", async () => {
    const rows = await sqlClient`select metadata from audit_logs where resource_id = ${lotId} and action = 'PARKING_SENSOR_UPDATED'`;
    assert.ok(rows.length >= 2);
    assert.ok(rows.every(row => row.metadata.deviceId === deviceId));
  });
});
