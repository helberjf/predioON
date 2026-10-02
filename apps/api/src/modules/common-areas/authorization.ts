import { sql } from "drizzle-orm";
import { readFeatures, type AppTransaction } from "@predioon/db/runtime";
import { featureDisabled } from "../../auth/features.js";
import { forbidden, notFound } from "../../http/errors.js";

export async function assertCommonAreaScope(tx: AppTransaction, buildingId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_common_area_can_read_scope(${buildingId}) as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade necessária para consultar áreas comuns");
}

export async function assertCommonAreaCreation(tx: AppTransaction, buildingId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_has_capability(${buildingId},'common-areas:read')
    and app_has_capability(${buildingId},'common-areas:manage') as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade necessária para criar áreas comuns");
}

export async function assertCommonAreaManagement(tx: AppTransaction, buildingId: string, areaId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_common_area_has_capability(${buildingId},${areaId},'common-areas:read') as visible,
    app_common_area_has_capability(${buildingId},${areaId},'common-areas:manage') as manage`);
  if (!row?.visible) throw notFound("Área comum não encontrada");
  if (!row.manage) throw forbidden("Sem a capacidade necessária para gerenciar esta área comum");
}

/** Scope is authorized before hidden settings could be mistaken for defaults. */
export async function assertCommonAreaFeature(tx: AppTransaction, buildingId: string): Promise<void> {
  await assertCommonAreaScope(tx, buildingId);
  const states = await readFeatures(tx, buildingId);
  if (!states.RESERVATIONS.enabled) throw featureDisabled("RESERVATIONS");
}
