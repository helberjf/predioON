import { sql } from 'drizzle-orm';
import { readFeatures, type AppTransaction } from '@predioon/db/runtime';
import { featureDisabled } from '../../auth/features.js';
import { forbidden, notFound } from '../../http/errors.js';

export async function assertFinanceScope(tx:AppTransaction,buildingId:string):Promise<void> {
  const [row]=await tx.execute(sql`select app_finance_can_read_scope(${buildingId}) as allowed`);
  if(!row?.allowed)throw forbidden('Sem a capacidade necessária para consultar as contas');
}
export async function assertFinanceCreation(tx:AppTransaction,buildingId:string):Promise<void> {
  const [row]=await tx.execute(sql`select app_has_capability(${buildingId},'finance:read') and app_has_capability(${buildingId},'finance:manage') as allowed`);
  if(!row?.allowed)throw forbidden('Sem a capacidade necessária para criar uma prestação de contas');
}
export async function assertFinanceManagement(tx:AppTransaction,buildingId:string,id:string):Promise<void> {
  const [row]=await tx.execute(sql`select app_finance_has_capability(${buildingId},${id},'finance:read') as readable,
    app_finance_has_capability(${buildingId},${id},'finance:manage') as manageable`);
  if(!row?.readable)throw notFound('Prestação de contas não encontrada');
  if(!row.manageable)throw forbidden('Sem a capacidade necessária para gerenciar estas contas');
}
export async function assertFinanceFeature(tx:AppTransaction,buildingId:string):Promise<void> {
  await assertFinanceScope(tx,buildingId);
  if(!(await readFeatures(tx,buildingId)).FINANCE.enabled)throw featureDisabled('FINANCE');
}
