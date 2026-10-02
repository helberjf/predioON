import { sql } from "drizzle-orm";
import { readFeatures, type AppTransaction } from "@predioon/db/runtime";
import type { FeatureStates } from "@predioon/shared";
import { featureDisabled } from "../../auth/features.js";
import { forbidden, notFound } from "../../http/errors.js";

export async function assertNoticeScope(tx: AppTransaction, buildingId: string, manage = false): Promise<void> {
  const [row] = await tx.execute(sql`select app_notice_can_read_scope(${buildingId},${manage}) as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade necessária para avisos");
}

export async function assertNoticeCreation(tx: AppTransaction, buildingId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_has_capability(${buildingId},'notices:read') and app_has_capability(${buildingId},'notices:manage') as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade necessária para criar avisos");
}

export async function assertNoticeManagement(tx: AppTransaction, buildingId: string, noticeId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_notice_can_read(${buildingId},${noticeId}) as visible,
    app_notice_has_capability(${buildingId},${noticeId},'notices:manage') as manage`);
  if (!row?.visible) throw notFound("Aviso não encontrado");
  if (!row.manage) throw forbidden("Sem a capacidade necessária para gerenciar este aviso");
}

export function assertNoticeFeature(states: FeatureStates, category: string): void {
  const key = category === "GESTAO" ? "TRANSPARENCY" : "NOTICES";
  if (!states[key].enabled) throw featureDisabled(key);
}

/** Authorize before loading settings so hidden overrides cannot look enabled. */
export async function noticeFeatures(tx: AppTransaction, buildingId: string): Promise<FeatureStates> {
  await assertNoticeScope(tx, buildingId);
  return readFeatures(tx, buildingId);
}
