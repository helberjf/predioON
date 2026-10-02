import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sqlClient } from '@predioon/db';
import { appDb, closeAppDb, withUserContext } from '@predioon/db/runtime';
import { hashPassword } from '../src/auth/passwords.js';
import { call, login, startTestServer, type TestServer } from './helpers.js';

describe('overview occurrence count follows private current scope',()=>{
  let server:TestServer,passwordHash:string;
  before(async()=>{passwordHash=await hashPassword('predioon123');server=await startTestServer();});
  after(async()=>{await server?.close();await closeAppDb();await sqlClient.end();});
  const as=<T>(userId:string,run:Parameters<typeof withUserContext<T>>[1])=>withUserContext({userId,role:'PLATFORM_ADMIN'},run);
  async function create(){
    const suffix=randomUUID(),org=`occount-${suffix}`,a=`occount-a-${suffix}`,b=`occount-b-${suffix}`;
    const names=['resident','neighbor','manager','exact','worker','platform','reader'] as const;
    const ids=Object.fromEntries(names.map(name=>[name,`occount-${name}-${suffix}`])) as Record<typeof names[number],string>;
    const ownRole=`OCOUNT_OWN_${suffix}`,manageRole=`OCOUNT_MANAGE_${suffix}`,basicRole=`OCOUNT_BASIC_${suffix}`;
    const team=randomUUID(),binding=randomUUID(),exactBinding=randomUUID(),own=randomUUID(),other=randomUUID(),closed=randomUUID(),foreign=randomUUID(),group=randomUUID();
    try {
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Occurrence count',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'Count A','A'),(${b},${org},'Count B','B')`;
    for(const id of Object.values(ids))await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${id+'@count.test'},${passwordHash})`;
    for(const key of [ownRole,manageRole,basicRole])await sqlClient`insert into roles(key,scope,label) values(${key},'BUILDING',${key})`;
    await sqlClient`insert into role_permissions(role_key,permission_key) values(${ownRole},'occurrences:read-own'),(${manageRole},'occurrences:manage'),(${basicRole},'buildings:read')`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.resident},${a},${ownRole}),(${ids.neighbor},${a},${ownRole}),(${ids.reader},${a},${basicRole})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${manageRole})`;
    await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Count team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
    await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${manageRole})`;
    for(const [id,tenant,author,status] of [[own,a,ids.resident,'OPEN'],[other,a,ids.neighbor,'IN_PROGRESS'],[closed,a,ids.resident,'DONE'],[foreign,b,ids.neighbor,'OPEN']] as const){
      await sqlClient`insert into occurrences(id,building_id,protocol,title,description,category,opened_by,status,group_id,assigned_to) values(${id},${tenant},${'PROTOCOL-'+id},'Private title','Secret private account','GENERAL',${author},${status},${group},${ids.reader})`;
      await sqlClient`insert into occurrence_events(occurrence_id,building_id,author_id,kind,message) values(${id},${tenant},${author},'COMMENT',${'Secret-'+id})`;
    }
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${exactBinding},${ids.exact},${a},${manageRole},'occurrence',${other})`;
    const tokens=new Map<string,string>();
    const request=async(user:string,building=a)=>{
      if(!tokens.has(user))tokens.set(user,(await login(server.url,user+'@count.test')).accessToken);
      return call(server.url,`/overview/building?buildingId=${building}`,{token:tokens.get(user)});
    };
    return{org,a,b,ids,ownRole,manageRole,basicRole,team,binding,exactBinding,own,other,closed,foreign,group,request};
    }catch(error){await destroy({org,ids,ownRole,manageRole,basicRole});throw error;}
  }
  type Fixture=Awaited<ReturnType<typeof create>>;
  async function destroy(f:{org:string;ids:Record<string,string>;ownRole:string;manageRole:string;basicRole:string}){
    await sqlClient`delete from buildings where organization_id=${f.org}`;await sqlClient`delete from organizations where id=${f.org}`;
    await sqlClient`delete from users where id in ${sqlClient(Object.values(f.ids))}`;
    await sqlClient`delete from roles where key in ${sqlClient([f.ownRole,f.manageRole,f.basicRole])}`;
  }
  async function fixture(run:(f:Fixture)=>Promise<void>){const f=await create();try{await run(f);}finally{await destroy(f);}}
  async function payload(response:Response){assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json();}
  function count(data:any,value:number|null,coverage:string,visibility:string){assert.equal(data.counts.open_occurrences,value);assert.equal(data.coverage.occurrences,coverage);assert.equal(data.occurrenceVisibility,visibility);}
  it('own, whole, exact and team capabilities count only authorized open requests without legacy membership',async()=>fixture(async f=>{
    count(await payload(await f.request(f.ids.resident)),1,'partial','own');
    count(await payload(await f.request(f.ids.manager)),2,'whole','all');
    count(await payload(await f.request(f.ids.worker)),2,'whole','all');
    count(await payload(await f.request(f.ids.exact)),1,'partial','scoped');
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.ids.resident},${f.a},${f.manageRole})`;
    count(await payload(await f.request(f.ids.resident)),2,'whole','all');
  }));
  it('combined own and exact management remains scoped and never reveals content in the summary',async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.ids.resident},${f.a},${f.manageRole},'occurrence',${f.other})`;
    const data=await payload(await f.request(f.ids.resident));count(data,2,'partial','scoped');
    for(const value of [f.own,f.other,f.closed,f.foreign,f.group,f.ids.neighbor,'Secret','Private title','PROTOCOL'])assert.ok(!JSON.stringify(data).includes(value));
  }));
  it('basic discovery, assignment and global authority do not grant counts and foreign scope stays denied',async()=>fixture(async f=>{
    count(await payload(await f.request(f.ids.reader)),null,'none','none');
    assert.equal((await f.request(f.ids.platform)).status,403);
    assert.equal((await f.request(f.ids.manager,f.b)).status,403);
    for(const user of [f.ids.reader,f.ids.platform]){
      const [row]=await as(user,tx=>tx.execute(sql`select * from app_overview_occurrences(${f.a})`));
      assert.deepEqual({...row},{open_count:null,coverage:'none',visibility:'none'});
    }
  }));
  it('authorized empty counts are zero and paused tickets remain unavailable',async()=>fixture(async f=>{
    await sqlClient`update occurrences set status='DONE' where id in ${sqlClient([f.own,f.other])}`;
    count(await payload(await f.request(f.ids.manager)),0,'whole','all');
    count(await payload(await f.request(f.ids.resident)),0,'partial','own');
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'TICKETS',false)`;
    count(await payload(await f.request(f.ids.manager)),null,'none','none');
  }));
  it('same tokens lose counts after current person, team, role, permission or tenant changes',async()=>fixture(async f=>{
    count(await payload(await f.request(f.ids.resident)),1,'partial','own');
    await sqlClient`update users set active=false where id=${f.ids.resident}`;
    assert.ok([401,403].includes((await f.request(f.ids.resident)).status));
    await sqlClient`update users set active=true where id=${f.ids.resident}`;
    await sqlClient`delete from role_permissions where role_key=${f.ownRole} and permission_key='occurrences:read-own'`;
    assert.equal((await f.request(f.ids.resident)).status,403);
    await sqlClient`insert into role_permissions(role_key,permission_key) values(${f.ownRole},'occurrences:read-own')`;
    await sqlClient`update organizations set active=false where id=${f.org}`;
    assert.equal((await f.request(f.ids.resident)).status,403);
    await sqlClient`update organizations set active=true where id=${f.org}`;
    for(const user of [f.ids.manager,f.ids.worker])count(await payload(await f.request(user)),2,'whole','all');
    await sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.binding}`;
    assert.equal((await f.request(f.ids.manager)).status,403);
    await sqlClient`update team_members set active=false where team_id=${f.team}`;
    assert.equal((await f.request(f.ids.worker)).status,403);
    await sqlClient`update roles set active=false where key=${f.ownRole}`;
    assert.equal((await f.request(f.ids.resident)).status,403);
    await sqlClient`update buildings set active=false where id=${f.a}`;
    assert.equal((await f.request(f.ids.exact)).status,403);
  }));
  it('never includes occurrence events and uses indexed counts with a large closed history',async t=>fixture(async f=>{
    await sqlClient`insert into occurrences(building_id,protocol,title,description,category,opened_by,status)
      select ${f.a},${'COUNT-HISTORY-'+f.org+'-'}||n::text,'Historical','Private history','GENERAL',${f.ids.neighbor},'DONE' from generate_series(1,4000)n`;
    await sqlClient`analyze occurrences`;
    type Node={Plans?:Node[];[key:string]:unknown};type Plan={'Query Text':string;Plan:Node};const plans:Plan[]=[];
    const require=createRequire(import.meta.url),postgres=createRequire(require.resolve('@predioon/db'))('postgres')as(url:string,options:object)=>typeof sqlClient;
    const instrumented=postgres(process.env.DATABASE_URL!,{max:1,onnotice:(notice:{message:string})=>{
      const start=notice.message.indexOf('{');if(start<0)return;const plan=JSON.parse(notice.message.slice(start))as Plan;
      if(/SELECT count\(\*\)/i.test(plan['Query Text'])&&plan['Query Text'].includes('FROM occurrences o'))plans.push(plan);
    }});
    try{
      for(const user of [f.ids.resident,f.ids.exact])await drizzle(instrumented).transaction(async tx=>{
        await tx.execute(sql`load 'auto_explain'`);await tx.execute(sql`set local auto_explain.log_nested_statements=on`);await tx.execute(sql`set local auto_explain.log_analyze=on`);
        await tx.execute(sql`set local auto_explain.log_timing=off`);await tx.execute(sql`set local auto_explain.log_format=json`);await tx.execute(sql`set local auto_explain.log_level=notice`);await tx.execute(sql`set local auto_explain.log_min_duration=0`);
        await tx.execute(sql`set local role predioon_app`);await tx.execute(sql`select set_config('app.user_id',${user},true)`);
        const [row]=await tx.execute(sql`select * from app_overview_occurrences(${f.a})`);assert.equal(Number(row!.open_count),1);
      });
      assert.equal(plans.length,2);
      const nodes=(node:Node):Node[]=>[node,...(node.Plans??[]).flatMap(nodes)];
      for(const plan of plans){
        const executed=nodes(plan.Plan).filter(node=>Number(node['Actual Loops'])>0);
        assert.ok(executed.some(node=>String(node['Index Name']??'').startsWith('occurrences_')),JSON.stringify(plan));
        assert.ok(executed.every(node=>node['Relation Name']!=='occurrence_events'));
        assert.doesNotMatch(plan['Query Text'],/\b(description|title|message|protocol)\b/i);
      }
      await writeFile(new URL('../../../.local/031-overview-occurrences-plans.json',import.meta.url),JSON.stringify(plans,null,2));
      t.diagnostic('Actual nested owner statements: own and scoped counts use occurrence indexes with no occurrence_events relation.');
    }finally{await instrumented.end();}
  }));
  for(const stage of ['initial scope','feature state'] as const)it(`drops the count after real ${stage} is revoked while basic discovery survives`,async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.ids.manager},${f.a},${f.basicRole})`;
    const original=appDb.transaction,dialect=new PgDialect();let delayed=false;
    const revoke=async()=>{delayed=true;await sqlClient`update role_bindings set active=false where id=${f.binding}`;};
    function builder(target:any):any{return new Proxy(target,{get(object,key){
      const value=Reflect.get(object,key);
      if(key==='then')return async(resolve:any)=>{const rows=await value.call(object,(rows:unknown)=>rows);if(!delayed&&stage==='feature state'&&object.toSQL().sql.includes('feature_runtime'))await revoke();return resolve(rows);};
      if(typeof value==='function')return(...args:any[])=>{const result=value.apply(object,args);return result&&typeof result==='object'&&('from'in result||'toSQL'in result)?builder(result):result;};
      return value;
    }});}
    appDb.transaction=((callback:any,...options:any[])=>original.call(appDb,(tx:any)=>callback(new Proxy(tx,{get(target,key,receiver){
      if(key==='select')return(...args:any[])=>builder(target.select(...args));
      if(key==='execute')return async(...args:any[])=>{const rows=await target.execute(...args);const statement=dialect.sqlToQuery(args[0]).sql;
        if(!delayed&&stage==='initial scope'&&statement.includes('app_overview_building_scope'))await revoke();return rows;};
      return Reflect.get(target,key,receiver);
    }})),...options))as typeof appDb.transaction;
    try{count(await payload(await f.request(f.ids.manager)),null,'none','none');assert.equal(delayed,true);}finally{appDb.transaction=original;}
  }));
  it('adds only the narrow app-only stable function and reapplication preserves catalog and policies',async()=>{
    const awaitMigration=await readFile(new URL('../../../infrastructure/031-overview-occurrences.sql',import.meta.url),'utf8');
    const snapshot=async()=>({policies:await sqlClient`select * from pg_policies order by schemaname,tablename,policyname`,permissions:await sqlClient`select to_jsonb(p) as row from permissions p order by key`,grants:await sqlClient`select to_jsonb(r) as row from role_permissions r order by role_key,permission_key`});
    const before=await snapshot();await sqlClient.begin(tx=>tx.unsafe(awaitMigration));
    assert.deepEqual(await snapshot(),before);
    const [row]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owner,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0) as public from pg_proc p cross join pg_proc c where p.oid='app_overview_occurrences(text)'::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
    assert.equal(row!.prosecdef,true);assert.equal(row!.provolatile,'s');assert.deepEqual(row!.proconfig,['search_path=public, pg_temp']);assert.equal(row!.owner,true);assert.equal(row!.app,true);assert.equal(row!.identity,false);assert.equal(row!.broker,false);assert.equal(row!.public,false);
  });
});

