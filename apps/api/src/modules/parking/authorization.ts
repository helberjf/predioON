import { sql } from "drizzle-orm";
import { readFeatures, type AppTransaction } from "@predioon/db/runtime";
import { parkingFeature, type FeatureStates } from "@predioon/shared";
import { featureDisabled } from "../../auth/features.js";
import { badRequest, forbidden, notFound } from "../../http/errors.js";

export type ParkingSubject = {
  id: string;
  buildingId: string;
  sensorId: string | null;
  vehicleType: string;
};

export async function assertParkingScope(
  tx: AppTransaction,
  buildingId: string,
): Promise<void> {
  const [row] = await tx.execute(
    sql`select app_parking_can_read_scope(${buildingId}) as allowed`,
  );
  if (!row?.allowed)
    throw forbidden("Sem a capacidade necessária para consultar vagas");
}
export async function assertParkingManagement(
  tx: AppTransaction,
  parking: ParkingSubject,
): Promise<void> {
  const [row] =
    await tx.execute(sql`select app_parking_has_capability(${parking.buildingId},${parking.id},'parking:read') as readable,
    app_parking_has_capability(${parking.buildingId},${parking.id},'parking:manage') as manageable`);
  if (!row?.readable) throw notFound("Estacionamento não encontrado");
  if (!row.manageable)
    throw forbidden("Sem a capacidade necessária para gerenciar estas vagas");
}
export async function assertParkingTarget(
  tx: AppTransaction,
  buildingId: string,
  sensorId: string | null,
): Promise<void> {
  const [row] =
    await tx.execute(sql`select app_parking_target_has_capability(${buildingId},${sensorId},'parking:read') and
    app_parking_target_has_capability(${buildingId},${sensorId},'parking:manage') as allowed`);
  if (!row?.allowed)
    throw forbidden("Sensor de destino fora da concessão atual");
}
export async function assertParkingSensor(
  tx: AppTransaction,
  buildingId: string,
  sensorId: string | null,
  parkingId: string | null = null,
): Promise<void> {
  const [row] = await tx.execute(
    sql`select app_parking_sensor_configurable(${buildingId},${parkingId},${sensorId}) as allowed`,
  );
  if (!row?.allowed)
    throw badRequest(
      "Selecione um sensor de estacionamento ativo e com gateway válido deste prédio",
    );
}
export async function lockParkingTarget(
  tx: AppTransaction,
  parking: ParkingSubject,
  sensorId: string,
): Promise<void> {
  const [row] = await tx.execute(
    sql`select app_parking_lock_target(${parking.buildingId},${parking.id},${sensorId}) as allowed`,
  );
  if (!row?.allowed) {
    await assertParkingManagement(tx, parking);
    throw forbidden("Sensor de destino fora da concessão atual");
  }
}
export async function parkingFeatures(
  tx: AppTransaction,
  buildingId: string,
): Promise<FeatureStates> {
  await assertParkingScope(tx, buildingId);
  return readFeatures(tx, buildingId);
}
export function assertParkingFeature(
  states: FeatureStates,
  vehicleType: string,
): void {
  const key = parkingFeature(vehicleType);
  if (!states[key].enabled) throw featureDisabled(key);
}
