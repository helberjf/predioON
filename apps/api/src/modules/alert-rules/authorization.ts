import { sql } from 'drizzle-orm';
import { readFeatures, type AppTransaction } from '@predioon/db/runtime';
import { deviceFeatures,gateFeature,metricFeature,parkingFeature,type FeatureKey,type FeatureStates } from '@predioon/shared';
import { featureDisabled } from '../../auth/features.js';
import { forbidden,notFound } from '../../http/errors.js';

type RuleContext={device_type:string|null;gate_kind:string|null;parking_vehicle_type:string|null};
export type RuleSubject={id:string;buildingId:string;deviceId:string|null;metric:string};

export async function assertRuleScope(tx:AppTransaction,buildingId:string):Promise<void>{
  const [row]=await tx.execute(sql`select app_alert_rule_can_read_scope(${buildingId}) as allowed`);
  if(!row?.allowed)throw forbidden('Sem a capacidade necessária para consultar regras');
}
export async function assertRuleManagement(tx:AppTransaction,rule:RuleSubject):Promise<void>{
  const [row]=await tx.execute(sql`select app_alert_rule_has_capability(${rule.buildingId},${rule.id},'alert-rules:read') as readable,
    app_alert_rule_has_capability(${rule.buildingId},${rule.id},'alert-rules:manage') as manageable`);
  if(!row?.readable)throw notFound('Regra não encontrada');
  if(!row.manageable)throw forbidden('Sem a capacidade necessária para gerenciar esta regra');
}
export async function assertRuleTarget(tx:AppTransaction,buildingId:string,deviceId:string|null):Promise<void>{
  const [row]=await tx.execute(sql`select app_alert_rule_target_has_capability(${buildingId},${deviceId},'alert-rules:read') and
    app_alert_rule_target_has_capability(${buildingId},${deviceId},'alert-rules:manage') as allowed`);
  if(!row?.allowed)throw forbidden('Destino da regra fora da concessão atual');
}
export async function lockRuleTarget(tx:AppTransaction,rule:RuleSubject,deviceId:string):Promise<void>{
  const [row]=await tx.execute(sql`select app_alert_rule_lock_target(${rule.buildingId},${rule.id},${deviceId}) as allowed`);
  if(!row?.allowed){await assertRuleManagement(tx,rule);throw forbidden('Destino da regra fora da concessão atual');}
}
export async function ruleContext(tx:AppTransaction,rule:RuleSubject):Promise<RuleContext|null>{
  const [row]=await tx.execute(sql`select * from app_alert_rule_context(${rule.buildingId},${rule.id})`);
  return (row as RuleContext|undefined)??null;
}
export async function targetContext(tx:AppTransaction,buildingId:string,deviceId:string|null):Promise<RuleContext>{
  const [row]=await tx.execute(sql`select * from app_alert_rule_target_context(${buildingId},${deviceId})`);
  if(!row)throw forbidden('Destino da regra fora da concessão atual');return row as RuleContext;
}
/** Preserve canonical metric precedence, then the real hardware classification. */
export function ruleFeatureKeys(metric:string,context:RuleContext):FeatureKey[]{
  const canonical=metricFeature(metric);if(canonical)return [canonical];
  if(!context.device_type)return [];
  if(context.device_type==='PARKING_SENSOR'&&context.parking_vehicle_type)return [parkingFeature(context.parking_vehicle_type)];
  if(['GARAGE_GATE','PEDESTRIAN_GATE','GATE_CONTROLLER'].includes(context.device_type)&&context.gate_kind)return [gateFeature(context.gate_kind)];
  return deviceFeatures(context.device_type);
}
export async function ruleFeatures(tx:AppTransaction,buildingId:string):Promise<FeatureStates>{
  await assertRuleScope(tx,buildingId);return readFeatures(tx,buildingId);
}
export function assertRuleFeatures(states:FeatureStates,metric:string,context:RuleContext):void{
  for(const key of ruleFeatureKeys(metric,context))if(!states[key].enabled)throw featureDisabled(key);
}
