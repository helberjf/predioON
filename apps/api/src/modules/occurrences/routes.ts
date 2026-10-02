import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { occurrenceEvents, occurrences, type AppTransaction } from '@predioon/db/runtime';
import { duplicateTopic, TicketCreateSchema, TicketPrioritySchema } from '@predioon/shared';
import { currentAuth, inTenantContext } from '../../auth/middleware.js';
import { badRequest, conflict, forbidden, HttpError, notFound, pgErrorCode } from '../../http/errors.js';
import { PaginationSchema } from '../../http/pagination.js';
import { param } from '../../http/params.js';
import { query, validateBody, validateQuery } from '../../http/validate.js';
import { recordAudit } from '../audit/repo.js';
import { assertOccurrenceAccess, assertOccurrenceFeature, assertOccurrenceGroup, assertOccurrenceScope, occurrenceFeatures } from './authorization.js';

export const occurrencesRouter = Router();
const OPEN_STATUSES = ['OPEN', 'IN_ANALYSIS', 'IN_PROGRESS'] as const;
const Status = z.enum(['OPEN', 'IN_ANALYSIS', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
const List = PaginationSchema.extend({ buildingId: z.string().optional(), status: Status.optional(), onlyOpen: z.enum(['true', 'false']).default('false').transform(v => v === 'true') });
const Update = z.object({ status: Status.optional(), priority: TicketPrioritySchema.optional(), priorityReason: z.string().trim().min(3).max(1000).optional(), assignedTo: z.string().min(1).nullable().optional(), applyToGroup: z.boolean().default(false) }).strict()
  .refine(v => v.priority === undefined || v.priorityReason !== undefined, 'Explique a alteração de gravidade')
  .refine(v => v.status !== undefined || v.priority !== undefined || v.assignedTo !== undefined, 'Informe o que será alterado');
const Comment = z.object({ message: z.string().trim().min(1).max(2000), applyToGroup: z.boolean().default(false) }).strict();
const Group = z.object({ buildingId: z.string().min(1), occurrenceIds: z.array(z.string().uuid()).min(2).max(50).refine(ids => new Set(ids).size === ids.length, 'Selecione chamados diferentes') }).strict();
type Occurrence = typeof occurrences.$inferSelect;
function occurrenceId(req: Request) {
  const result = z.string().uuid().safeParse(param(req, 'occurrenceId'));
  if (!result.success) throw badRequest('Identificador de chamado inválido'); return result.data;
}
async function inOccurrences<T>(req:Request,run:(tx:AppTransaction)=>Promise<T>):Promise<T> {
  try {return await inTenantContext(req,run);} catch(error) {
    const code=pgErrorCode(error);
    if(code==='P0002')throw notFound('Chamado não encontrado');
    if(code==='42501')throw forbidden('Sem a capacidade necessária para chamados');
    if(['23503','23514','22007','22008','22023'].includes(code??''))throw badRequest('Dados de chamado inválidos');
    if(['P0409','23505','40001','40P01'].includes(code??''))throw conflict('O chamado foi alterado. Recarregue antes de tentar novamente.');
    if(code)throw new HttpError(500,'Não foi possível salvar ou consultar os chamados');
    throw error;
  }
}
async function lockBuilding(tx:AppTransaction,buildingId:string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`occurrences:${buildingId}`},0))`);
}
async function readOne(tx:AppTransaction,id:string) {
  const [row]=await tx.select().from(occurrences).where(eq(occurrences.id,id)).limit(1);
  if(!row)throw notFound('Chamado não encontrado');return row;
}
async function revalidate(tx:AppTransaction,rows:Occurrence[],manage=false) {
  if(!rows.length)return [];
  const valid=await tx.select({id:occurrences.id}).from(occurrences).where(and(inArray(occurrences.id,rows.map(row=>row.id)),manage?sql`app_occurrence_has_capability(${occurrences.buildingId},${occurrences.id}::text,'occurrences:manage')`:undefined));
  const ids=new Set(valid.map(row=>row.id));return rows.filter(row=>ids.has(row.id));
}
/** Preauthorize before either lock. Re-read after each possible wait. Requester
 * writes use narrow owner routines, since read-own never grants SQL UPDATE. */
async function editable(tx:AppTransaction,id:string,collective:boolean,requireManagement:boolean) {
  let current=await readOne(tx,id);
  await assertOccurrenceAccess(tx,current.buildingId,id,requireManagement||collective);
  if(collective)await assertOccurrenceGroup(tx,current.buildingId,id);
  await lockBuilding(tx,current.buildingId);
  current=await readOne(tx,id);
  let manage=await assertOccurrenceAccess(tx,current.buildingId,id,requireManagement||collective);
  if(collective)await assertOccurrenceGroup(tx,current.buildingId,id);
  const targetQuery=()=>and(eq(occurrences.buildingId,current.buildingId),collective&&current.groupId?eq(occurrences.groupId,current.groupId):eq(occurrences.id,id));
  if(manage)await tx.select({id:occurrences.id}).from(occurrences).where(targetQuery()).orderBy(asc(occurrences.id)).for('update');
  current=await readOne(tx,id);
  manage=await assertOccurrenceAccess(tx,current.buildingId,id,requireManagement||collective);
  if(collective)await assertOccurrenceGroup(tx,current.buildingId,id);
  const targets=collective&&current.groupId?await tx.select().from(occurrences).where(targetQuery()).orderBy(asc(occurrences.id)):[current];
  return {current,targets,manage};
}
occurrencesRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
occurrencesRouter.get('/',validateQuery(List),async(req,res)=>{
  const {buildingId,status,onlyOpen,limit,offset}=query<z.infer<typeof List>>(req);
  const items=await inOccurrences(req,async tx=>{
    if(buildingId)assertOccurrenceFeature(await occurrenceFeatures(tx,buildingId));
    const candidates=await tx.select().from(occurrences).where(and(buildingId?eq(occurrences.buildingId,buildingId):undefined,status?eq(occurrences.status,status):undefined,onlyOpen?inArray(occurrences.status,[...OPEN_STATUSES]):undefined))
      .orderBy(sql`case when ${occurrences.priority} in ('HIGH','URGENT') then 0 when ${occurrences.priority}='NORMAL' then 1 else 2 end`,desc(occurrences.createdAt));
    const active=new Set<string>();
    for(const tenant of new Set(candidates.map(row=>row.buildingId))) {
      // Revoke between initial read and feature lookup simply removes this
      // tenant's cached rows; it must not reveal its contents or counts.
      const [scope]=await tx.execute(sql`select app_occurrence_can_read_scope(${tenant},false) as allowed`);
      if(scope?.allowed&&(await occurrenceFeatures(tx,tenant)).TICKETS.enabled)active.add(tenant);
    }
    return (await revalidate(tx,candidates.filter(row=>active.has(row.buildingId)))).slice(offset,offset+limit);
  });res.json({items,limit,offset});
});
occurrencesRouter.get('/duplicates',validateQuery(z.object({buildingId:z.string().min(1)})),async(req,res)=>{
  const {buildingId}=query<{buildingId:string}>(req);
  const items=await inOccurrences(req,async tx=>{
    await assertOccurrenceScope(tx,buildingId,true);const features=await occurrenceFeatures(tx,buildingId);
    assertOccurrenceFeature(features);assertOccurrenceFeature(features,'TICKET_GROUPING');
    const candidates=await tx.select().from(occurrences).where(and(eq(occurrences.buildingId,buildingId),inArray(occurrences.status,[...OPEN_STATUSES]),isNull(occurrences.groupId),sql`app_occurrence_has_capability(${occurrences.buildingId},${occurrences.id}::text,'occurrences:manage')`)).orderBy(desc(occurrences.createdAt)).limit(1000);
    const rows=await revalidate(tx,candidates,true),grouped=new Map<string,Occurrence[]>();
    for(const row of rows){const key=duplicateTopic(row.category,row.title,row.location);grouped.set(key,[...(grouped.get(key)??[]),row]);}
    return [...grouped.values()].filter(rows=>rows.length>=3).map(rows=>({title:rows[0]!.title,location:rows[0]!.location,count:rows.length,occurrenceIds:rows.slice(0,50).map(row=>row.id)}));
  });res.json({items});
});
occurrencesRouter.post('/group',validateBody(Group),async(req,res)=>{
  const {buildingId,occurrenceIds}=req.body as z.infer<typeof Group>,auth=currentAuth(req);
  const result=await inOccurrences(req,async tx=>{
    await assertOccurrenceScope(tx,buildingId,true);
    const select=()=>tx.select().from(occurrences).where(and(eq(occurrences.buildingId,buildingId),inArray(occurrences.id,occurrenceIds))).orderBy(asc(occurrences.id));
    async function checked(){const rows=await select();if(rows.length!==occurrenceIds.length)throw notFound('Um dos chamados não pertence a este condomínio');for(const row of rows)await assertOccurrenceAccess(tx,buildingId,row.id,true);return rows;}
    await checked();await lockBuilding(tx,buildingId);await checked();await select().for('update');const rows=await checked();
    const features=await occurrenceFeatures(tx,buildingId);assertOccurrenceFeature(features);assertOccurrenceFeature(features,'TICKET_GROUPING');
    if(rows.some(row=>row.groupId||!OPEN_STATUSES.includes(row.status as typeof OPEN_STATUSES[number])))throw conflict('Selecione apenas chamados abertos e ainda não agrupados');
    const groupId=randomUUID();
    const updated=await tx.update(occurrences).set({groupId,updatedAt:sql`clock_timestamp()`}).where(inArray(occurrences.id,occurrenceIds)).returning({id:occurrences.id});
    if(updated.length!==rows.length)throw notFound('Um dos chamados não está mais disponível');
    await tx.insert(occurrenceEvents).values(rows.map(row=>({occurrenceId:row.id,buildingId,authorId:auth.userId,kind:'GROUPED',message:'A administração vinculou este chamado a um atendimento conjunto do mesmo problema.'})));
    await recordAudit(tx,req,{buildingId,userId:auth.userId,action:'OCCURRENCES_GROUPED',resourceType:'occurrence_group',resourceId:groupId,metadata:{occurrenceIds}});
    return {groupId,count:rows.length};
  });res.status(201).json(result);
});
occurrencesRouter.get('/:occurrenceId',async(req,res)=>{
  const id=occurrenceId(req);
  const payload=await inOccurrences(req,async tx=>{
    const row=await readOne(tx,id);assertOccurrenceFeature(await occurrenceFeatures(tx,row.buildingId));
    const timeline=await tx.select().from(occurrenceEvents).where(and(eq(occurrenceEvents.occurrenceId,id),eq(occurrenceEvents.buildingId,row.buildingId))).orderBy(occurrenceEvents.createdAt,occurrenceEvents.id);
    await assertOccurrenceAccess(tx,row.buildingId,id);return {...row,timeline};
  });res.json(payload);
});
occurrencesRouter.post('/',validateBody(TicketCreateSchema),async(req,res)=>{
  const input=req.body as z.infer<typeof TicketCreateSchema>,auth=currentAuth(req);
  const result=await inOccurrences(req,async tx=>{
    const [permission]=await tx.execute(sql`select app_has_capability(${input.buildingId},'occurrences:create-own') and app_has_capability(${input.buildingId},'occurrences:read-own') as allowed`);
    if(!permission?.allowed)throw forbidden('Sem a capacidade necessária para abrir e acompanhar chamados');
    const features=await occurrenceFeatures(tx,input.buildingId);assertOccurrenceFeature(features);
    const [sequence]=await tx.execute(sql`select next_occurrence_protocol() as protocol`),id=randomUUID();
    await tx.insert(occurrences).values({...input,id,priority:features.TICKET_PRIORITY.enabled?input.priority:'NORMAL',protocol:String(sequence!.protocol),openedBy:auth.userId});
    const created=await readOne(tx,id);
    await tx.insert(occurrenceEvents).values({occurrenceId:id,buildingId:input.buildingId,authorId:auth.userId,kind:'CREATED',message:input.title});
    await assertOccurrenceAccess(tx,input.buildingId,id);return created;
  });res.status(201).json(result);
});
occurrencesRouter.patch('/:occurrenceId',validateBody(Update),async(req,res)=>{
  const id=occurrenceId(req),auth=currentAuth(req),input=req.body as z.infer<typeof Update>;
  const result=await inOccurrences(req,async tx=>{
    const ownCancel=input.status==='CANCELLED'&&input.assignedTo===undefined&&input.priority===undefined&&input.priorityReason===undefined&&!input.applyToGroup;
    const {current,targets,manage}=await editable(tx,id,input.applyToGroup,!ownCancel);
    const features=await occurrenceFeatures(tx,current.buildingId);assertOccurrenceFeature(features);
    if(input.priority!==undefined)assertOccurrenceFeature(features,'TICKET_PRIORITY');if(input.applyToGroup)assertOccurrenceFeature(features,'TICKET_GROUPING');
    if(!manage){
      await tx.execute(sql`select app_occurrence_cancel_own(${current.buildingId},${id}::uuid)`);
      await recordAudit(tx,req,{buildingId:current.buildingId,userId:auth.userId,action:'OCCURRENCE_UPDATED',resourceType:'occurrence',resourceId:id,metadata:input});
    } else {
      if(input.assignedTo){const [target]=await tx.execute(sql`select app_occurrence_assignee_active(${current.buildingId},${id},${input.assignedTo}) as allowed`);if(!target?.allowed)throw badRequest('Responsável sem vínculo ativo com o condomínio');}
      for(const target of targets){
        if(target.id!==id&&!OPEN_STATUSES.includes(target.status as typeof OPEN_STATUSES[number]))continue;
        await assertOccurrenceAccess(tx,target.buildingId,target.id,true);if(input.applyToGroup)await assertOccurrenceGroup(tx,current.buildingId,id);
        const closing=input.status==='DONE'||input.status==='CANCELLED';
        const changed=await tx.update(occurrences).set({...(input.status?{status:input.status,closedAt:closing?target.closedAt??sql`clock_timestamp()`:null}:{}),...(input.priority?{priority:input.priority}:{}),...(input.assignedTo!==undefined?{assignedTo:input.assignedTo}:{}),updatedAt:sql`clock_timestamp()`}).where(eq(occurrences.id,target.id)).returning({id:occurrences.id});
        if(!changed.length)throw notFound('Chamado não encontrado');
        const base={occurrenceId:target.id,buildingId:target.buildingId,authorId:auth.userId};
        if(input.status&&input.status!==target.status)await tx.insert(occurrenceEvents).values({...base,kind:'STATUS_CHANGED',message:`${target.status} → ${input.status}`});
        if(input.priority&&input.priority!==target.priority)await tx.insert(occurrenceEvents).values({...base,kind:'PRIORITY_CHANGED',message:input.priorityReason!,metadata:{from:target.priority,to:input.priority}});
        await recordAudit(tx,req,{buildingId:target.buildingId,userId:auth.userId,action:'OCCURRENCE_UPDATED',resourceType:'occurrence',resourceId:target.id,metadata:input});
      }
    }
    return readOne(tx,id);
  });res.json(result);
});
occurrencesRouter.post('/:occurrenceId/comments',validateBody(Comment),async(req,res)=>{
  const id=occurrenceId(req),auth=currentAuth(req),{message,applyToGroup}=req.body as z.infer<typeof Comment>;
  const result=await inOccurrences(req,async tx=>{
    const {current,targets,manage}=await editable(tx,id,applyToGroup,applyToGroup);
    const features=await occurrenceFeatures(tx,current.buildingId);assertOccurrenceFeature(features);if(applyToGroup)assertOccurrenceFeature(features,'TICKET_GROUPING');
    if(!manage)await tx.execute(sql`select app_occurrence_touch_own(${current.buildingId},${id}::uuid)`);
    else {
      if(applyToGroup)await assertOccurrenceGroup(tx,current.buildingId,id);
      const changed=await tx.update(occurrences).set({updatedAt:sql`clock_timestamp()`}).where(inArray(occurrences.id,targets.map(row=>row.id))).returning({id:occurrences.id});
      if(changed.length!==targets.length)throw notFound('Chamado não encontrado');
    }
    const inserted=await tx.insert(occurrenceEvents).values(targets.map(target=>({occurrenceId:target.id,buildingId:target.buildingId,authorId:auth.userId,kind:'COMMENT',message}))).returning();
    await recordAudit(tx,req,{buildingId:current.buildingId,userId:auth.userId,action:'OCCURRENCE_COMMENTED',resourceType:'occurrence',resourceId:id,metadata:{applyToGroup,count:targets.length}});
    await assertOccurrenceAccess(tx,current.buildingId,id);return inserted.find(event=>event.occurrenceId===id)!;
  });res.status(201).json(result);
});
