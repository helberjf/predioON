import { randomUUID } from 'node:crypto';
import { Router,type Request } from 'express';
import { asc,eq,inArray,sql } from 'drizzle-orm';
import { z } from 'zod';
import { alertRules,type AppTransaction } from '@predioon/db/runtime';
import type { FeatureStates } from '@predioon/shared';
import { currentAuth,inTenantContext } from '../../auth/middleware.js';
import { badRequest,conflict,forbidden,HttpError,notFound,pgErrorCode } from '../../http/errors.js';
import { query,validateBody,validateQuery } from '../../http/validate.js';
import { param } from '../../http/params.js';
import { recordAudit } from '../audit/repo.js';
import { assertRuleFeatures,assertRuleManagement,assertRuleScope,assertRuleTarget,lockRuleTarget,ruleContext,ruleFeatureKeys,ruleFeatures,targetContext } from './authorization.js';

export const alertRulesRouter=Router();
alertRulesRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
const List=z.object({buildingId:z.string().min(1).optional()});
const Fields=z.object({
  deviceId:z.string().min(1).nullable(),name:z.string().min(2).max(120),metric:z.string().min(1).max(64),
  operator:z.enum(['LT','LTE','GT','GTE','EQ','NEQ']),threshold:z.number().finite(),
  severity:z.enum(['INFO','LOW','MEDIUM','HIGH','CRITICAL']),alertType:z.string().min(2).max(60),
  messageTemplate:z.string().min(3).max(300),cooldownSeconds:z.number().int().min(0).max(86400),
});
const Create=Fields.extend({buildingId:z.string().min(1),deviceId:Fields.shape.deviceId.optional(),severity:Fields.shape.severity.default('MEDIUM'),cooldownSeconds:Fields.shape.cooldownSeconds.default(300)}).strict();
const Edit=Fields.partial().extend({enabled:z.boolean().optional()}).strict();
function ruleId(req:Request){const id=param(req,'ruleId');if(!z.string().uuid().safeParse(id).success)throw notFound('Regra não encontrada');return id;}
async function inRules<T>(req:Request,run:(tx:AppTransaction)=>Promise<T>):Promise<T>{
  try{return await inTenantContext(req,run);}catch(error){const code=pgErrorCode(error);
    if(code==='42501')throw forbidden('Sem a capacidade necessária para esta regra');
    if(['23503','23514','22023','22P02'].includes(code??''))throw badRequest('Dados da regra inválidos');
    if(['23505','40001','40P01'].includes(code??''))throw conflict('A regra foi alterada. Recarregue antes de tentar novamente.');
    if(code)throw new HttpError(500,'Não foi possível salvar ou consultar as regras');throw error;
  }
}
async function lockedRule(tx:AppTransaction,id:string,mode:'update'|'no key update',targetDeviceId?:string|null){
  const [visible]=await tx.select().from(alertRules).where(eq(alertRules.id,id)).limit(1);if(!visible)throw notFound('Regra não encontrada');
  await assertRuleManagement(tx,visible);
  // Lock every explicitly supplied non-null target before the rule, even if
  // equal to the first read: another writer may retarget while we wait.
  if(targetDeviceId)await lockRuleTarget(tx,visible,targetDeviceId);
  await tx.select({id:alertRules.id}).from(alertRules).where(eq(alertRules.id,id)).for(mode);
  // New statements refresh both the authorization clock and the stored parent.
  const [current]=await tx.select().from(alertRules).where(eq(alertRules.id,id)).limit(1);if(!current)throw notFound('Regra não encontrada');
  await assertRuleManagement(tx,current);return current;
}

