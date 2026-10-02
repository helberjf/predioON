import { sql } from "drizzle-orm";
import { readFeatures, type AppTransaction } from "@predioon/db/runtime";
import { gateFeature, type FeatureStates } from "@predioon/shared";
import { featureDisabled } from "../../auth/features.js";
import { forbidden } from "../../http/errors.js";

export type AccessSubject = {
  id: string;
  buildingId: string;
  gatewayId: string;
  deviceId: string;
  kind: string;
};
export async function accessFeatures(
  tx: AppTransaction,
  buildingId: string,
): Promise<FeatureStates> {
  const [row] = await tx.execute(
    sql`select app_access_can_read_scope(${buildingId}) as allowed`,
  );
  if (!row?.allowed) throw forbidden("Sem permissão atual para este acesso");
  return readFeatures(tx, buildingId);
}
export function assertAccessFeature(states: FeatureStates, kind: string): void {
  const feature = gateFeature(kind);
  if (!states[feature].enabled) throw featureDisabled(feature);
}
export async function accessPermissions(
  tx: AppTransaction,
  gate: Pick<AccessSubject, "id" | "buildingId">,
) {
  const [row] = await tx.execute(sql`select
    app_access_has_capability(${gate.buildingId},${gate.id},'gates:read') as readable,
    app_access_has_capability(${gate.buildingId},${gate.id},'gates:manage') as manageable,
    app_access_request_permitted(${gate.buildingId},${gate.id}) as requestable`);
  return {
    readable: row?.readable === true,
    manageable: row?.manageable === true,
    requestable: row?.requestable === true,
  };
}
export async function assertAccessManagement(
  tx: AppTransaction,
  gate: AccessSubject,
): Promise<void> {
  const permissions = await accessPermissions(tx, gate);
  if (!permissions.readable || !permissions.manageable)
    throw forbidden("Sem permissão atual para configurar este acesso");
}
export async function lockAccessTarget(
  tx: AppTransaction,
  buildingId: string,
  gateId: string | null,
  gatewayId: string,
  deviceId: string,
): Promise<void> {
  const [row] = await tx.execute(
    sql`select app_access_lock_target(${buildingId},${gateId},${gatewayId},${deviceId}) as allowed`,
  );
  if (!row?.allowed)
    throw forbidden("Controlador e gateway fora da concessão atual");
}
