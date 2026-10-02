import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import { sqlClient } from "@predioon/db";
import { appDb, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("overview capabilities: truthful aggregate and local coverage", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async()=>{ passwordHash=await hashPassword("predioon123");server=await startTestServer(); });
  after(async()=>{await server?.close();await closeAppDb();await sqlClient.end();});
  async function create() {
    const s=randomUUID(),org=`024-org-${s}`,a=`024-a-${s}`,b=`024-b-${s}`;
    const admin=`024-admin-${s}`,teamUser=`024-team-${s}`,exact=`024-exact-${s}`,resident=`024-resident-${s}`,support=`024-support-${s}`,telemetry=`024-telemetry-${s}`,platform=`024-platform-${s}`,flag=`024-flag-${s}`;
    const ids=[admin,teamUser,exact,resident,support,telemetry,platform,flag];
    const ga=`024-ga-${s}`,ga2=`024-ga2-${s}`,gb=`024-gb-${s}`,d1=`024-water-${s}`,d2=`024-water2-${s}`,d3=`024-energy-${s}`,db=`024-foreign-${s}`;
    const team=randomUUID(),teamBinding=randomUUID(),adminBinding=randomUUID(),exactBinding=randomUUID(),platformBinding=randomUUID(),supportBinding=randomUUID(),telemetryBinding=randomUUID(),grant=randomUUID(),telemetryGrant=randomUUID();
    const alerts=[randomUUID(),randomUUID(),randomUUID()];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Overview',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'Overview A','A'),(${b},${org},'Overview B','B')`;
    for(const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id+'@overview.test'},${id},${passwordHash})`;
    await sqlClient`update users set is_platform_admin=true where id=${flag}`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number,status) values(${ga},${a},'G1',${ga},'ONLINE'),(${ga2},${a},'G2',${ga2},'OFFLINE'),(${gb},${b},'GB',${gb},'ONLINE')`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,status,metadata) values(${d1},${a},${ga},'Water 1','WATER_LEVEL_SENSOR','ONLINE','{"secret":"private"}'),(${d2},${a},${ga2},'Water 2','WATER_LEVEL_SENSOR','OFFLINE','{}'),(${d3},${a},null,'Energy','ENERGY_METER','ONLINE','{}'),(${db},${b},${gb},'Foreign','ENERGY_METER','ONLINE','{}')`;
    await sqlClient`insert into alerts(id,building_id,device_id,gateway_id,severity,type,message) values(${alerts[0]},${a},${d1},${ga},'HIGH','WATER_LOW','Private water alert'),(${alerts[1]},${a},${d2},${ga2},'LOW','WATER_LOW','Private water 2'),(${alerts[2]},${a},${d3},null,'CRITICAL','ENERGY_FAILURE','Private energy alert')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${adminBinding},${admin},${a},'BUILDING_ADMIN')`;
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Overview team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${teamUser})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${exactBinding},${exact},${a},'BUILDING_ADMIN','device',${d1})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${resident},${a},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${platformBinding},${platform},'PLATFORM_ADMIN'),(${supportBinding},${support},'PLATFORM_SUPPORT'),(${telemetryBinding},${telemetry},'PLATFORM_SUPPORT')`;
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${a},${support},'alerts:read','alert',${alerts[0]},'Alert diagnostic',now()+interval '1 hour',${platform}),(${telemetryGrant},${a},${telemetry},'telemetry:read','device',${d1},'Telemetry diagnostic',now()+interval '1 hour',${platform})`;
    const tokens=new Map<string,string>();for(const id of ids)tokens.set(id,(await login(server.url,id+'@overview.test')).accessToken);
    const request=(user:string,path:string)=>call(server.url,path,{token:tokens.get(user)});
    return {org,a,b,ids,admin,teamUser,exact,resident,support,telemetry,platform,flag,ga,ga2,gb,d1,d2,d3,db,team,teamBinding,adminBinding,exactBinding,platformBinding,supportBinding,telemetryBinding,grant,telemetryGrant,alerts,request};
  }
  type Fixture=Awaited<ReturnType<typeof create>>;
  async function fixture(run:(f:Fixture)=>Promise<void>) {const f=await create();try{await run(f);}finally{await sqlClient`delete from audit_logs where building_id in ${sqlClient([f.a,f.b])}`;await sqlClient`delete from buildings where organization_id=${f.org}`;await sqlClient`delete from organizations where id=${f.org}`;await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;}}
  async function status(r:Response,n:number){assert.equal(r.status,n,await r.clone().text());}
  async function body(r:Response){await status(r,200);return r.json();}
  const local=(f:Fixture,u:string,b=f.a)=>f.request(u,`/overview/building?buildingId=${b}`);
  async function catalog(run:()=>Promise<void>){
    const permissions=await sqlClient`select to_jsonb(p)||jsonb_build_object('created_at',p.created_at::text) row from permissions p`;
    const roles=await sqlClient`select to_jsonb(r)||jsonb_build_object('created_at',r.created_at::text) row from roles r`;
    const rp=await sqlClient`select to_jsonb(rp)||jsonb_build_object('created_at',rp.created_at::text) row from role_permissions rp`;
    try{await run();}finally{await sqlClient.begin(async tx=>{for(const {row} of permissions)await tx`insert into permissions ${tx(row)} on conflict(key) do update set ${tx(row)}`;for(const {row}of roles)await tx`insert into roles ${tx(row)} on conflict(key) do update set ${tx(row)}`;for(const {row}of rp)await tx`insert into role_permissions ${tx(row)} on conflict(role_key,permission_key) do update set ${tx(row)}`;});}
  }
  it("permits a real platform binding without the legacy identity flag and counts independently",async()=>fixture(async f=>{
    const data=await body(await f.request(f.platform,'/overview/platform'));
    const b=data.buildings.find((r:any)=>r.id===f.a);
    assert.equal(data.directoryAvailability,'available');assert.equal(b.devices,3);assert.equal(b.devices_online,2);assert.equal(b.gateways,2);assert.equal(b.gateways_online,1);assert.equal(b.open_alerts,3);assert.equal(b.critical_alerts,2);
    assert.deepEqual(b.categories.find((r:any)=>r.type==='WATER_LEVEL_SENSOR'),{type:'WATER_LEVEL_SENSOR',devices:2,devices_online:1});
    assert.equal(typeof data.counts.devices,'number');
    const encoded=JSON.stringify(data);for(const value of [f.d1,f.ga,f.alerts[0],'Private water alert','secret','hardwareAddress','metadata','readings'])assert.ok(!encoded.includes(value));
    await status(await f.request(f.platform,`/devices?buildingId=${f.a}`),403);await status(await local(f,f.platform),403);
  }));
  it("denies local roles, alert-only support and forged app.role global authority",async()=>fixture(async f=>{
    for(const user of [f.admin,f.teamUser,f.exact,f.resident,f.support,f.telemetry])await status(await f.request(user,'/overview/platform'),403);
    const [row]=await withUserContext({userId:f.admin,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_has_global_capability('platform:read-health') allowed`));assert.equal(row.allowed,false);
    await status(await f.request(f.flag,'/overview/platform'),200);
  }));
  it("reports whole individual/team coverage and partial exact-device coverage without a gateway",async()=>fixture(async f=>{
    for(const u of [f.admin,f.teamUser]){const d=await body(await local(f,u));assert.deepEqual(d.coverage,{devices:'whole',gateways:'whole',alerts:'whole',telemetry:'whole',occurrences:u===f.admin?'whole':'partial'});assert.equal(d.counts.devices,3);assert.equal(d.counts.gateways,2);assert.equal(d.counts.open_alerts,3);assert.equal(d.counts.open_occurrences,0);assert.equal(d.occurrenceVisibility,u===f.admin?'all':'own');await status(await local(f,u,f.b),403);}
    const d=await body(await local(f,f.exact));assert.equal(d.coverage.devices,'partial');assert.equal(d.coverage.alerts,'partial');assert.equal(d.coverage.gateways,'none');assert.equal(d.counts.devices,1);assert.equal(d.counts.gateways,null);assert.equal(d.gateways.length,0);assert.equal(d.counts.open_alerts,1);
  }));
  it("keeps resident, alert-only and telemetry-only dashboards neutral",async()=>fixture(async f=>{
    for(const u of [f.resident,f.support,f.telemetry]){const d=await body(await local(f,u));assert.equal(d.counts.devices,null);assert.equal(d.counts.devices_online,null);assert.equal(d.counts.gateways,null);assert.equal(d.counts.open_occurrences,u===f.resident?0:null);assert.equal(d.occurrenceVisibility,u===f.resident?'own':'none');assert.equal(d.coverage.devices,'none');assert.equal(d.coverage.gateways,'none');if(u===f.support){assert.equal(d.counts.open_alerts,1);assert.equal(d.coverage.alerts,'partial');}else{assert.equal(d.counts.open_alerts,null);assert.deepEqual(d.latestAlerts,[]);}}
  }));
  it("validates telemetry-only scope against actual same-building gateway references",async()=>fixture(async f=>{
    const d=await body(await local(f,f.telemetry));assert.equal(d.coverage.telemetry,'partial');
    await sqlClient`update devices set gateway_id=${f.gb} where id=${f.d1}`;
    await status(await local(f,f.telemetry),403);
  }));
  it("independently revokes health and directory without producing false empty totals",async()=>fixture(async f=>catalog(async()=>{
    const before=await body(await f.request(f.platform,'/overview/platform'));
    await sqlClient`delete from role_permissions where role_key='PLATFORM_ADMIN' and permission_key='buildings:read'`;
    const hidden=await body(await f.request(f.platform,'/overview/platform'));
    assert.deepEqual(hidden.counts,before.counts);assert.deepEqual(hidden.categories,before.categories);assert.equal(hidden.directoryAvailability,'unavailable');assert.equal(hidden.buildings,null);
    assert.ok(!JSON.stringify(hidden).includes('Overview A'));assert.ok(!JSON.stringify(hidden).includes(f.a));
    await sqlClient`update permissions set active=false where key='platform:read-health'`;
    await status(await f.request(f.platform,'/overview/platform'),403);
    await sqlClient`update permissions set active=true where key='platform:read-health'`;
    await sqlClient`delete from role_permissions where role_key='PLATFORM_ADMIN' and permission_key='platform:read-health'`;
    await status(await f.request(f.platform,'/overview/platform'),403);
  })));
  it("excludes inactive buildings/orgs and inconsistent owner references from aggregates",async()=>fixture(async f=>{
    const before=await body(await f.request(f.platform,'/overview/platform'));
    await sqlClient`update devices set gateway_id=${f.gb} where id=${f.d3}`;
    await sqlClient`update alerts set device_id=${f.db} where id=${f.alerts[0]}`;
    await sqlClient`update alerts set gateway_id=${f.gb} where id=${f.alerts[1]}`;
    const rule=randomUUID();await sqlClient`insert into alert_rules(id,building_id,name,metric,operator,threshold,severity,alert_type,message_template,device_id) values(${rule},${f.b},'Foreign','temperature_c','GT',10,'HIGH','TEMPERATURE_HIGH','Private template',${f.db})`;
    await sqlClient`update alerts set rule_id=${rule} where id=${f.alerts[2]}`;
    const broken=await body(await f.request(f.platform,'/overview/platform')),a=broken.buildings.find((b:any)=>b.id===f.a);
    assert.equal(a.devices,2);assert.equal(a.devices_online,1);assert.equal(a.open_alerts,0);assert.equal(broken.counts.devices,before.counts.devices-1);assert.equal(broken.counts.open_alerts,before.counts.open_alerts-3);
    const localData=await body(await local(f,f.admin));assert.equal(localData.counts.devices,2);assert.equal(localData.counts.open_alerts,0);
    await sqlClient`update buildings set active=false where id=${f.a}`;
    const inactive=await body(await f.request(f.platform,'/overview/platform'));assert.ok(!inactive.buildings.some((b:any)=>b.id===f.a));assert.equal(inactive.counts.buildings,before.counts.buildings-1);
    await sqlClient`update organizations set active=false where id=${f.org}`;
    const org=await body(await f.request(f.platform,'/overview/platform'));assert.ok(!org.buildings.some((b:any)=>[f.a,f.b].includes(b.id)));assert.equal(org.counts.organizations,before.counts.organizations-1);await status(await local(f,f.admin),403);
  }));
  it("distinguishes authorized empty counts from unreadable domains",async()=>fixture(async f=>{
    await sqlClient`delete from alerts where building_id=${f.a}`;await sqlClient`delete from devices where building_id=${f.a}`;await sqlClient`delete from gateways where building_id=${f.a}`;
    const d=await body(await local(f,f.admin));assert.deepEqual(d.counts,{devices:0,devices_online:0,gateways:0,gateways_online:0,open_alerts:0,open_occurrences:0});assert.deepEqual(d.latestAlerts,[]);assert.deepEqual(d.gateways,[]);
    const resident=await body(await local(f,f.resident));assert.equal(resident.counts.devices,null);assert.equal(resident.counts.open_alerts,null);
    await status(await local(f,f.exact),403);await status(await local(f,f.support),403);await status(await local(f,f.telemetry),403);
  }));
  it("filters latest ten after feature pause and preserves diagnostic inventory without buildings:read",async()=>fixture(async f=>catalog(async()=>{
    await sqlClient`insert into alerts(building_id,device_id,severity,type,message,triggered_at) select ${f.a},${f.d1},'LOW','WATER_LOW','Paused water',clock_timestamp()+n*interval '1 second' from generate_series(1,15) n`;
    await sqlClient`insert into alerts(building_id,device_id,severity,type,message,triggered_at) select ${f.a},${f.d3},'LOW','ENERGY_FAILURE','Enabled energy',clock_timestamp()-n*interval '1 second' from generate_series(1,12) n`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    await sqlClient`delete from role_permissions where role_key='BUILDING_ADMIN' and permission_key='buildings:read'`;
    const d=await body(await local(f,f.admin));assert.equal(d.counts.devices,3);assert.equal(d.counts.open_alerts,13);assert.equal(d.latestAlerts.length,10);assert.ok(d.latestAlerts.every((a:any)=>a.device_id===f.d3));
    const support=await body(await local(f,f.support));assert.equal(support.counts.open_alerts,0);assert.equal(support.coverage.alerts,'partial');assert.equal(support.counts.devices,null);
  })));
  it("rechecks role, permission and catalog windows on the same JWT",async()=>fixture(async f=>catalog(async()=>{
    for(const [table,key,user] of [['roles','BUILDING_ADMIN',f.exact],['permissions','devices:read',f.admin],['permissions','alerts:read',f.admin],['permissions','telemetry:read',f.telemetry]] as const){
      await sqlClient`update ${sqlClient(table)} set active=false where key=${key}`;
      const r=await local(f,user);if(user===f.exact||user===f.telemetry)await status(r,403);else{const d=await body(r);if(key==='devices:read'){assert.equal(d.counts.devices,null);assert.equal(d.counts.gateways,null);}else{assert.equal(d.counts.open_alerts,null);assert.deepEqual(d.latestAlerts,[]);}}
      await sqlClient`update ${sqlClient(table)} set active=true where key=${key}`;
    }
    await sqlClient`update roles set active=false where key='PLATFORM_ADMIN'`;await status(await f.request(f.platform,'/overview/platform'),403);
  })));
  it("rechecks direct, team, membership, support and tenant windows using current database time",async()=>fixture(async f=>{
    const mutations:Array<[string,()=>Promise<unknown>]>=[
      [f.exact,()=>sqlClient`update role_bindings set active=false where id=${f.exactBinding}`],
      [f.exact,()=>sqlClient`update role_bindings set starts_at=clock_timestamp()+interval '1 hour' where id=${f.exactBinding}`],
      [f.exact,()=>sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.exactBinding}`],
      [f.teamUser,()=>sqlClient`update team_members set ends_at=clock_timestamp()-interval '1 second' where team_id=${f.team}`],
      [f.teamUser,()=>sqlClient`update teams set active=false where id=${f.team}`],
      [f.teamUser,()=>sqlClient`update role_bindings set active=false where id=${f.teamBinding}`],
      [f.resident,()=>sqlClient`update memberships set active=false where user_id=${f.resident}`],
      [f.support,()=>sqlClient`update support_grants set revoked_at=clock_timestamp() where id=${f.grant}`],
      [f.support,()=>sqlClient`update support_grants set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' where id=${f.grant}`],
      [f.support,()=>sqlClient`update role_bindings set active=false where id=${f.supportBinding}`],
      [f.admin,()=>sqlClient`update buildings set active=false where id=${f.a}`],
      [f.admin,()=>sqlClient`update organizations set active=false where id=${f.org}`],
    ];
    for(const [user,mutate]of mutations){await mutate();await status(await local(f,user),403);await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id in ${sqlClient([f.exactBinding,f.teamBinding,f.supportBinding])}`;await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;await sqlClient`update teams set active=true where id=${f.team}`;await sqlClient`update memberships set active=true where user_id=${f.resident}`;await sqlClient`update support_grants set revoked_at=null,expires_at=clock_timestamp()+interval '1 hour' where id=${f.grant}`;await sqlClient`update buildings set active=true where id=${f.a}`;await sqlClient`update organizations set active=true where id=${f.org}`;}
    await sqlClient`update users set active=false where id=${f.admin}`;assert.ok([401,403].includes((await local(f,f.admin)).status));
    await sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.platformBinding}`;await status(await f.request(f.platform,'/overview/platform'),403);
  }));

  // Proxy changes only delivery timing; all grants, RLS and DTO rows are real PG.
  async function afterRealQuery(stage:'guard'|'projection'|'alerts'|'features',run:()=>Promise<void>,mutate:()=>Promise<unknown>){
    const original=appDb.transaction;let delayed=false;const dialect=new PgDialect();
    function builder(target:any):any{return new Proxy(target,{get(object,key){
      const value=Reflect.get(object,key);if(key==='then')return async(resolve:any,reject:any)=>{const rows=await value.call(object,(r:unknown)=>r);if(!delayed&&stage==='features'&&object.toSQL().sql.includes('feature_runtime')){delayed=true;await mutate();}return resolve(rows);};
      if(typeof value==='function')return(...args:any[])=>{const r=value.apply(object,args);return r&&typeof r==='object'&&('from'in r||'toSQL'in r)?builder(r):r;};return value;
    }});}
    appDb.transaction=((callback:any,...options:any[])=>original.call(appDb,(tx:any)=>callback(new Proxy(tx,{get(target,key,receiver){
      if(key==='select')return(...args:any[])=>builder(target.select(...args));
      if(key==='execute')return async(...args:any[])=>{const rows=await target.execute(...args);const statement=dialect.sqlToQuery(args[0]).sql;if(!delayed&&((stage==='projection'&&statement.includes('select app_overview_platform_health()'))||(stage==='guard'&&statement.includes('app_has_global_capability('))||(stage==='alerts'&&statement.includes('from alerts where')))){delayed=true;await mutate();}return rows;};
      return Reflect.get(target,key,receiver);
    }})),...options))as typeof appDb.transaction;
    try{await run();assert.equal(delayed,true,'real query delivery was delayed');}finally{appDb.transaction=original;}
  }
  it("drops a cached global summary when health expires between projection and DTO",async()=>fixture(async f=>{
    await afterRealQuery('projection',async()=>status(await f.request(f.platform,'/overview/platform'),403),async()=>{await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '50 milliseconds' where id=${f.platformBinding}`;await sqlClient`select pg_sleep(0.1)`;});
  }));
  it("returns forbidden when health expires after the guard before owner projection",async()=>fixture(async f=>{
    await afterRealQuery('guard',async()=>status(await f.request(f.platform,'/overview/platform'),403),async()=>{await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '50 milliseconds' where id=${f.platformBinding}`;await sqlClient`select pg_sleep(0.1)`;});
  }));
  it("drops only the cached identified directory after its independent revocation",async()=>fixture(async f=>catalog(async()=>{
    await afterRealQuery('projection',async()=>{const d=await body(await f.request(f.platform,'/overview/platform'));assert.equal(d.buildings,null);assert.equal(d.directoryAvailability,'unavailable');assert.ok(d.counts.devices>=4);},()=>sqlClient`delete from role_permissions where role_key='PLATFORM_ADMIN' and permission_key='buildings:read'`);
  })));
  it("does not leak cached domains after feature queries when only basic discovery remains",async()=>fixture(async f=>catalog(async()=>{
    await afterRealQuery('features',async()=>{const d=await body(await local(f,f.admin));assert.equal(d.counts.devices,null);assert.equal(d.counts.gateways,null);assert.equal(d.counts.open_alerts,null);assert.deepEqual(d.latestAlerts,[]);assert.deepEqual(d.gateways,[]);assert.equal(d.coverage.telemetry,'none');},()=>sqlClient`delete from role_permissions where role_key='BUILDING_ADMIN' and permission_key in ('devices:read','alerts:read','telemetry:read','telemetry:read-published')`);
  })));
  it("denies cached alert-only scope when its support grant expires",async()=>fixture(async f=>{
    await afterRealQuery('features',async()=>status(await local(f,f.support),403),async()=>{await sqlClient`update support_grants set expires_at=clock_timestamp()+interval '50 milliseconds' where id=${f.grant}`;await sqlClient`select pg_sleep(0.1)`;});
  }));
  it("filters revoked cached resources without claiming whole coverage for surviving exact scope",async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.admin},${f.a},'MAINTENANCE','device',${f.d2})`;
    await afterRealQuery('features',async()=>{const d=await body(await local(f,f.admin));assert.equal(d.counts.devices,1);assert.equal(d.counts.gateways,null);assert.equal(d.counts.open_alerts,1);assert.equal(d.coverage.devices,'partial');assert.deepEqual(d.latestAlerts.map((a:any)=>a.id),[f.alerts[1]]);},()=>sqlClient`update role_bindings set active=false where id=${f.adminBinding}`);
  }));
  it("exposes only app stable owner projections and keeps private helpers inaccessible",async()=>fixture(async f=>{
    for(const signature of ['app_overview_platform_health()','app_overview_building_scope(text)']){
      const [r]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=base.proowner same_owner,has_function_privilege('predioon_app',p.oid,'EXECUTE') app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') broker,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0) public from pg_proc p cross join pg_proc base where p.oid=${signature}::regprocedure and base.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(r.prosecdef,true);assert.equal(r.provolatile,'s');assert.deepEqual(r.proconfig,['search_path=public, pg_temp']);assert.equal(r.same_owner,true);assert.equal(r.app,true);assert.equal(r.identity,false);assert.equal(r.broker,false);assert.equal(r.public,false);
    }
    await assert.rejects(withUserContext({userId:f.platform,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_has_global_capability_at('platform:read-health',clock_timestamp())`)));
    await assert.rejects(withUserContext({userId:f.admin,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_overview_platform_health()`)));
    for(const table of ['devices','gateways','alerts']){const rows=await withUserContext({userId:f.platform,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select id from ${sql.identifier(table)} where building_id=${f.a}`));assert.equal(rows.length,0);}
  }));
  it("captures actual independent owner aggregate plans without historical authority scans",async t=>fixture(async f=>{
    type Node={Plans?:Node[];[key:string]:unknown};type Plan={'Query Text':string;Plan:Node};const plans:Plan[]=[];
    const req=createRequire(import.meta.url),postgres=createRequire(req.resolve('@predioon/db'))('postgres')as(url:string,opts:object)=>typeof sqlClient;
    const instrumented=postgres(process.env.DATABASE_URL!,{max:1,onnotice:(notice:{message:string})=>{const start=notice.message.indexOf('{');if(start<0)return;const plan=JSON.parse(notice.message.slice(start))as Plan;if(plan['Query Text'].includes('WITH active_buildings AS MATERIALIZED'))plans.push(plan);}});
    try{await drizzle(instrumented).transaction(async tx=>{await tx.execute(sql`load 'auto_explain'`);await tx.execute(sql`set local auto_explain.log_nested_statements=on`);await tx.execute(sql`set local auto_explain.log_analyze=on`);await tx.execute(sql`set local auto_explain.log_timing=off`);await tx.execute(sql`set local auto_explain.log_format=json`);await tx.execute(sql`set local auto_explain.log_level=notice`);await tx.execute(sql`set local auto_explain.log_min_duration=0`);await tx.execute(sql`set local role predioon_app`);await tx.execute(sql`select set_config('app.user_id',${f.platform},true)`);await tx.execute(sql`select app_overview_platform_health()`);});
      assert.equal(plans.length,1);const nodes=(n:Node):Node[]=>[n,...(n.Plans??[]).flatMap(nodes)];const scans=nodes(plans[0].Plan).filter(n=>n['Relation Name']&&Number(n['Actual Loops'])>0);for(const table of ['devices','gateways','alerts','buildings','organizations','users'])assert.ok(scans.some(n=>n['Relation Name']===table),`actual ${table} scan captured`);assert.ok(scans.every(n=>!['telemetry','daily_usage','usage_cursors','occurrences'].includes(String(n['Relation Name']))));assert.doesNotMatch(plans[0]['Query Text'],/\b(message|metadata|configuration|password_hash|readings)\b/);
      await writeFile(new URL('../../../.local/024-overview-owner-plans.json',import.meta.url),JSON.stringify(plans,null,2));t.diagnostic('Actual owner aggregate plan: independent domains, zero history/payload authority scans');
    }finally{await instrumented.end();}
  }));
});
