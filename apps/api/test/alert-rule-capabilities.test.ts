import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { after,before,describe,it } from 'node:test';
import { sql } from 'drizzle-orm';
import { sqlClient } from '@predioon/db';
import { appDb,closeAppDb,withUserContext } from '@predioon/db/runtime';
import { hashPassword } from '../src/auth/passwords.js';
import { pgErrorCode } from '../src/http/errors.js';
import { call,login,startTestServer,type TestServer } from './helpers.js';

describe('alert rule capabilities preserve configuration and current resource scope',()=>{
  let server:TestServer,passwordHash:string;
  const ownedPermissions:string[]=[];
  before(async()=>{
    passwordHash=await hashPassword('predioon123');server=await startTestServer();
    for(const action of ['read','manage']){const key='alert-rules:'+action;const rows=await sqlClient`insert into permissions(key,resource_type,action,label) values(${key},'alert_rule',${action},${key}) on conflict(key) do nothing returning key`;ownedPermissions.push(...rows.map(r=>r.key));}
  });
  after(async()=>{await server?.close();if(ownedPermissions.length)await sqlClient`delete from permissions where key in ${sqlClient(ownedPermissions)}`;await closeAppDb();await sqlClient.end();});
  const as=<T>(userId:string,run:Parameters<typeof withUserContext<T>>[1])=>withUserContext({userId,role:'PLATFORM_ADMIN'},run);
  const input=(buildingId:string,deviceId:string|null)=>({buildingId,deviceId,name:'New rule',metric:'water_level_percent',operator:'LT',threshold:20,severity:'HIGH',alertType:'WATER_LOW',messageTemplate:'Private threshold {value}',cooldownSeconds:123});
  type Kind='manager'|'reader'|'worker'|'device'|'exact'|'legacy'|'resident'|'platform'|'flag'|'support'|'technical'|'action'|'outsider';
  type Fixture={org:string;a:string;b:string;d1:string;d2:string;foreignDevice:string;gateway:string;foreignGateway:string;one:string;two:string;general:string;disabled:string;foreign:string;ids:Record<Kind,string>;roles:Record<'manager'|'reader'|'action'|'technical',string>;team:string;binding:string;deviceBinding:string;request:(user:string,path:string,method?:string,body?:unknown)=>Promise<Response>;list:(user?:string,building?:string|null)=>Promise<Response>};
  async function fixture(run:(f:Fixture)=>Promise<void>){
    const suffix=randomUUID(),org=`rule-org-${suffix}`,a=`rule-a-${suffix}`,b=`rule-b-${suffix}`;
    const d1=`rule-d1-${suffix}`,d2=`rule-d2-${suffix}`,foreignDevice=`rule-foreign-${suffix}`,gateway=`rule-gw-${suffix}`,foreignGateway=`rule-gwb-${suffix}`;
    const kinds:Kind[]=['manager','reader','worker','device','exact','legacy','resident','platform','flag','support','technical','action','outsider'];
    const ids=Object.fromEntries(kinds.map(kind=>[kind,`rule-${kind}-${suffix}`])) as Fixture['ids'];
    const roles={manager:`RULE_MANAGER_${suffix}`,reader:`RULE_READER_${suffix}`,action:`RULE_ACTION_${suffix}`,technical:`RULE_TECHNICAL_${suffix}`};
    const team=randomUUID(),binding=randomUUID(),deviceBinding=randomUUID(),one=randomUUID(),two=randomUUID(),general=randomUUID(),disabled=randomUUID(),foreign=randomUUID();
    const tokens=new Map<string,string>();
    const request=(user:string,path:string,method='GET',body?:unknown)=>call(server.url,path,{token:tokens.get(user),method,body});
    const list=(user=ids.manager,building:string|null=a)=>request(user,'/alert-rules'+(building?'?buildingId='+building:''));
    const f={org,a,b,d1,d2,foreignDevice,gateway,foreignGateway,one,two,general,disabled,foreign,ids,roles,team,binding,deviceBinding,request,list};
    try{
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Rule capabilities',${org})`;
      for(const building of [a,b])await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},${building},${building})`;
      for(const [kind,id] of Object.entries(ids))await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id+'@rules.test'},${passwordHash},${kind==='flag'})`;
      for(const role of Object.values(roles))await sqlClient`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${roles.manager},'alert-rules:read'),(${roles.manager},'alert-rules:manage'),(${roles.reader},'alert-rules:read'),(${roles.action},'alert-rules:manage'),(${roles.technical},'devices:read'),(${roles.technical},'telemetry:read'),(${roles.technical},'alerts:read')`;
      await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Rule team')`;await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${roles.manager})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${roles.manager})`;
      for(const kind of ['reader','action','technical'] as const)await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids[kind]},${a},${roles[kind]})`;
      await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN'),(${ids.support},'PLATFORM_SUPPORT')`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.legacy},${a},'BUILDING_ADMIN'),(${ids.legacy},${b},'RESIDENT'),(${ids.resident},${a},'RESIDENT')`;
      await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gateway},${a},'Local gateway',${gateway}),(${foreignGateway},${b},'Foreign gateway',${foreignGateway})`;
      await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${d1},${a},${gateway},'Water','WATER_LEVEL_SENSOR','{"private":"secret"}'),(${d2},${a},null,'Energy','ENERGY_METER','{}'),(${foreignDevice},${b},${foreignGateway},'Foreign','WATER_LEVEL_SENSOR','{}')`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${deviceBinding},${ids.device},${a},${roles.manager},'device',${d1})`;
      for(const [id,building,device,name,metric,enabled] of [[one,a,d1,'A water','water_level_percent',true],[two,a,d2,'B energy','energy_total_kwh',true],[general,a,null,'C general','water_level_percent',true],[disabled,a,d1,'D disabled','water_level_percent',false],[foreign,b,foreignDevice,'E foreign','water_level_percent',true]] as const)await sqlClient`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,severity,alert_type,message_template,cooldown_seconds,enabled,created_by) values(${id},${building},${device},${name},${metric},'LT',20,'CRITICAL','WATER_LOW','Private threshold {value}',123,${enabled},${ids.manager})`;
      for(const id of Object.values(ids))tokens.set(id,(await login(server.url,id+'@rules.test')).accessToken);
      await run(f);
    }finally{
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from gates where building_id in ${sqlClient([a,b])}`;
      await sqlClient`delete from buildings where organization_id=${org}`;await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;await sqlClient`delete from roles where key in ${sqlClient(Object.values(roles))}`;
    }
  }
  async function data(response:Response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));assert.equal(response.headers.get('cache-control'),'no-store');return body;}
  const patch=(f:Fixture,user=f.ids.manager,body:unknown={name:'Updated rule'},id=f.one)=>f.request(user,`/alert-rules/${id}`,'PATCH',body);
  const remove=(f:Fixture,user=f.ids.manager,id=f.one)=>f.request(user,`/alert-rules/${id}`,'DELETE');
  const raw=(user:string)=>as(user,tx=>tx.execute(sql`select id from alert_rules`));
  const exact=(f:Fixture)=>sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.ids.exact},${f.a},${f.roles.manager},'alert_rule',${f.one})`;

  it('allows direct and team rule management without a legacy membership',async()=>fixture(async f=>{
    for(const user of [f.ids.manager,f.ids.worker]){assert.deepEqual((await data(await f.list(user))).items.map((r:any)=>r.id),[f.one,f.two,f.general,f.disabled]);assert.equal((await patch(f,user,{threshold:30})).status,200);}
    assert.equal((await data(await f.list(f.ids.reader))).items.length,4);
    assert.equal((await patch(f,f.ids.reader)).status,403);assert.equal((await remove(f,f.ids.reader)).status,403);
    assert.equal((await f.request(f.ids.reader,'/alert-rules','POST',input(f.a,f.d1))).status,403);
    assert.equal((await as(f.ids.reader,tx=>tx.execute(sql`select id from devices where building_id=${f.a}`))).length,0);
  }));
  it('denies global flag and unrelated capabilities in HTTP and unfiltered runtime SQL',async()=>fixture(async f=>{
    for(const user of [f.ids.flag,f.ids.platform,f.ids.support,f.ids.technical,f.ids.action,f.ids.resident,f.ids.outsider]){
      assert.equal((await f.list(user)).status,403,user);assert.equal((await raw(user)).length,0);assert.equal((await patch(f,user)).status,404);assert.equal((await remove(f,user)).status,404);
      assert.equal((await f.request(user,'/alert-rules','POST',input(f.a,f.d1))).status,403);
    }
    assert.equal((await f.list(f.ids.manager,f.b)).status,403);assert.equal((await patch(f,f.ids.legacy,{name:'Cross tenant'},f.foreign)).status,404);
  }));
  it('filters the unqualified list and distinguishes empty device scope from a missing exact rule',async()=>fixture(async f=>{
    await exact(f);
    assert.deepEqual((await data(await f.list(f.ids.device,null))).items.map((row:any)=>row.id),[f.one,f.disabled]);
    assert.deepEqual((await data(await f.list(f.ids.exact,null))).items.map((row:any)=>row.id),[f.one]);
    assert.deepEqual((await data(await f.list(f.ids.outsider,null))).items,[]);
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.ids.outsider},${f.a},${f.roles.manager},'building',${f.a})`;
    assert.equal((await f.list(f.ids.outsider)).status,403,'a building resource is not a whole tenant grant');
    await sqlClient`delete from alert_rules where device_id=${f.d1}`;
    assert.deepEqual((await data(await f.list(f.ids.device))).items,[]);
    assert.equal((await f.list(f.ids.exact)).status,403,'a deleted exact rule no longer opens the domain');
  }));
  it('creates general rules with creation defaults and refuses private immutable columns',async()=>fixture(async f=>{
    const {deviceId,severity,cooldownSeconds,...body}=input(f.a,null);
    const created=await data(await f.request(f.ids.manager,'/alert-rules','POST',body),201);
    assert.equal(created.deviceId,null);assert.equal(created.severity,'MEDIUM');assert.equal(created.cooldownSeconds,300);assert.equal(created.enabled,true);assert.equal(created.createdBy,f.ids.manager);
    for(const forbiddenField of [{createdBy:f.ids.reader},{createdAt:new Date().toISOString()},{updatedAt:new Date().toISOString()},{id:randomUUID()},{enabled:false}])assert.equal((await f.request(f.ids.manager,'/alert-rules','POST',{...body,...forbiddenField})).status,400);
    for(const invalid of [{threshold:null},{cooldownSeconds:-1},{cooldownSeconds:86401},{operator:'INVALID'},{messageTemplate:'x'}])assert.equal((await patch(f,f.ids.manager,invalid)).status,400);
    assert.equal((await remove(f,f.ids.manager,created.id)).status,204);
  }));
  it('renaming a legacy rule preserves explicit severity cooldown and every omitted field',async()=>fixture(async f=>{
    const response=await patch(f,f.ids.legacy,{name:'Renamed'});const row=await response.json();assert.equal(response.status,200,JSON.stringify(row));
    assert.equal(row.severity,'CRITICAL');assert.equal(row.cooldownSeconds,123);assert.equal(row.enabled,true);assert.equal(row.threshold,20);assert.equal(row.metric,'water_level_percent');assert.equal(row.deviceId,f.d1);
    for(const body of [{unknown:true},{buildingId:f.b},{createdBy:f.ids.reader},{id:randomUUID()},{createdAt:new Date().toISOString()}])assert.equal((await patch(f,f.ids.legacy,body)).status,400);
  }));
  it('scopes creation and retarget to real devices while exact grants cannot broaden a rule',async()=>fixture(async f=>{
    await exact(f);
    assert.deepEqual((await data(await f.list(f.ids.device))).items.map((r:any)=>r.id),[f.one,f.disabled]);
    assert.deepEqual((await data(await f.list(f.ids.exact))).items.map((r:any)=>r.id),[f.one]);
    assert.equal((await patch(f,f.ids.exact,{threshold:25})).status,200);
    assert.equal((await patch(f,f.ids.exact,{deviceId:f.d1})).status,200,'an exact grant can preserve its unchanged device');
    for(const [user,device] of [[f.ids.device,f.d2],[f.ids.device,null],[f.ids.exact,f.d1]])assert.equal((await f.request(user!,'/alert-rules','POST',input(f.a,device!))).status,403);
    assert.equal((await f.request(f.ids.device,'/alert-rules','POST',input(f.a,f.d1))).status,201);
    for(const deviceId of [f.d2,null]){assert.equal((await patch(f,f.ids.device,{deviceId})).status,403);assert.equal((await patch(f,f.ids.exact,{deviceId})).status,403);}
    assert.equal((await patch(f,f.ids.manager,{deviceId:f.d2})).status,200);
    assert.equal((await patch(f,f.ids.device)).status,404);
    assert.equal((await patch(f,f.ids.manager,{deviceId:null})).status,200);
    assert.equal((await data(await f.list(f.ids.exact))).items[0].deviceId,null,'an exact rule grant remains exact after an authorized retarget');
  }));
  it('keeps disabled hardware configurable and hides inconsistent owner-created parents',async()=>fixture(async f=>{
    await sqlClient`update devices set enabled=false where id=${f.d1}`;await sqlClient`update gateways set enabled=false where id=${f.gateway}`;
    assert.equal((await data(await f.list(f.ids.device))).items.length,2);assert.equal((await patch(f,f.ids.device,{enabled:true},f.disabled)).status,200);
    assert.equal((await f.request(f.ids.device,'/alert-rules','POST',input(f.a,f.d1))).status,201);
    for(const deviceId of [f.foreignDevice,'missing-device'])assert.equal((await patch(f,f.ids.manager,{deviceId})).status,403);
    await sqlClient`update alert_rules set device_id=${f.foreignDevice} where id=${f.one}`;
    assert.equal((await raw(f.ids.manager)).some(row=>row.id===f.one),false);assert.equal((await patch(f)).status,404);
    await sqlClient`update alert_rules set device_id=${f.d1} where id=${f.one}`;
    await sqlClient`update devices set gateway_id=${f.foreignGateway} where id=${f.d1}`;
    assert.equal((await raw(f.ids.manager)).some(row=>row.id===f.one),false);assert.equal((await remove(f)).status,404);
  }));
  it('revalidates account tenant team and grants while preserving authorized empty scope',async()=>fixture(async f=>{
    for(const [disable,restore,user] of [
      [()=>sqlClient`update role_bindings set active=false where id=${f.binding}`,()=>sqlClient`update role_bindings set active=true where id=${f.binding}`,f.ids.manager],
      [()=>sqlClient`update teams set active=false where id=${f.team}`,()=>sqlClient`update teams set active=true where id=${f.team}`,f.ids.worker],
      [()=>sqlClient`update team_members set ends_at=clock_timestamp()-interval '1 second' where team_id=${f.team}`,()=>sqlClient`update team_members set ends_at=null where team_id=${f.team}`,f.ids.worker],
      [()=>sqlClient`update organizations set active=false where id=${f.org}`,()=>sqlClient`update organizations set active=true where id=${f.org}`,f.ids.manager],
      [()=>sqlClient`update buildings set active=false where id=${f.a}`,()=>sqlClient`update buildings set active=true where id=${f.a}`,f.ids.manager],
      [()=>sqlClient`update roles set active=false where key=${f.roles.manager}`,()=>sqlClient`update roles set active=true where key=${f.roles.manager}`,f.ids.manager],
      [()=>sqlClient`update permissions set active=false where key='alert-rules:read'`,()=>sqlClient`update permissions set active=true where key='alert-rules:read'`,f.ids.manager],
      [()=>sqlClient`update users set active=false where id=${f.ids.manager}`,()=>sqlClient`update users set active=true where id=${f.ids.manager}`,f.ids.manager],
    ] as const){assert.equal((await f.list(user)).status,200);try{await disable();assert.ok([401,403].includes((await f.list(user)).status));assert.equal((await raw(user)).length,0);}finally{await restore();}}
    await sqlClient`delete from alert_rules where building_id=${f.a}`;assert.deepEqual((await data(await f.list())).items,[]);
  }));
  it('enforces feature pauses with rule-only grants and rejects changing away from a paused source',async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    assert.deepEqual((await data(await f.list())).items.map((r:any)=>r.id),[f.two]);
    assert.equal((await patch(f,f.ids.manager,{metric:'energy_total_kwh',deviceId:f.d2})).status,403);
    assert.equal((await remove(f)).status,403);assert.equal((await f.request(f.ids.manager,'/alert-rules','POST',input(f.a,f.d1))).status,403);
    const [state]=await as(f.ids.reader,tx=>tx.execute(sql`select enabled from building_feature_settings where building_id=${f.a} and feature_key='WATER_TANK'`));assert.equal(state!.enabled,false);
    await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
    assert.equal((await patch(f)).status,200);
    await sqlClient`update alert_rules set metric='custom_metric' where id=${f.one}`;
    await sqlClient`update building_feature_settings set enabled=false where building_id=${f.a} and feature_key='WATER_TANK'`;
    assert.equal((await patch(f)).status,403,'device type fallback remains protected without inventory SELECT');
  }));
  it('raw SQL blocks forged creator immutable fields and unauthorized retarget and audit',async()=>fixture(async f=>{
    await exact(f);
    for(const assignment of [sql`id=${randomUUID()}::uuid`,sql`building_id=${f.b}`,sql`created_by=${f.ids.reader}`,sql`created_at=clock_timestamp()`])await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`update alert_rules set ${assignment} where id=${f.one}::uuid`)),e=>pgErrorCode(e)==='42501');
    for(const user of [f.ids.device,f.ids.exact])for(const device of [f.d2,null])await assert.rejects(as(user,tx=>tx.execute(sql`update alert_rules set device_id=${device} where id=${f.one}::uuid`)),e=>pgErrorCode(e)==='42501');
    await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`insert into alert_rules(building_id,device_id,name,metric,operator,threshold,alert_type,message_template,created_by) values(${f.a},${f.d1},'Fake actor','water_level_percent','LT',2,'LOW','Private',${f.ids.reader})`)),e=>pgErrorCode(e)==='42501');
    for(const action of ['ALERT_RULE_CREATED','ALERT_RULE_UPDATED','ALERT_RULE_DELETED'])for(const [user,target] of [[f.ids.reader,f.one],[f.ids.manager,f.foreign],[f.ids.manager,'bad-uuid']])await assert.rejects(as(user!,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${user!},${action},'alert_rule',${target!})`)),e=>pgErrorCode(e)==='42501');
  }));
  it('serializes deletion with a single audit and preserves historical alerts',async()=>fixture(async f=>{
    const alert=randomUUID();await sqlClient`insert into alerts(id,building_id,device_id,rule_id,type,severity,message) values(${alert},${f.a},${f.d1},${f.one},'WATER_LOW','HIGH','Existing historical alert')`;
    const responses=await Promise.all([remove(f),remove(f)]);assert.deepEqual(responses.map(r=>r.status).sort(),[204,404]);
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.one} and action='ALERT_RULE_DELETED'`).length,1);
    const [row]=await sqlClient`select rule_id,message from alerts where id=${alert}`;assert.equal(row!.rule_id,null);assert.equal(row!.message,'Existing historical alert');
    for(const id of ['bad-id',randomUUID()])assert.equal((await remove(f,f.ids.manager,id)).status,404);
  }));
  it('classifies gates and parking through minimal owner context without exposing equipment',async()=>fixture(async f=>{
    const gateDevice=`rule-gate-${randomUUID()}`,parkingDevice=`rule-parking-${randomUUID()}`,gateRule=randomUUID(),parkingRule=randomUUID();
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${gateDevice},${f.a},${f.gateway},'Gate','GATE_CONTROLLER','{"private":"gate secret"}'),(${parkingDevice},${f.a},null,'Parking','PARKING_SENSOR','{}')`;
    await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id) values(${f.a},'Pedestrian gate','PEDESTRIAN',${f.gateway},${gateDevice})`;
    await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity,sensor_id) values(${f.a},'MOTORCYCLE',10,${parkingDevice})`;
    for(const [id,device,name] of [[gateRule,gateDevice,'Gate rule'],[parkingRule,parkingDevice,'Parking rule']])await sqlClient`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template,created_by) values(${id!},${f.a},${device!},${name!},'custom_metric','GT',1,'CUSTOM','Private message',${f.ids.manager})`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'GARAGE_ACCESS',false),(${f.a},'CAR_PARKING',false)`;
    assert.equal((await patch(f,f.ids.manager,{threshold:2},gateRule)).status,200);assert.equal((await patch(f,f.ids.manager,{threshold:2},parkingRule)).status,200);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'PEDESTRIAN_ACCESS',false),(${f.a},'MOTORCYCLE_PARKING',false)`;
    assert.equal((await patch(f,f.ids.manager,{threshold:3},gateRule)).status,403);assert.equal((await patch(f,f.ids.manager,{threshold:3},parkingRule)).status,403);
    const context=await as(f.ids.reader,tx=>tx.execute(sql`select * from app_alert_rule_context(${f.a},${gateRule})`));
    assert.deepEqual(Object.keys(context[0]!).sort(),['device_type','gate_kind','parking_vehicle_type']);assert.equal(context[0]!.gate_kind,'PEDESTRIAN');
    assert.equal((await as(f.ids.reader,tx=>tx.execute(sql`select id from devices where id=${gateDevice}`))).length,0);
    await sqlClient`delete from gates where device_id=${gateDevice}`;
  }));
  async function waitPast(boundary:unknown){for(let i=0;i<100;i++){if((await sqlClient`select clock_timestamp()>${boundary as string}::timestamptz as expired`)[0]!.expired)return;await sqlClient`select pg_sleep(0.02)`;}assert.fail('bounded database expiry wait failed');}
  async function locked<T>(f:Fixture,start:()=>Promise<T>,during:()=>Promise<void>,deviceId?:string){
    const require=createRequire(import.meta.url),postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const client=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2});let release!:()=>void,ready!:(pid:number)=>void,reject!:(error:unknown)=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}),acquired=new Promise<number>((resolve,fail)=>{ready=resolve;reject=fail;});
    let pending:Promise<PromiseSettledResult<T>[]>|undefined,timer:ReturnType<typeof setTimeout>|undefined,started=false,result:T|undefined;
    const blocker=Promise.allSettled([client.begin(async owner=>{await owner`set local lock_timeout='2s'`;await owner`set local statement_timeout='3s'`;if(deviceId)await owner`select id from devices where id=${deviceId} for update`;else await owner`select id from alert_rules where id=${f.one} for update`;ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);await held;})]);
    void blocker.then(([r])=>{if(r!.status==='rejected')reject(r.reason);});
    try{const pid=await Promise.race([acquired,new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(new Error('Rule lock timeout')),5000);})]);clearTimeout(timer);started=true;pending=Promise.allSettled([Promise.resolve().then(start)]);
      let waiting=false;for(let i=0;i<250;i++){if((await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`)[0]!.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(waiting,true,'request must really wait on the selected parent row');await during();
    }finally{clearTimeout(timer);release();if(!started)await client.end({timeout:0});const [locks,results]=await Promise.all([blocker,pending??Promise.resolve([])]);await client.end({timeout:1});for(const r of [...locks,...results])if(r.status==='rejected')throw r.reason;if(results[0]?.status==='fulfilled')result=results[0].value;}return result as T;
  }
  for(const kind of ['person-revoke','person-expire','team-revoke','team-expire','manage-revoke'] as const)it(`revalidates ${kind} after a real lock without mutation or deletion audit`,async()=>fixture(async f=>{
    const before=await sqlClient`select to_jsonb(r) as row from alert_rules r where id=${f.one}`,team=kind.startsWith('team');
    const response=await locked(f,()=>team?remove(f,f.ids.worker):patch(f),async()=>{
      if(kind==='manage-revoke')await sqlClient`delete from role_permissions where role_key=${f.roles.manager} and permission_key='alert-rules:manage'`;
      else if(kind.endsWith('revoke')){if(team)await sqlClient`update team_members set active=false where team_id=${f.team}`;else await sqlClient`update role_bindings set active=false where id=${f.binding}`;}
      else{const [r]=team?await sqlClient`update team_members set ends_at=clock_timestamp()+interval '0.1 seconds' where team_id=${f.team} returning ends_at::text as boundary`:await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 seconds' where id=${f.binding} returning ends_at::text as boundary`;await waitPast(r!.boundary);}
    });
    assert.equal(response.status,kind==='manage-revoke'?403:404,await response.clone().text());assert.deepEqual(await sqlClient`select to_jsonb(r) as row from alert_rules r where id=${f.one}`,before);assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
  }));
  for(const kind of ['source','target'] as const)it(`rechecks ${kind} authority after the proposed device lock wait`,async()=>fixture(async f=>{
    await exact(f);const targetBinding=randomUUID();
    if(kind==='target')await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${targetBinding},${f.ids.exact},${f.a},${f.roles.manager},'device',${f.d2})`;
    const before=await sqlClient`select to_jsonb(r) as row from alert_rules r where id=${f.one}`;
    const response=await locked(f,()=>patch(f,kind==='target'?f.ids.exact:f.ids.device,{deviceId:kind==='target'?f.d2:f.d1}),async()=>{
      await sqlClient`update role_bindings set active=false where id=${kind==='target'?targetBinding:f.deviceBinding}`;
    },kind==='target'?f.d2:f.d1);
    assert.equal(response.status,kind==='target'?403:404,await response.clone().text());
    assert.deepEqual(await sqlClient`select to_jsonb(r) as row from alert_rules r where id=${f.one}`,before);
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
  }));
  it('retargets a general rule while ingest holds the device and inserts its alert FK without a deadlock', {timeout:20_000},async()=>fixture(async f=>{
    await sqlClient`update alert_rules set device_id=null where id=${f.one}`;
    const require=createRequire(import.meta.url),postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const client=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2}),alert=randomUUID();
    let advance!:()=>void,ready!:(pid:number)=>void,reject!:(error:unknown)=>void,timer:ReturnType<typeof setTimeout>|undefined;
    const proceed=new Promise<void>(resolve=>{advance=resolve;}),acquired=new Promise<number>((resolve,fail)=>{ready=resolve;reject=fail;});
    const ingestion=Promise.allSettled([client.begin(async owner=>{
      await owner`set local statement_timeout='8s'`;
      await owner`select id from devices where id=${f.d2} for update`;
      ready((await owner`select pg_backend_pid() as pid`)[0]!.pid);await proceed;
      await owner`insert into alerts(id,building_id,device_id,rule_id,type,severity,message) values(${alert},${f.a},${f.d2},${f.one},'WATER_LOW','HIGH','Concurrent ingestion')`;
    })]);
    void ingestion.then(([result])=>{if(result!.status==='rejected')reject(result.reason);});
    let request:Promise<PromiseSettledResult<Response>[]>|undefined;
    try{
      const pid=await Promise.race([acquired,new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(new Error('Device acquisition timeout')),3000);})]);clearTimeout(timer);
      request=Promise.allSettled([patch(f,f.ids.manager,{deviceId:f.d2})]);
      let waiting=false;for(let i=0;i<250;i++){
        if((await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`)[0]!.waiting){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,true,'PATCH must really wait for the target device before ingestion inserts its rule FK');
      advance();const [[insert],[response]]=await Promise.all([ingestion,request]);
      assert.equal(insert!.status,'fulfilled',insert!.status==='rejected'?String(insert.reason):undefined);
      assert.equal(response!.status,'fulfilled');if(response!.status==='fulfilled')assert.equal(response.value.status,200,await response.value.clone().text());
      assert.equal((await sqlClient`select rule_id from alerts where id=${alert}`)[0]!.rule_id,f.one);
      assert.equal((await sqlClient`select device_id from alert_rules where id=${f.one}`)[0]!.device_id,f.d2);
    }finally{clearTimeout(timer);advance();await Promise.all([ingestion,request??Promise.resolve([])]);await client.end({timeout:1});}
  }));
  it('rolls back rule writes and alert relationships when audit insertion fails',async t=>fixture(async f=>{
    const logger=t.mock.method(console,'error',()=>undefined),name='rule_audit_failure_'+randomUUID().replaceAll('-',''),alert=randomUUID();
    await sqlClient`insert into alerts(id,building_id,device_id,rule_id,type,severity,message) values(${alert},${f.a},${f.d1},${f.one},'WATER_LOW','HIGH','Historical alert')`;
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.user_id=TG_ARGV[0] then raise exception 'fixture audit rejection'; end if; return NEW; end $$`);
    await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.ids.manager}')`);
    try{const before=await sqlClient`select to_jsonb(r) as row from alert_rules r where building_id=${f.a} order by id`;for(const send of [()=>f.request(f.ids.manager,'/alert-rules','POST',input(f.a,f.d1)),()=>patch(f,f.ids.manager,{messageTemplate:'Sensitive private template'}),()=>remove(f)]){const response=await send();assert.equal(response.status,500);assert.ok(!(await response.text()).includes('Sensitive'));assert.deepEqual(await sqlClient`select to_jsonb(r) as row from alert_rules r where building_id=${f.a} order by id`,before);assert.equal((await sqlClient`select rule_id from alerts where id=${alert}`)[0]!.rule_id,f.one);}assert.equal(logger.mock.callCount(),0);}
    finally{await sqlClient.unsafe(`drop trigger ${name} on audit_logs`);await sqlClient.unsafe(`drop function ${name}()`);}
  }));
  it('rolls back the already inserted audit when DELETE loses its grant and returns zero rows',async()=>fixture(async f=>{
    const original=appDb.transaction;let intercepted=false;
    function builder(target:any):any{return new Proxy(target,{get(object,key){const value=Reflect.get(object,key);
      if(key==='then')return(resolve:any,reject:any)=>Promise.resolve().then(async()=>{
        assert.equal(intercepted,false);intercepted=true;
        // The route has inserted its audit in the same transaction, but the
        // real DELETE statement has not started and must observe this revoke.
        await sqlClient`update role_bindings set active=false where id=${f.binding}`;
        return object;
      }).then(resolve,reject);
      if(typeof value==='function')return(...args:any[])=>{const result=value.apply(object,args);return result&&typeof result==='object'&&'toSQL' in result?builder(result):result;};return value;
    }});}
    appDb.transaction=((callback:any,...options:any[])=>original.call(appDb,(tx:any)=>callback(new Proxy(tx,{get(target,key,receiver){if(key==='delete')return(...args:any[])=>builder(target.delete(...args));return Reflect.get(target,key,receiver);}})),...options)) as typeof appDb.transaction;
    try{const before=await sqlClient`select to_jsonb(r) as row from alert_rules r where id=${f.one}`;
      assert.equal((await remove(f)).status,403);assert.equal(intercepted,true);
      assert.deepEqual(await sqlClient`select to_jsonb(r) as row from alert_rules r where id=${f.one}`,before);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    }finally{appDb.transaction=original;}
  }));
  async function afterRows(run:()=>Promise<void>,during:()=>Promise<void>){
    const original=appDb.transaction;let delayed=false;
    function builder(target:any):any{return new Proxy(target,{get(object,key){const value=Reflect.get(object,key);if(key==='then')return(resolve:any,reject:any)=>object.then(async(rows:any)=>{if(!delayed&&object.toSQL().sql.includes('alert_rules')){delayed=true;await during();}return resolve(rows);},reject);if(typeof value==='function')return(...args:any[])=>{const result=value.apply(object,args);return result&&typeof result==='object'&&('from' in result||'toSQL' in result)?builder(result):result;};return value;}});}
    appDb.transaction=((callback:any,...options:any[])=>original.call(appDb,(tx:any)=>callback(new Proxy(tx,{get(target,key,receiver){if(key==='select')return(...args:any[])=>builder(target.select(...args));return Reflect.get(target,key,receiver);}})),...options)) as typeof appDb.transaction;
    try{await run();assert.equal(delayed,true);}finally{appDb.transaction=original;}
  }
  it('does not deliver cached rule contents after scope revocation',async()=>fixture(async f=>{
    await afterRows(async()=>assert.equal((await f.list(f.ids.device)).status,403),async()=>{await sqlClient`update role_bindings set active=false where id=${f.deviceBinding}`;});
  }));
  it('reapplies only this domain and keeps private helpers outside runtime ACLs',async()=>fixture(async f=>{
    const migration=await readFile(new URL('../../../infrastructure/032-alert-rules-capabilities.sql',import.meta.url),'utf8'),rollback=new Error('rule migration rollback');
    const strip=(value:string)=>value.replace(/WHEN 'ALERT_RULE_(?:CREATED|UPDATED|DELETED)'::text THEN .*?(?=WHEN |ELSE)/gs,'').replace(/\s+/g,' ').trim();
    await assert.rejects(sqlClient.begin(async owner=>{
      await owner`update permissions set active=false where key='alert-rules:manage'`;await owner`update role_bindings set active=false where id=${f.binding}`;
      const [before]=await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;
      const unrelated=()=>owner`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename<>'alert_rules' and policyname not in ('audit_logs_insert_policy','building_features_alert_rules_read','feature_runtime_alert_rules_read') order by tablename,policyname`;
      const baseline=await unrelated();const [feature]=await owner`select prosrc from pg_proc where oid='app_can_read_feature_event(text)'::regprocedure`;
      const stripFeature=(source:string)=>source.replaceAll('OR app_alert_rule_can_read_scope(b.id)','').replace(/\s+/g,' ').trim();
      for(let i=0;i<2;i++){await owner.unsafe(migration);assert.deepEqual(await unrelated(),baseline);const [audit]=await owner`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy where polrelid='audit_logs'::regclass and polname='audit_logs_insert_policy'`;assert.equal(strip(audit!.expression),strip(before!.expression));assert.equal((await owner`select active from permissions where key='alert-rules:manage'`)[0]!.active,false);assert.equal((await owner`select active from role_bindings where id=${f.binding}`)[0]!.active,false);assert.equal(stripFeature((await owner`select prosrc from pg_proc where oid='app_can_read_feature_event(text)'::regprocedure`)[0]!.prosrc),stripFeature(feature!.prosrc));}throw rollback;
    }),e=>e===rollback);
    for(const signature of ['app_alert_rule_target_has_capability(text,text,text)','app_alert_rule_has_capability(text,text,text)','app_alert_rule_can_read_scope(text)','app_alert_rule_context(text,text)','app_alert_rule_target_context(text,text)','app_alert_rule_lock_target(text,text,text)']){
      const [r]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(r!.prosecdef,true);assert.equal(r!.provolatile,signature.startsWith('app_alert_rule_lock_target(')?'v':'s');assert.equal(r!.owned,true);assert.ok(r!.proconfig.includes('search_path=public, pg_temp'));assert.equal(r!.app,true);assert.equal(r!.identity,false);assert.equal(r!.broker,false);assert.equal(r!.public_execute,false);
    }
    for(const runtime of ['predioon_app','predioon_identity','predioon_broker_auth'])assert.equal((await sqlClient`select has_function_privilege(${runtime},'app_alert_rule_parent_valid(text,text)','EXECUTE') as allowed`)[0]!.allowed,false);
    const [bad]=await as(f.ids.manager,tx=>tx.execute(sql`select app_alert_rule_has_capability(${f.a},'bad-id','alert-rules:read') as malformed,app_alert_rule_has_capability(${f.a},${f.foreign},'alert-rules:read') as foreign_rule,app_alert_rule_has_capability(${f.a},${f.one},'alerts:read') as wrong_capability`));assert.deepEqual({...bad},{malformed:false,foreign_rule:false,wrong_capability:false});
    for(const [user,rule,device] of [[f.ids.manager,'bad-id',f.d1],[f.ids.reader,f.one,f.d1],[f.ids.manager,f.foreign,f.foreignDevice],[f.ids.manager,f.one,f.foreignDevice],[f.ids.manager,f.one,'missing-device']])assert.equal((await as(user!,tx=>tx.execute(sql`select app_alert_rule_lock_target(${f.a},${rule!},${device!}) as allowed`)))[0]!.allowed,false);
  }));
  it('uses point PK and binding candidates without rule-history scans for scope',async t=>fixture(async f=>{
    await exact(f);await sqlClient`insert into alert_rules(building_id,device_id,name,metric,operator,threshold,alert_type,message_template,created_by) select ${f.a},${f.d2},'History '||n::text,'energy_total_kwh','GT',1,'OLD','Private',${f.ids.manager} from generate_series(1,4000) n`;
    await sqlClient`analyze alert_rules`;await sqlClient`analyze role_bindings`;
    const plans=await sqlClient.begin(async owner=>{
      await owner`select set_config('app.user_id',${f.ids.exact},true)`;
      async function explain(signature:string,values:string[],names:string[]){const [r]=await owner`select prosrc from pg_proc where oid=${signature}::regprocedure`;let body=String(r!.prosrc);names.forEach((name,i)=>{body=body.replaceAll(name,'$'+(i+1));});return JSON.stringify((await owner.unsafe(`explain (format json) ${body}`,values))[0]!['QUERY PLAN']);}
      return {point:await explain('app_alert_rule_has_capability(text,text,text)',[f.a,f.one,'alert-rules:read'],['target_building_id','target_rule_id','target_capability']),scope:await explain('app_alert_rule_can_read_scope(text)',[f.a],['target_building_id'])};
    });
    assert.ok(plans.point.includes('alert_rules_pkey'),plans.point);assert.ok(!plans.scope.includes('"Relation Name":"alert_rules"'),plans.scope);t.diagnostic('Actual stored SQL uses rule PK; scope reads active binding candidates, not alert or rule history.');
  }));
});
