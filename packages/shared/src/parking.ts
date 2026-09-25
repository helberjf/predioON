import { z } from "zod";

export const ParkingVehicleTypeSchema = z.enum(["CAR", "MOTORCYCLE"]);
export const ParkingConfigSchema = z.object({
  buildingId: z.string().min(1),
  vehicleType: ParkingVehicleTypeSchema,
  capacity: z.number().int().min(0).max(100_000),
  sensorId: z.string().min(1).nullable().default(null),
  staleAfterSeconds: z.number().int().min(30).max(86_400).default(300),
});
export const ParkingOccupancySchema = z.object({ occupied: z.number().int().min(0).max(100_000), version: z.number().int().positive() });
export type ParkingVehicleType = z.infer<typeof ParkingVehicleTypeSchema>;
export type ParkingSnapshot = {
  capacity: number; occupied: number | null; observedAt: Date | string | null; staleAfterSeconds: number;
};
export type ParkingLotView = ParkingSnapshot & {
  id: string; buildingId: string; vehicleType: ParkingVehicleType; source: "UNKNOWN" | "MANUAL" | "SENSOR";
  sensorId: string | null; updatedAt: string; version: number; available: number | null;
  status: "CURRENT" | "STALE" | "UNKNOWN";
};

export function parkingAvailability(lot: ParkingSnapshot, now = new Date()): Pick<ParkingLotView, "available" | "status"> {
  const time = lot.observedAt ? new Date(lot.observedAt).getTime() : NaN;
  if (lot.occupied === null || !Number.isInteger(lot.occupied) || lot.occupied < 0 || lot.occupied > lot.capacity || !Number.isFinite(time) || time > now.getTime()) {
    return { available: null, status: "UNKNOWN" };
  }
  if (now.getTime() - time > lot.staleAfterSeconds * 1000) return { available: null, status: "STALE" };
  return { available: lot.capacity - lot.occupied, status: "CURRENT" };
}

export function acceptParkingReading(
  lot: ParkingSnapshot & { sensorId: string | null },
  reading: { deviceId: string; metric: string; value: unknown; quality: string; timestamp: string },
  now = new Date(),
): boolean {
  if (!lot.sensorId || lot.sensorId !== reading.deviceId || reading.metric !== "parking_occupied" || reading.quality !== "GOOD") return false;
  if (typeof reading.value !== "number" || !Number.isInteger(reading.value) || reading.value < 0 || reading.value > lot.capacity) return false;
  const time = new Date(reading.timestamp).getTime();
  const age = now.getTime() - time;
  if (!Number.isFinite(time) || age < 0 || age > lot.staleAfterSeconds * 1000) return false;
  return !lot.observedAt || time > new Date(lot.observedAt).getTime();
}
