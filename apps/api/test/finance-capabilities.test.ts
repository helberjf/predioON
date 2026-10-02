import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { sqlClient } from '@predioon/db';
import { appDb, closeAppDb, withUserContext } from '@predioon/db/runtime';
import { hashPassword } from '../src/auth/passwords.js';
import { pgErrorCode } from '../src/http/errors.js';
import { call, login, startTestServer, type TestServer } from './helpers.js';

describe('finance separates published reading, private reading and current management',()=>{
  let server:TestServer,passwordHash:string;
  const temporaryPermissions:string[]=[];
  before(async()=>{
    passwordHash=await hashPassword('predioon123');server=await startTestServer();
    // Permit behavior RED against the previous schema without failing fixture FKs.
    // After migration these rows already exist and this fixture does not own them.
    for(const [key,action] of [['finance:read-published','read-published'],['finance:manage','manage']]) {
      const rows=await sqlClient`insert into permissions(key,resource_type,action,label) values(${key!},'finance',${action!},${key!}) on conflict(key) do nothing returning key`;
      temporaryPermissions.push(...rows.map(row=>row.key));
    }
  });
  after(async()=>{await server?.close();if(temporaryPermissions.length)await sqlClient`delete from permissions where key in ${sqlClient(temporaryPermissions)}`;await closeAppDb();await sqlClient.end();});
  const as=<T>(userId:string,run:Parameters<typeof withUserContext<T>>[1])=>withUserContext({userId,role:'PLATFORM_ADMIN'},run);
  const content=(month='2026-08')=>({month,title:'Private monthly accounts',summary:'Private supplier costs',openingBalanceCents:10000,entries:[
    {type:'INCOME',category:'Cotas',description:'Arrecadação',amountCents:20010,date:month+'-01',receiptUrl:null},
    {type:'EXPENSE',category:'Manutenção',description:'Lâmpadas',amountCents:1001,date:month+'-02',receiptUrl:'https://example.com/receipt.pdf'},
  ]});
  async function fixture(run:(f:Fixture)=>Promise<void>) {
    const suffix=randomUUID(),org=`fin-org-${suffix}`,a=`fin-a-${suffix}`,b=`fin-b-${suffix}`;
    const kinds=['manager','reader','published','worker','exact','exactpublished','exactdraft','resident','platform','flag','support','telemetry','outsider','action'] as const;
    const ids=Object.fromEntries(kinds.map(kind=>[kind,`fin-${kind}-${suffix}`])) as Record<typeof kinds[number],string>;
    const roles={manager:`FIN_MANAGER_${suffix}`,reader:`FIN_READER_${suffix}`,published:`FIN_PUBLISHED_${suffix}`,action:`FIN_ACTION_${suffix}`,telemetry:`FIN_TELEMETRY_${suffix}`};
    const team=randomUUID(),binding=randomUUID(),exactBinding=randomUUID();
    const draft=randomUUID(),published=randomUUID(),future=randomUUID(),older=randomUUID(),newer=randomUUID(),foreign=randomUUID();
    const tokens=new Map<string,string>();
    const request=(user:string,path:string,method='GET',body?:unknown)=>call(server.url,path,{token:tokens.get(user),method,body});
    const list=(user=ids.manager,building=a,flags='')=>request(user,`/finance?buildingId=${building}${flags}`);
    const f={org,a,b,ids,roles,team,binding,exactBinding,draft,published,future,older,newer,foreign,request,list};
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Finance test',${org})`;
      for(const building of [a,b])await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},${building},${building})`;
      for(const [kind,id] of Object.entries(ids))await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id+'@finance.test'},${passwordHash},${kind==='flag'})`;
      for(const role of Object.values(roles))await sqlClient`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${roles.manager},'finance:read'),(${roles.manager},'finance:manage'),(${roles.reader},'finance:read'),(${roles.published},'finance:read-published'),(${roles.action},'finance:manage'),(${roles.telemetry},'telemetry:read')`;
      await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Financial team')`;
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${roles.manager})`;
      for(const kind of ['reader','published','action','telemetry'] as const)await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids[kind]},${a},${roles[kind]})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${roles.manager})`;
      await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN'),(${ids.support},'PLATFORM_SUPPORT')`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.resident},${a},'RESIDENT')`;
      for(const [id,building,month,revision,publication] of [[draft,a,'2026-08',1,null],[published,a,'2026-07',1,'past'],[future,a,'2026-10',1,'future'],[older,a,'2026-09',1,null],[newer,a,'2026-09',2,'past'],[foreign,b,'2026-07',1,'past']] as const) {
        await sqlClient`insert into financial_reports(id,building_id,month,title,summary,opening_balance_cents,entries,revision,created_by,published_at,published_by)
          values(${id},${building},${month},'Private report','Private supplier details',10000,'[]',${revision},${ids.manager},
          case when ${publication}::text='past' then statement_timestamp()-interval '1 hour' when ${publication}::text='future' then statement_timestamp()+interval '1 day' end,
          case when ${publication}::text is not null then ${ids.manager} end)`;
      }
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${exactBinding},${ids.exact},${a},${roles.manager},'finance',${draft})`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${ids.exactpublished},${a},${roles.published},'finance',${published}),(${ids.exactdraft},${a},${roles.published},'finance',${draft})`;
      for(const id of Object.values(ids))tokens.set(id,(await login(server.url,id+'@finance.test')).accessToken);
      await run(f);
    } finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from buildings where organization_id=${org}`;
      await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from roles where key in ${sqlClient(Object.values(roles))}`;
    }
  }
  type Fixture={org:string;a:string;b:string;ids:Record<'manager'|'reader'|'published'|'worker'|'exact'|'exactpublished'|'exactdraft'|'resident'|'platform'|'flag'|'support'|'telemetry'|'outsider'|'action',string>;roles:Record<'manager'|'reader'|'published'|'action'|'telemetry',string>;team:string;binding:string;exactBinding:string;draft:string;published:string;future:string;older:string;newer:string;foreign:string;request:(user:string,path:string,method?:string,body?:unknown)=>Promise<Response>;list:(user?:string,building?:string,flags?:string)=>Promise<Response>};
  async function data(response:Response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));assert.equal(response.headers.get('cache-control'),'no-store');return body;}
  const raw=(user:string)=>as(user,tx=>tx.execute(sql`select id from financial_reports`));
  const edit=(f:Fixture,user=f.ids.manager,id=f.draft)=>f.request(user,`/finance/${id}`,'PUT',{...content(),version:1});
  const publish=(f:Fixture,user=f.ids.manager,id=f.draft,version=1)=>f.request(user,`/finance/${id}/publish`,'POST',{version});

  it('permits whole people and teams without memberships and keeps private readers read-only',async()=>fixture(async f=>{
    for(const user of [f.ids.manager,f.ids.worker]) {
      assert.equal((await data(await f.list(user))).items.length,user===f.ids.manager?5:6);
      const row=await data(await f.request(user,'/finance','POST',{...content(),buildingId:f.a}),201);
      assert.deepEqual(row.totals,{incomeCents:20010,expenseCents:1001,closingBalanceCents:29009});
      assert.equal(row.revision,user===f.ids.manager?2:3);assert.equal(row.version,1);
    }
    assert.equal((await data(await f.list(f.ids.reader))).items.length,7);
    assert.equal((await edit(f,f.ids.reader)).status,403);assert.equal((await publish(f,f.ids.reader)).status,403);
    assert.equal((await f.request(f.ids.reader,'/finance','POST',{...content(),buildingId:f.a})).status,403);
  }));
  it('published capability exposes only current published reports and exact grants never discover drafts',async()=>fixture(async f=>{
    for(const user of [f.ids.published,f.ids.resident]) {
      const rows=(await data(await f.list(user))).items;
      assert.deepEqual(rows.map((r:any)=>r.id),[f.newer,f.published]);
      assert.deepEqual((await raw(user)).map(r=>r.id).sort(),[f.published,f.newer].sort());
      assert.equal((await edit(f,user)).status,404);assert.equal((await publish(f,user)).status,404);
    }
    assert.deepEqual((await data(await f.list(f.ids.exactpublished))).items.map((r:any)=>r.id),[f.published]);
    assert.equal((await f.list(f.ids.exactdraft)).status,403);assert.equal((await raw(f.ids.exactdraft)).length,0);
    const page=await data(await f.list(f.ids.published,f.a,'&limit=1&offset=1'));assert.deepEqual(page.items.map((r:any)=>r.id),[f.published]);
  }));
  it('keeps exact management on its actual report and checks hidden newer published revisions',async()=>fixture(async f=>{
    assert.deepEqual((await data(await f.list(f.ids.exact))).items.map((r:any)=>r.id),[f.draft]);
    assert.equal((await f.request(f.ids.exact,'/finance','POST',{...content(),buildingId:f.a})).status,403);
    assert.equal((await publish(f,f.ids.exact,f.older)).status,404);
    assert.equal((await edit(f,f.ids.exact)).status,200);
    assert.equal((await publish(f,f.ids.exact,f.draft,2)).status,200);
    await sqlClient`update role_bindings set resource_id=${f.older} where id=${f.exactBinding}`;
    assert.deepEqual((await raw(f.ids.exact)).map(r=>r.id),[f.older]);
    assert.equal((await f.request(f.ids.exact,`/finance/${f.older}/publish`,'POST',{version:1})).status,409);
    await assert.rejects(as(f.ids.exact,tx=>tx.execute(sql`update financial_reports set published_at=clock_timestamp(),published_by=${f.ids.exact} where id=${f.older}::uuid`)),e=>pgErrorCode(e)==='42501');
    assert.equal((await sqlClient`select published_at from financial_reports where id=${f.older}`)[0]!.published_at,null);
  }));
  it('denies global flags, support, telemetry, action-only and foreign private authority',async()=>fixture(async f=>{
    for(const user of [f.ids.platform,f.ids.flag,f.ids.support,f.ids.telemetry,f.ids.action,f.ids.outsider]) {
      assert.equal((await f.list(user)).status,403,user);assert.equal((await raw(user)).length,0);
      assert.equal((await publish(f,user)).status,404);assert.equal((await f.request(user,'/finance','POST',{...content(),buildingId:f.a})).status,403);
    }
    assert.equal((await f.list(f.ids.manager,f.b)).status,403);
    assert.equal((await publish(f,f.ids.manager,f.foreign)).status,404);
    for(const target of ['bad-uuid',randomUUID()]) {
      const [r]=await as(f.ids.manager,tx=>tx.execute(sql`select app_finance_has_capability(${f.a},${target},'finance:read') as allowed`));assert.equal(r!.allowed,false);
    }
    const [r]=await as(f.ids.manager,tx=>tx.execute(sql`select app_finance_has_capability(${f.a},${f.foreign},'finance:read') as foreign_resource,app_finance_has_capability(${f.a},${f.draft},'telemetry:read') as wrong_capability`));
    assert.deepEqual({...r},{foreign_resource:false,wrong_capability:false});
  }));
  it('raw RLS preserves identity, creation fields, published contents and actual audit authority',async()=>fixture(async f=>{
    for(const assignment of [sql`id=${randomUUID()}::uuid`,sql`building_id=${f.b}`,sql`month='2026-11'`,sql`revision=8`,sql`created_by=${f.ids.reader}`,sql`created_at=clock_timestamp()`])await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`update financial_reports set ${assignment} where id=${f.draft}::uuid`)),e=>pgErrorCode(e)==='42501');
    await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`delete from financial_reports where id=${f.draft}::uuid`)),e=>pgErrorCode(e)==='42501');
    assert.equal((await as(f.ids.manager,tx=>tx.execute(sql`update financial_reports set summary='Changed' where id=${f.published}::uuid returning id`))).length,0);
    await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`insert into financial_reports(building_id,month,title,summary,opening_balance_cents,created_by) values(${f.a},'2026-12','Wrong actor','Private',0,${f.ids.reader})`)),e=>pgErrorCode(e)==='42501');
    await assert.rejects(as(f.ids.action,tx=>tx.execute(sql`insert into financial_reports(building_id,month,title,summary,opening_balance_cents,created_by) values(${f.a},'2026-12','No reading','Private',0,${f.ids.action})`)),e=>pgErrorCode(e)==='42501');
    for(const action of ['FINANCIAL_DRAFT_CREATED','FINANCIAL_DRAFT_UPDATED','FINANCIAL_REPORT_PUBLISHED'])for(const [user,target,building] of [[f.ids.reader,f.draft,f.a],[f.ids.manager,f.foreign,f.a],[f.ids.manager,'malformed',f.a],[f.ids.manager,f.draft,f.b]])await assert.rejects(as(user!,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${building!},${user!},${action},'financial_report',${target!})`)),e=>pgErrorCode(e)==='42501');
  }));
  it('feature pause applies without building discovery and published empty scopes are valid',async()=>fixture(async f=>{
    assert.equal((await data(await f.list(f.ids.published,f.a,'&month=2026-12'))).items.length,0);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'FINANCE',false)`;
    const [state]=await as(f.ids.published,tx=>tx.execute(sql`select enabled from building_feature_settings where building_id=${f.a} and feature_key='FINANCE'`));assert.equal(state!.enabled,false);
    const [event]=await as(f.ids.published,tx=>tx.execute(sql`select app_can_read_feature_event(${f.a}) as allowed`));assert.equal(event!.allowed,true);
    for(const user of [f.ids.manager,f.ids.published,f.ids.exact])assert.equal((await f.list(user)).status,403);
    assert.equal((await edit(f)).status,403);assert.equal((await publish(f)).status,403);
  }));
  async function waitPast(boundary:unknown){for(let i=0;i<100;i++){if((await sqlClient`select clock_timestamp()>${boundary as string}::timestamptz as expired`)[0]!.expired)return;await sqlClient`select pg_sleep(0.02)`;}assert.fail('bounded database deadline expired');}
  it('publication visibility advances between statements and current authorization removes cached authority',async()=>fixture(async f=>{
    await as(f.ids.published,async tx=>{
      const [r]=await sqlClient`update financial_reports set published_at=clock_timestamp()+interval '0.25 seconds' where id=${f.future} returning published_at::text as boundary`;
      const read=()=>tx.execute(sql`select id from financial_reports where id=${f.future}::uuid`);
      assert.equal((await read()).length,0);await waitPast(r!.boundary);assert.equal((await read()).length,1);
    });
    for(const [disable,restore] of [
      [sqlClient`update users set active=false where id=${f.ids.manager}`,()=>sqlClient`update users set active=true where id=${f.ids.manager}`],
      [sqlClient`update buildings set active=false where id=${f.a}`,()=>sqlClient`update buildings set active=true where id=${f.a}`],
      [sqlClient`update organizations set active=false where id=${f.org}`,()=>sqlClient`update organizations set active=true where id=${f.org}`],
      [sqlClient`update roles set active=false where key=${f.roles.manager}`,()=>sqlClient`update roles set active=true where key=${f.roles.manager}`],
      [sqlClient`update role_bindings set starts_at=clock_timestamp()+interval '1 day' where id=${f.binding}`,()=>sqlClient`update role_bindings set starts_at=null where id=${f.binding}`],
      [sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.binding}`,()=>sqlClient`update role_bindings set ends_at=null where id=${f.binding}`],
    ] as const){assert.equal((await f.list()).status,200);try{await disable;assert.ok([401,403].includes((await f.list()).status));assert.equal((await raw(f.ids.manager)).length,0);}finally{await restore();}}
    await sqlClient`update teams set active=false where id=${f.team}`;assert.equal((await f.list(f.ids.worker)).status,403);
    await sqlClient`update teams set active=true where id=${f.team}`;await sqlClient`update team_members set active=false where team_id=${f.team}`;assert.equal((await f.list(f.ids.worker)).status,403);
  }));
  it('requires private reading and management independently and never reactivates revoked permissions',async()=>fixture(async f=>{
    for(const key of ['finance:read','finance:manage']) {
      try{await sqlClient`update permissions set active=false where key=${key}`;assert.equal((await f.request(f.ids.manager,'/finance','POST',{...content(),buildingId:f.a})).status,403);assert.equal((await edit(f)).status,key==='finance:read'?404:403);}
      finally{await sqlClient`update permissions set active=true where key=${key}`;}
    }
  }));
  // Delay delivery of actual PostgreSQL rows; no mocked authorization or data.
  async function afterReportRead(run:()=>Promise<void>,during:()=>Promise<void>){
    const original=appDb.transaction;let delayed=false;
    function builder(target:any):any{return new Proxy(target,{get(object,key){const value=Reflect.get(object,key);
      if(key==='then')return(resolve:any,reject:any)=>object.then(async(rows:any)=>{if(!delayed&&object.toSQL().sql.includes('financial_reports')){delayed=true;await during();}return resolve(rows);},reject);
      if(typeof value==='function')return(...args:any[])=>{const result=value.apply(object,args);return result&&typeof result==='object'&&('from' in result||'toSQL' in result)?builder(result):result;};return value;
    }});}
    appDb.transaction=((callback:any,...options:any[])=>original.call(appDb,(tx:any)=>callback(new Proxy(tx,{get(target,key,receiver){if(key==='select')return(...args:any[])=>builder(target.select(...args));return Reflect.get(target,key,receiver);}})),...options)) as typeof appDb.transaction;
    try{await run();assert.equal(delayed,true,'real financial rows must have been read before revocation');}finally{appDb.transaction=original;}
  }
  it('discards cached financial contents after complete scope revocation',async()=>fixture(async f=>{
    await afterReportRead(async()=>assert.equal((await f.list(f.ids.exact)).status,403),async()=>{await sqlClient`update role_bindings set active=false where id=${f.exactBinding}`;});
  }));
  it('filters a revoked cached report while preserving another currently authorized exact report',async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.ids.exact},${f.a},${f.roles.manager},'finance',${f.published})`;
    await afterReportRead(async()=>assert.deepEqual((await data(await f.list(f.ids.exact))).items.map((r:any)=>r.id),[f.published]),async()=>{await sqlClient`update role_bindings set active=false where id=${f.exactBinding}`;});
  }));
  it('serializes versions and publication, keeps published responses idempotent, and preserves amounts',async()=>fixture(async f=>{
    const responses=await Promise.all([edit(f),edit(f)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal((await publish(f,f.ids.manager,f.draft,1)).status,409);
    const row=await data(await publish(f,f.ids.manager,f.draft,2));assert.deepEqual(row.totals,{incomeCents:20010,expenseCents:1001,closingBalanceCents:29009});
    const repeat=await data(await publish(f,f.ids.manager,f.draft,2));assert.equal(repeat.publishedAt,row.publishedAt);assert.equal(repeat.version,row.version);
    assert.equal((await edit(f)).status,409);
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.draft} and action='FINANCIAL_REPORT_PUBLISHED'`).length,1);
    await sqlClient`update role_bindings set active=false where id=${f.binding}`;assert.equal((await publish(f)).status,404);
  }));
  async function locked<T>(f:Fixture,mode:'row'|'advisory',start:()=>Promise<T>,during:()=>Promise<void>) {
    const require=createRequire(import.meta.url),postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const client=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2});let release!:()=>void,ready!:(pid:number)=>void,reject!:(error:unknown)=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}),acquired=new Promise<number>((resolve,fail)=>{ready=resolve;reject=fail;});
    let pending:Promise<PromiseSettledResult<T>[]>|undefined,timer:ReturnType<typeof setTimeout>|undefined,started=false,result:T|undefined;
    const blocker=Promise.allSettled([client.begin(async owner=>{await owner`set local lock_timeout='2s'`;await owner`set local statement_timeout='3s'`;if(mode==='row')await owner`select id from financial_reports where id=${f.draft} for update`;else await owner`select pg_advisory_xact_lock(hashtextextended(${`finance:${f.a}:2026-08`},0))`;ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);await held;})]);
    void blocker.then(([r])=>{if(r!.status==='rejected')reject(r.reason);});
    try{const pid=await Promise.race([acquired,new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(new Error('Finance lock timeout')),5000);})]);clearTimeout(timer);started=true;pending=Promise.allSettled([Promise.resolve().then(start)]);
      let waiting=false;for(let i=0;i<250;i++){if((await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`)[0]!.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(waiting,true,'request must really wait on owner lock');await during();
    }finally{clearTimeout(timer);release();if(!started)await client.end({timeout:0});const [locks,results]=await Promise.all([blocker,pending??Promise.resolve([])]);await client.end({timeout:1});for(const r of [...locks,...results])if(r.status==='rejected')throw r.reason;if(results[0]?.status==='fulfilled')result=results[0].value;}return result as T;
  }
  for(const kind of ['person-row-revoke','person-advisory-expire','team-row-expire','team-advisory-revoke'] as const)it(`revalidates ${kind} after an observed wait without financial or audit side effects`,async()=>fixture(async f=>{
    const before=await sqlClient`select to_jsonb(r) as row from financial_reports r where building_id=${f.a} order by id`,team=kind.startsWith('team'),advisory=kind.includes('advisory');
    const response=await locked(f,advisory?'advisory':'row',()=>advisory?f.request(team?f.ids.worker:f.ids.manager,'/finance','POST',{...content(),buildingId:f.a}):publish(f,team?f.ids.worker:f.ids.manager),async()=>{
      if(kind.endsWith('revoke')){if(team)await sqlClient`update team_members set active=false where team_id=${f.team}`;else await sqlClient`update role_bindings set active=false where id=${f.binding}`;}
      else{const [r]=team?await sqlClient`update team_members set ends_at=clock_timestamp()+interval '0.1 seconds' where team_id=${f.team} returning ends_at::text as boundary`:await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 seconds' where id=${f.binding} returning ends_at::text as boundary`;await waitPast(r!.boundary);}
    });
    assert.equal(response.status,advisory?403:404,await response.clone().text());assert.deepEqual(await sqlClient`select to_jsonb(r) as row from financial_reports r where building_id=${f.a} order by id`,before);assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
  }));
  it('rolls every financial mutation back if its audit fails without logging private statements',async t=>fixture(async f=>{
    const logger=t.mock.method(console,'error',()=>undefined),name='finance_audit_failure_'+randomUUID().replaceAll('-','');
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.user_id=TG_ARGV[0] then raise exception 'fixture audit rejection'; end if; return NEW; end $$`);
    await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.ids.manager}')`);
    try{const before=await sqlClient`select to_jsonb(r) as row from financial_reports r where building_id=${f.a} order by id`;for(const send of [()=>f.request(f.ids.manager,'/finance','POST',{...content(),buildingId:f.a}),()=>edit(f),()=>publish(f)]){const response=await send();assert.equal(response.status,500);assert.ok(!(await response.text()).includes('Private'));assert.deepEqual(await sqlClient`select to_jsonb(r) as row from financial_reports r where building_id=${f.a} order by id`,before);}assert.equal(logger.mock.callCount(),0);}
    finally{await sqlClient.unsafe(`drop trigger ${name} on audit_logs`);await sqlClient.unsafe(`drop function ${name}()`);}
  }));
  it('reapplies only finance branches while preserving active flags, all unrelated policies and hardened ACLs',async()=>fixture(async f=>{
    const migration=await readFile(new URL('../../../infrastructure/030-finance-capabilities.sql',import.meta.url),'utf8'),rollback=new Error('finance migration rollback');
    const strip=(text:string)=>text.replace(/WHEN 'FINANCIAL_(?:DRAFT_CREATED|DRAFT_UPDATED|REPORT_PUBLISHED)'::text THEN .*?(?=WHEN |ELSE)/gs,'').replace(/\s+/g,' ').trim();
    await assert.rejects(sqlClient.begin(async owner=>{
      await owner`update permissions set active=false where key='finance:manage'`;await owner`update role_bindings set active=false where id=${f.binding}`;
      const [before]=await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;
      const unrelated=()=>owner`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename<>'financial_reports' and policyname not in ('audit_logs_insert_policy','building_features_finance_read','feature_runtime_finance_read') order by tablename,policyname`;
      const baseline=await unrelated();const [feature]=await owner`select prosrc from pg_proc where oid='app_can_read_feature_event(text)'::regprocedure`;
      const stripFeature=(source:string)=>source.replaceAll('OR app_finance_can_read_feature_state(b.id)','').replace(/\s+/g,' ').trim();
      for(let i=0;i<2;i++){await owner.unsafe(migration);assert.deepEqual(await unrelated(),baseline);const [audit]=await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;assert.equal(strip(audit!.expression),strip(before!.expression));assert.equal((await owner`select active from permissions where key='finance:manage'`)[0]!.active,false);assert.equal((await owner`select active from role_bindings where id=${f.binding}`)[0]!.active,false);assert.equal(stripFeature((await owner`select prosrc from pg_proc where oid='app_can_read_feature_event(text)'::regprocedure`)[0]!.prosrc),stripFeature(feature!.prosrc));}throw rollback;
    }),e=>e===rollback);
    for(const signature of ['app_finance_has_capability(text,text,text)','app_finance_can_read(text,text)','app_finance_can_read_scope(text)','app_finance_can_read_feature_state(text)','app_finance_can_publish_revision(text,text)']) {
      const [r]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(r!.prosecdef,true);assert.equal(r!.provolatile,'s');assert.equal(r!.owned,true);assert.ok(r!.proconfig.includes('search_path=public, pg_temp'));assert.equal(r!.app,true);assert.equal(r!.identity,false);assert.equal(r!.broker,false);assert.equal(r!.public_execute,false);
    }
  }));
  it('uses actual report primary-key and revision indexes without authority scans over report history',async t=>fixture(async f=>{
    await sqlClient`insert into financial_reports(building_id,month,title,summary,opening_balance_cents,entries,revision,created_by) select ${f.a},'2026-12','History','Private history',0,'[]',n,${f.ids.manager} from generate_series(1,4000) n`;
    await sqlClient`analyze financial_reports`;await sqlClient`analyze role_bindings`;
    const plans=await sqlClient.begin(async owner=>{
      await owner`select set_config('app.user_id',${f.ids.exact},true)`;
      async function explain(signature:string,parameters:unknown[],names:string[]){const [r]=await owner`select prosrc from pg_proc where oid=${signature}::regprocedure`;let body=String(r!.prosrc);names.forEach((name,index)=>{body=body.replaceAll(name,'$'+(index+1));});return JSON.stringify((await owner.unsafe(`explain (format json) ${body}`,parameters as string[]))[0]!['QUERY PLAN']);}
      return {point:await explain('app_finance_has_capability(text,text,text)',[f.a,f.draft,'finance:read'],['target_building_id','target_report_id','target_capability']),scope:await explain('app_finance_can_read_scope(text)',[f.a],['target_building_id']),revision:await explain('app_finance_can_publish_revision(text,text)',[f.a,f.older],['target_building_id','target_report_id'])};
    });
    assert.ok(plans.point.includes('financial_reports_pkey'),plans.point);assert.ok(!plans.scope.includes('"Relation Name":"financial_reports"'),plans.scope);assert.ok(plans.revision.includes('financial_reports_revision_uq'),plans.revision);t.diagnostic('Stored owner SQL bodies use report PK and tenant/month/revision index; scope uses current binding candidates, no historical report scan.');
  }));
});
