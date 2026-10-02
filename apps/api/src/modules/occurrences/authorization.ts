import { sql } from 'drizzle-orm';
import { readFeatures, type AppTransaction } from '@predioon/db/runtime';
import type { FeatureKey, FeatureStates } from '@predioon/shared';
import { featureDisabled } from '../../auth/features.js';
import { forbidden, notFound } from '../../http/errors.js';

export async function assertOccurrenceScope(tx:AppTransaction,buildingId:string,manage=false) {
  const [row]=await tx.execute(sql`select app_occurrence_can_read_scope(${buildingId},${manage}) as allowed`);
  if(!row?.allowed)throw forbidden('Sem a capacidade necessária para chamados');
}
export async function assertOccurrenceAccess(tx:AppTransaction,buildingId:string,id:string,requireManagement=false) {
  const [row]=await tx.execute(sql`select app_occurrence_has_capability(${buildingId},${id},'occurrences:manage') as manage,app_occurrence_has_capability(${buildingId},${id},'occurrences:read-own') as own`);
  if(!row?.manage&&!row?.own)throw notFound('Chamado não encontrado');
  if(requireManagement&&!row.manage)throw forbidden('Sem a capacidade necessária para gerenciar este chamado');
  return Boolean(row.manage);
}
export async function assertOccurrenceGroup(tx:AppTransaction,buildingId:string,id:string) {
  const [row]=await tx.execute(sql`select app_occurrence_can_manage_group(${buildingId},${id}) as allowed`);
  if(!row?.allowed)throw forbidden('Sem a capacidade necessária para todos os chamados deste grupo');
}
export async function occurrenceFeatures(tx:AppTransaction,buildingId:string) {
  await assertOccurrenceScope(tx,buildingId);
  return readFeatures(tx,buildingId);
}
export function assertOccurrenceFeature(states:FeatureStates,key:FeatureKey='TICKETS') {
  if(!states[key].enabled)throw featureDisabled(key);
}
