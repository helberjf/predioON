import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { financialReports, type AppTransaction } from '@predioon/db/runtime';
import { FinancialContentSchema, financialTotals } from '@predioon/shared';
import { currentAuth, inTenantContext } from '../../auth/middleware.js';
import { badRequest, conflict, forbidden, HttpError, notFound, pgErrorCode } from '../../http/errors.js';
import { param } from '../../http/params.js';
import { PaginationSchema } from '../../http/pagination.js';
import { query, validateBody, validateQuery } from '../../http/validate.js';
import { recordAudit } from '../audit/repo.js';
import { assertFinanceCreation, assertFinanceFeature, assertFinanceManagement, assertFinanceScope } from './authorization.js';

export const financeRouter=Router();
financeRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
const List=PaginationSchema.extend({buildingId:z.string().min(1),month:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).optional()});
const Create=FinancialContentSchema.safeExtend({buildingId:z.string().min(1)});
const Edit=FinancialContentSchema.safeExtend({version:z.number().int().positive()});
const Publish=z.object({version:z.number().int().positive()}).strict();
const view=(row:typeof financialReports.$inferSelect)=>({...row,totals:financialTotals(row)});
function idParam(req:Parameters<typeof param>[0]){const parsed=z.string().uuid().safeParse(param(req,'id'));if(!parsed.success)throw badRequest('Identificador de prestação inválido');return parsed.data;}