alertRulesRouter.get('/',validateQuery(List),async(req,res)=>{
  const {buildingId}=query<z.infer<typeof List>>(req);
  const rows=await inRules(req,async tx=>{
    if(buildingId)await assertRuleScope(tx,buildingId);
    const candidates=await tx.select().from(alertRules).where(buildingId?eq(alertRules.buildingId,buildingId):undefined).orderBy(asc(alertRules.name));
    const states=new Map<string,FeatureStates>(),visible:typeof candidates=[];
    for(const rule of candidates){
      const context=await ruleContext(tx,rule);if(!context)continue;
      if(!states.has(rule.buildingId))states.set(rule.buildingId,await ruleFeatures(tx,rule.buildingId));
      if(ruleFeatureKeys(rule.metric,context).every(key=>states.get(rule.buildingId)![key].enabled))visible.push(rule);
    }
    if(buildingId)await assertRuleScope(tx,buildingId);
    if(!visible.length)return [];
    const current=await tx.select({id:alertRules.id}).from(alertRules).where(inArray(alertRules.id,visible.map(row=>row.id)));
    const allowed=new Set(current.map(row=>row.id));return visible.filter(row=>allowed.has(row.id));
  });res.json({items:rows});
});
alertRulesRouter.post('/',validateBody(Create),async(req,res)=>{
  const input=req.body as z.infer<typeof Create>,auth=currentAuth(req);
  const row=await inRules(req,async tx=>{
    await assertRuleTarget(tx,input.buildingId,input.deviceId??null);
    const context=await targetContext(tx,input.buildingId,input.deviceId??null);
    assertRuleFeatures(await ruleFeatures(tx,input.buildingId),input.metric,context);
    // Explicit columns preserve the database-only timestamp grant boundary;
    // the generic insert builder emits even omitted columns as DEFAULT.
    const id=randomUUID();await tx.execute(sql`insert into alert_rules
      (id,building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds,created_by)
      values (${id}::uuid,${input.buildingId},${input.deviceId??null},${input.name},${input.metric},${input.operator},${input.threshold},
        ${input.severity},${input.alertType},${input.messageTemplate},${input.cooldownSeconds},${auth.userId})`);
    const [created]=await tx.select().from(alertRules).where(eq(alertRules.id,id)).limit(1);if(!created)throw forbidden('Sem a capacidade necessária para esta regra');
    await recordAudit(tx,req,{buildingId:input.buildingId,userId:auth.userId,action:'ALERT_RULE_CREATED',resourceType:'alert_rule',resourceId:id,metadata:{metric:input.metric,operator:input.operator,threshold:input.threshold}});
    return created;
  });res.status(201).json(row);
});
alertRulesRouter.patch('/:ruleId',validateBody(Edit),async(req,res)=>{
  const id=ruleId(req),input=req.body as z.infer<typeof Edit>,auth=currentAuth(req);
  const row=await inRules(req,async tx=>{
    const current=await lockedRule(tx,id,'no key update',input.deviceId),context=await ruleContext(tx,current);if(!context)throw notFound('Regra não encontrada');
    const states=await ruleFeatures(tx,current.buildingId);assertRuleFeatures(states,current.metric,context);
    const proposed={...current,...input};let proposedContext=context;
    if(proposed.deviceId!==current.deviceId){await assertRuleTarget(tx,current.buildingId,proposed.deviceId);proposedContext=await targetContext(tx,current.buildingId,proposed.deviceId);}
    assertRuleFeatures(states,proposed.metric,proposedContext);
    const [updated]=await tx.update(alertRules).set({...input,updatedAt:sql`clock_timestamp()`}).where(eq(alertRules.id,id)).returning();
    if(!updated)throw forbidden('Sem a capacidade necessária para esta regra');
    await recordAudit(tx,req,{buildingId:current.buildingId,userId:auth.userId,action:'ALERT_RULE_UPDATED',resourceType:'alert_rule',resourceId:id,metadata:input});return updated;
  });res.json(row);
});
alertRulesRouter.delete('/:ruleId',async(req,res)=>{
  const id=ruleId(req),auth=currentAuth(req);
  await inRules(req,async tx=>{
    const current=await lockedRule(tx,id,'update'),context=await ruleContext(tx,current);if(!context)throw notFound('Regra não encontrada');
    assertRuleFeatures(await ruleFeatures(tx,current.buildingId),current.metric,context);
    // Point authorization must see the parent. Both audit and deletion roll back
    // when a subsequent authorization check or the actual DELETE removes nothing.
    await recordAudit(tx,req,{buildingId:current.buildingId,userId:auth.userId,action:'ALERT_RULE_DELETED',resourceType:'alert_rule',resourceId:id});
    const deleted=await tx.delete(alertRules).where(eq(alertRules.id,id)).returning({id:alertRules.id});
    if(!deleted.length)throw forbidden('Sem a capacidade necessária para esta regra');
  });res.status(204).end();
});
