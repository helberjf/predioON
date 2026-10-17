import { lockParkingLot, writeParkingObservation, type IngestTransaction } from "@predioon/db/ingest";
import { acceptParkingReading, type Telemetry } from "@predioon/shared";

/** Validate the fresh lot under its lock before applying the observation. */
export async function applyParkingTelemetry(tx: IngestTransaction, data: Telemetry, now = new Date()): Promise<boolean> {
  if (data.metric !== "parking_occupied") return false;
  const lot = await lockParkingLot(tx, data.buildingId, data.deviceId);
  if (!lot || !acceptParkingReading(lot, data, now)) return false;
  return writeParkingObservation(tx, { lotId: lot.id, buildingId: data.buildingId, deviceId: data.deviceId,
    eventId: data.eventId, occupied: data.value as number, observedAt: new Date(data.timestamp), updatedAt: now, expectedVersion: lot.version });
}