/** SQL errors can contain private descriptions, amounts and receipt URLs. */
async function inFinance<T>(req:Request,run:(tx:AppTransaction)=>Promise<T>):Promise<T> {
  try{return await inTenantContext(req,run);}catch(error){
    const code=pgErrorCode(error);
    if(code==='42501')throw forbidden('Sem a capacidade necessária para estas contas');
    if(['23503','23514','22007','22008','22023'].includes(code??''))throw badRequest('Dados da prestação de contas inválidos');
    if(['23505','40001','40P01'].includes(code??''))throw conflict('As contas foram alteradas. Recarregue antes de tentar novamente.');
    if(code)throw new HttpError(500,'Não foi possível salvar ou consultar as contas');
    throw error;
  }
}
async function lockMonth(tx:AppTransaction,buildingId:string,month:string){
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`finance:${buildingId}:${month}`},0))`);
}
/** All mutations use month then row order, with fresh authorization after waits. */
async function lockedReport(tx:AppTransaction,id:string){
  const [visible]=await tx.select().from(financialReports).where(eq(financialReports.id,id)).limit(1);
  if(!visible)throw notFound('Prestação de contas não encontrada');
  await assertFinanceManagement(tx,visible.buildingId,id);
  await lockMonth(tx,visible.buildingId,visible.month);
  const [afterMonth]=await tx.select().from(financialReports).where(eq(financialReports.id,id)).limit(1);
  if(!afterMonth)throw notFound('Prestação de contas não encontrada');
  await assertFinanceManagement(tx,afterMonth.buildingId,id);
  // UPDATE RLS intentionally excludes published reports. They are immutable,
  // so idempotent publication needs a fresh read, not a writable-row lookup.
  if(!afterMonth.publishedAt)await tx.select({id:financialReports.id}).from(financialReports).where(eq(financialReports.id,id)).for('update');
  const [current]=await tx.select().from(financialReports).where(eq(financialReports.id,id)).limit(1);
  if(!current)throw notFound('Prestação de contas não encontrada');
  await assertFinanceManagement(tx,current.buildingId,id);
  await assertFinanceFeature(tx,current.buildingId);
  return current;
}

financeRouter.get('/',validateQuery(List),async(req,res)=>{
  const {buildingId,month,limit,offset}=query<z.infer<typeof List>>(req);
  const items=await inFinance(req,async tx=>{
    await assertFinanceScope(tx,buildingId);await assertFinanceFeature(tx,buildingId);
    const rows=await tx.select().from(financialReports).where(and(eq(financialReports.buildingId,buildingId),month?eq(financialReports.month,month):undefined))
      .orderBy(desc(financialReports.month),desc(financialReports.revision)).limit(limit).offset(offset);
    await assertFinanceScope(tx,buildingId);
    if(!rows.length)return [];
    const current=await tx.select({id:financialReports.id}).from(financialReports).where(and(eq(financialReports.buildingId,buildingId),inArray(financialReports.id,rows.map(row=>row.id))));
    const visible=new Set(current.map(row=>row.id));return rows.filter(row=>visible.has(row.id));
  });
  res.json({items:items.map(view),limit,offset});
});
financeRouter.post('/',validateBody(Create),async(req,res)=>{
  const input=req.body as z.infer<typeof Create>,auth=currentAuth(req);
  const row=await inFinance(req,async tx=>{
    await assertFinanceCreation(tx,input.buildingId);
    await lockMonth(tx,input.buildingId,input.month);
    await assertFinanceCreation(tx,input.buildingId);await assertFinanceFeature(tx,input.buildingId);
    const [previous]=await tx.select({revision:financialReports.revision}).from(financialReports)
      .where(and(eq(financialReports.buildingId,input.buildingId),eq(financialReports.month,input.month))).orderBy(desc(financialReports.revision)).limit(1);
    const id=randomUUID();
    await tx.insert(financialReports).values({...input,id,revision:(previous?.revision??0)+1,createdBy:auth.userId});
    // The point helper sees the inserted parent in this new statement.
    const [created]=await tx.select().from(financialReports).where(eq(financialReports.id,id)).limit(1);
    if(!created)throw forbidden('Sem a capacidade necessária para estas contas');
    await recordAudit(tx,req,{buildingId:input.buildingId,userId:auth.userId,action:'FINANCIAL_DRAFT_CREATED',resourceType:'financial_report',resourceId:id});
    return created;
  });res.status(201).json(view(row));
});
financeRouter.put('/:id',validateBody(Edit),async(req,res)=>{
  const id=idParam(req),{version,month,...input}=req.body as z.infer<typeof Edit>;
  const row=await inFinance(req,async tx=>{
    const current=await lockedReport(tx,id);
    if(current.publishedAt)throw conflict('Prestação publicada é preservada. Crie uma nova revisão para corrigir.');
    if(month!==current.month)throw badRequest('O mês de um rascunho não pode ser alterado. Crie outro rascunho.');
    if(version!==current.version)throw conflict('Este rascunho foi alterado. Atualize a página antes de salvar.');
    const [updated]=await tx.update(financialReports).set({...input,version:current.version+1,updatedAt:sql`clock_timestamp()`})
      .where(and(eq(financialReports.id,id),eq(financialReports.version,version))).returning();
    if(!updated)throw conflict('Este rascunho foi alterado. Atualize a página antes de salvar.');
    await recordAudit(tx,req,{buildingId:current.buildingId,userId:currentAuth(req).userId,action:'FINANCIAL_DRAFT_UPDATED',resourceType:'financial_report',resourceId:id});
    return updated;
  });res.json(view(row));
});
financeRouter.post('/:id/publish',validateBody(Publish),async(req,res)=>{
  const id=idParam(req),{version}=req.body as z.infer<typeof Publish>,auth=currentAuth(req);
  const row=await inFinance(req,async tx=>{
    const current=await lockedReport(tx,id);
    if(current.publishedAt)return current;
    if(version!==current.version)throw conflict('Este rascunho foi alterado. Atualize e confira antes de publicar.');
    const [revision]=await tx.execute(sql`select app_finance_can_publish_revision(${current.buildingId},${id}) as allowed`);
    if(!revision?.allowed)throw conflict('Já existe uma revisão mais recente publicada. Crie uma nova correção.');
    const [updated]=await tx.update(financialReports).set({publishedAt:sql`clock_timestamp()`,publishedBy:auth.userId,version:current.version+1,updatedAt:sql`clock_timestamp()`})
      .where(and(eq(financialReports.id,id),eq(financialReports.version,version))).returning();
    if(!updated)throw conflict('Este rascunho foi alterado. Atualize e confira antes de publicar.');
    await recordAudit(tx,req,{buildingId:current.buildingId,userId:auth.userId,action:'FINANCIAL_REPORT_PUBLISHED',resourceType:'financial_report',resourceId:id,metadata:{month:current.month,revision:current.revision}});
    return updated;
  });res.json(view(row));
});
