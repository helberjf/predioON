import { and, eq } from "drizzle-orm";
import { auditLogs, parkingLots, type DbTransaction } from "@predioon/db";
import { acceptParkingReading, type Telemetry } from "@predioon/shared";

/** Called after the ingest pipeline validates an enabled device/gateway and claims eventId. */
export async function applyParkingTelemetry(tx: DbTransaction, data: Telemetry, now = new Date()): Promise<boolean> {
  if (data.metric !== "parking_occupied") return false;
  const [lot] = await tx.select().from(parkingLots).where(and(eq(parkingLots.buildingId, data.buildingId), eq(parkingLots.sensorId, data.deviceId))).limit(1).for("update");
  if (!lot || !acceptParkingReading(lot, data, now)) return false;
  await tx.update(parkingLots).set({ occupied: data.value as number, source: "SENSOR", observedAt: new Date(data.timestamp), updatedAt: now, version: lot.version + 1 }).where(eq(parkingLots.id, lot.id));
  await tx.insert(auditLogs).values({ buildingId: data.buildingId, actorType: "SYSTEM", action: "PARKING_SENSOR_UPDATED", resourceType: "parking", resourceId: lot.id, metadata: { eventId: data.eventId, deviceId: data.deviceId, occupied: data.value, previousOccupied: lot.occupied } });
  return true;
}
