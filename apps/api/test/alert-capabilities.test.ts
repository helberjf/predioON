import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { sqlClient } from "@predioon/db";
import { closeAppDb, readFeatures, withUserContext, type AppTransaction } from "@predioon/db/runtime";
import { CAPABILITIES, ROLE_CAPABILITIES, SUPPORT_CAPABILITIES } from "@predioon/shared";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { startTestServer, login, call } from "./helpers.js";

describe("alert capabilities, RLS and controlled transitions", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
  async function create() {
    const suffix=randomUUID(), org=`alert-org-${suffix}`, a=`alert-a-${suffix}`, b=`alert-b-${suffix}`;
    const d1=`alert-d1-${suffix}`, d2=`alert-d2-${suffix}`, db=`alert-db-${suffix}`, gateway=`alert-gw-${suffix}`, foreignGateway=`alert-gwb-${suffix}`;
    const worker=`alert-worker-${suffix}`, scoped=`alert-scoped-${suffix}`, direct=`alert-direct-${suffix}`, resident=`alert-resident-${suffix}`;
    const support=`alert-support-${suffix}`, platform=`alert-platform-${suffix}`, outsider=`alert-outsider-${suffix}`, exact=`alert-exact-${suffix}`, gateUser=`alert-gate-${suffix}`;
    const ids=[worker,scoped,direct,resident,support,platform,outsider,exact,gateUser];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Alert test',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for(const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id+'@alerts.test'},${id},${passwordHash})`;
    await sqlClient`update users set is_platform_admin=true where id=${platform}`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gateway},${a},'A',${gateway}),(${foreignGateway},${b},'B',${foreignGateway})`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${d1},${a},${gateway},'Mixed A','ENERGY_METER','{"secret":"private"}'),(${d2},${a},null,'Neighbor','WATER_LEVEL_SENSOR','{}'),(${db},${b},null,'Foreign','WATER_LEVEL_SENSOR','{}')`;
    const one=randomUUID(), neighbor=randomUUID(), none=randomUUID(), gateAlert=randomUUID(), foreign=randomUUID(), rule=randomUUID();
    await sqlClient`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template) values(${rule},${a},${d1},'Rule','water_level_percent','LT',10,'WATER_LOW','private threshold')`;
    await sqlClient`insert into alerts(id,building_id,device_id,rule_id,gateway_id,severity,type,message,created_at) values
      (${one},${a},${d1},${rule},null,'HIGH','WATER_LOW','One',now()-interval '4 seconds'),
      (${neighbor},${a},${d2},null,null,'HIGH','WATER_LOW','Neighbor',now()-interval '3 seconds'),
      (${none},${a},null,null,null,'HIGH','GENERAL','None',now()-interval '2 seconds'),
      (${gateAlert},${a},null,null,${gateway},'HIGH','GATEWAY_OFFLINE','Gateway',now()-interval '1 second'),
      (${foreign},${b},${db},null,${foreignGateway},'HIGH','WATER_LOW','Foreign',now())`;
    const team=randomUUID(), teamBinding=randomUUID(), scopedBinding=randomUUID(), directBinding=randomUUID(), supportBinding=randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Maintenance')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values
      (${scopedBinding},${scoped},${a},'MAINTENANCE','device',${d1}),
      (${randomUUID()},${exact},${a},'MAINTENANCE_MANAGER','alert',${one}),
      (${randomUUID()},${gateUser},${a},'MAINTENANCE_MANAGER','gateway',${gateway})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${directBinding},${direct},${a},'BUILDING_ADMIN'),(${randomUUID()},${resident},${a},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    const tokens=new Map<string,string>();
    for(const id of ids) tokens.set(id,(await login(server.url,id+'@alerts.test')).accessToken);
    const request=(user:string,path:string,method="GET")=>call(server.url,path,{token:tokens.get(user),method});
    const list=(user:string,building:string|null=a,extra="")=>request(user,`/alerts?${building?'buildingId='+building+'&':''}${extra}`);
    const transition=(user:string,id=one,state="acknowledge")=>request(user,`/alerts/${id}/${state}`,"POST");
    return {org,a,b,d1,d2,db,gateway,foreignGateway,one,neighbor,none,gateAlert,foreign,rule,worker,scoped,direct,resident,support,platform,outsider,exact,gateUser,ids,team,teamBinding,scopedBinding,directBinding,supportBinding,request,list,transition};
  }
  async function fixture(run:(f:Awaited<ReturnType<typeof create>>)=>Promise<void>) {
    const f=await create(); try { await run(f); } finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
      await sqlClient`delete from gates where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function items(response:Response) { assert.equal(response.status,200,await response.clone().text()); return (await response.json()).items as any[]; }
  async function raw(user:string) { return [...await as(user,tx=>tx.execute(sql`select id,building_id from alerts`))]; }
  const transitionSql=(user:string,id:string,state:string)=>as(user,tx=>tx.execute(sql`select app_transition_alert(${id}::uuid,${state},'test-ip','test-agent')`));

  it("reads direct and team tenant bindings with no memberships and preserves pagination",async()=>fixture(async f=>{
    for(const user of [f.direct,f.worker]) {
      assert.equal((await items(await f.list(user))).length,4); assert.equal((await raw(user)).length,4);
      assert.equal((await f.list(user,f.b)).status,403);
    }
    const response=await f.list(f.worker,f.a,'limit=1&offset=1&status=OPEN'); const body=await response.json();
    assert.equal(response.status,200); assert.equal(body.limit,1); assert.equal(body.offset,1); assert.equal(body.items[0].id,f.none);
    assert.ok(body.items[0].buildingId); assert.equal(body.items[0].building_id,undefined);
    await sqlClient`delete from alerts where building_id=${f.a}`; assert.deepEqual(await items(await f.list(f.worker)),[]);
  }));
  it("limits exact alert, device and explicit gateway scopes without promoting building resources",async()=>fixture(async f=>{
    for(const [user,id] of [[f.scoped,f.one],[f.exact,f.one],[f.gateUser,f.gateAlert]]) {
      assert.deepEqual((await items(await f.list(user,null))).map(r=>r.id),[id]); assert.deepEqual((await raw(user)).map(r=>r.id),[id]);
      assert.equal((await f.transition(user,id)).status,200); assert.equal((await f.transition(user,f.neighbor)).status,404);
    }
    // Device.gateway_id alone does not constitute gateway association on the alert.
    assert.equal((await f.transition(f.gateUser,f.one)).status,404);
    await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
    assert.equal((await f.list(f.scoped)).status,403); assert.deepEqual(await raw(f.scoped),[]);
  }));
  it("denies global, resident and forged legacy roles while preserving legacy administrator membership",async()=>fixture(async f=>{
    await sqlClient`insert into memberships(user_id,building_id,role) values(${f.resident},${f.a},'RESIDENT')`;
    for(const user of [f.platform,f.resident,f.outsider]) {
      assert.equal((await f.list(user)).status,403); assert.deepEqual(await items(await f.list(user,null)),[]);
      assert.equal((await f.transition(user)).status,404); assert.deepEqual(await raw(user),[]);
    }
    await sqlClient`insert into memberships(user_id,building_id,role) values(${f.outsider},${f.a},'BUILDING_ADMIN')`;
    assert.equal((await items(await f.list(f.outsider))).length,4); assert.equal((await f.transition(f.outsider,f.one,'resolve')).status,200);
  }));
  it("supports alerts read independently of device and telemetry grants and denies expiry or revocation",async()=>fixture(async f=>{
    const grant=randomUUID(); await sqlClient`insert into support_grants(id,support_user_id,granted_by,building_id,capability,resource_type,resource_id,reason,expires_at) values(${grant},${f.support},${f.direct},${f.a},'alerts:read','alert',${f.one},'Diagnosis',now()+interval '1 hour')`;
    assert.deepEqual((await items(await f.list(f.support))).map(r=>r.id),[f.one]); assert.equal((await f.transition(f.support)).status,403);
    const [caps]=await as(f.support,tx=>tx.execute(sql`select app_has_capability(${f.a},'devices:read','device',${f.d1}) as devices,app_has_capability(${f.a},'telemetry:read','device',${f.d1}) as telemetry`)); assert.equal(caps.devices,false); assert.equal(caps.telemetry,false);
    await sqlClient`update support_grants set revoked_at=now() where id=${grant}`; assert.equal((await f.list(f.support)).status,403);
    await sqlClient`update support_grants set revoked_at=null,created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${grant}`; assert.deepEqual(await raw(f.support),[]);
    await sqlClient`update support_grants set expires_at=now()+interval '1 hour' where id=${grant}`;
    await sqlClient`update role_bindings set active=false where id=${f.supportBinding}`; assert.deepEqual(await raw(f.support),[]);
  }));
  it("rechecks live account organization building and binding windows on the same JWT",async()=>fixture(async f=>{
    for(const table of ['users','organizations','buildings']) {
      const id=table==='users'?f.worker:table==='organizations'?f.org:f.a;
      await sqlClient.unsafe(`update ${table} set active=false where id=$1`,[id]);
      assert.equal((await f.list(f.worker)).status,table==='users'?401:403); assert.deepEqual(await raw(f.worker),[]);
      await sqlClient.unsafe(`update ${table} set active=true where id=$1`,[id]); assert.equal((await items(await f.list(f.worker))).length,4);
    }
    await sqlClient`update role_bindings set active=false where id=${f.teamBinding}`; assert.equal((await f.list(f.worker)).status,403);
    await sqlClient`update role_bindings set active=true,ends_at=now()-interval '1 minute',starts_at=now()-interval '1 hour' where id=${f.teamBinding}`; assert.deepEqual(await raw(f.worker),[]);
    await sqlClient`update role_bindings set ends_at=null,starts_at=now()+interval '1 hour' where id=${f.teamBinding}`; assert.deepEqual(await raw(f.worker),[]);
    await sqlClient`update role_bindings set starts_at=null where id=${f.teamBinding}`;
    for(const target of ['teams','team_members']) {
      if(target==='teams') await sqlClient`update teams set active=false where id=${f.team}`; else await sqlClient`update team_members set active=false where team_id=${f.team}`;
      assert.equal((await f.list(f.worker)).status,403);
      if(target==='teams') await sqlClient`update teams set active=true where id=${f.team}`; else await sqlClient`update team_members set active=true where team_id=${f.team}`;
    }
    await sqlClient`update team_members set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where team_id=${f.team}`; assert.deepEqual(await raw(f.worker),[]);
  }));
  it("hides inconsistent device gateway rule and rule-device owner fixtures",async()=>fixture(async f=>{
    const badRule=randomUUID(); await sqlClient`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template) values(${badRule},${f.b},${f.db},'Bad','water_level_percent','LT',10,'WATER_LOW','Bad')`;
    for(const [column,value] of [['device_id',f.db],['gateway_id',f.foreignGateway],['rule_id',badRule]]) {
      const id=randomUUID(); await sqlClient.unsafe(`insert into alerts(id,building_id,${column},severity,type,message) values($1,$2,$3,'HIGH','GENERAL','Bad')`,[id,f.a,value]);
      assert.equal((await f.transition(f.direct,id)).status,404); await assert.rejects(transitionSql(f.direct,id,'RESOLVED'));
    }
    await sqlClient`update alert_rules set device_id=${f.db} where id=${f.rule}`;
    assert.ok(!(await raw(f.direct)).some(r=>r.id===f.one));
    await sqlClient`update alert_rules set device_id=${f.d2} where id=${f.rule}`;
    assert.equal((await f.transition(f.direct)).status,404);
    assert.equal((await raw(f.direct)).length,3);
  }));
  it("splits acknowledge from resolve and requires independent live read and write",async()=>fixture(async f=>{
    assert.equal((await f.transition(f.worker)).status,200); assert.equal((await f.transition(f.worker,f.one,'resolve')).status,403);
    assert.equal((await f.transition(f.exact,f.one,'resolve')).status,200);
    const [read]=await sqlClient`select active from permissions where key='alerts:read'`;
    try { await sqlClient`update permissions set active=false where key='alerts:read'`; assert.equal((await f.transition(f.direct,f.neighbor)).status,404); await assert.rejects(transitionSql(f.direct,f.neighbor,'ACKNOWLEDGED')); }
    finally { await sqlClient`update permissions set active=${read.active} where key='alerts:read'`; }
    const [write]=await sqlClient`select active from permissions where key='alerts:acknowledge'`;
    try { await sqlClient`update permissions set active=false where key='alerts:acknowledge'`; assert.equal((await f.transition(f.direct,f.neighbor)).status,403); }
    finally { await sqlClient`update permissions set active=${write.active} where key='alerts:acknowledge'`; }
  }));
  it("stamps the authenticated actor and DB time with one audit per effective transition",async()=>fixture(async f=>{
    const [clock]=await sqlClient`select clock_timestamp() as time`;
    const response=await f.transition(f.worker); assert.equal(response.status,200); const acknowledged=await response.json();
    assert.equal(acknowledged.acknowledgedBy,f.worker); assert.ok(Date.parse(acknowledged.acknowledgedAt)>=new Date(clock.time).getTime());
    assert.equal((await f.transition(f.direct)).status,200);
    let [stored]=await sqlClient`select * from alerts where id=${f.one}`; assert.equal(stored.acknowledged_by,f.worker); assert.equal(new Date(stored.acknowledged_at).toISOString(),acknowledged.acknowledgedAt);
    await transitionSql(f.exact,f.one,'RESOLVED'); await transitionSql(f.direct,f.one,'RESOLVED');
    [stored]=await sqlClient`select * from alerts where id=${f.one}`; assert.equal(stored.resolved_by,f.exact);
    const audits=await sqlClient`select * from audit_logs where resource_id=${f.one} order by created_at`;
    assert.deepEqual(audits.map(r=>r.action),['ALERT_ACKNOWLEDGED','ALERT_RESOLVED']); assert.ok(audits.every(r=>r.actor_type==='USER'&&r.building_id===f.a&&r.resource_type==='alert'));
    assert.equal(audits[1].ip_address,'test-ip'); assert.equal(audits[1].user_agent,'test-agent');
    assert.equal((await f.transition(f.direct)).status,409); assert.equal((await f.transition(f.direct,f.one,'resolve')).status,200);
  }));
  it("serializes concurrent acknowledge and resolve without status regression",async()=>fixture(async f=>{
    const responses=await Promise.all([f.transition(f.direct),f.transition(f.direct,f.one,'resolve')]);
    assert.equal(responses[1].status,200); assert.ok([200,409].includes(responses[0].status));
    const [row]=await sqlClient`select status from alerts where id=${f.one}`; assert.equal(row.status,'RESOLVED');
    const audits=await sqlClient`select action from audit_logs where resource_id=${f.one}`; assert.equal(audits.filter(r=>r.action==='ALERT_RESOLVED').length,1); assert.ok(audits.length<=2);
  }));
  it("rolls back alert and audit together, including audit insertion failures",async()=>fixture(async f=>{
    await assert.rejects(as(f.direct,async tx=>{ await tx.execute(sql`select app_transition_alert(${f.one}::uuid,'ACKNOWLEDGED')`); throw new Error('explicit rollback'); }),/explicit rollback/);
    let [row]=await sqlClient`select status from alerts where id=${f.one}`; assert.equal(row.status,'OPEN');
    const constraint=`alert_audit_${randomUUID().replaceAll('-','')}`;
    await sqlClient.unsafe(`alter table audit_logs add constraint ${constraint} check (resource_id <> '${f.one}')`);
    try { await assert.rejects(transitionSql(f.direct,f.one,'RESOLVED')); } finally { await sqlClient.unsafe(`alter table audit_logs drop constraint ${constraint}`); }
    [row]=await sqlClient`select status from alerts where id=${f.one}`; assert.equal(row.status,'OPEN');
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.one}`).length,0);
  }));
  it("prohibits direct DML and checks direct transition scope target and helper privileges",async()=>fixture(async f=>{
    for(const statement of [sql`update alerts set message='forged' where id=${f.one}`,sql`delete from alerts where id=${f.one}`,sql`insert into alerts(building_id,severity,type,message) values(${f.a},'HIGH','FAKE','Forged')`]) await assert.rejects(as(f.direct,tx=>tx.execute(statement)));
    for(const target of ['OPEN','garbage']) await assert.rejects(transitionSql(f.direct,f.one,target));
    await assert.rejects(transitionSql(f.scoped,f.neighbor,'ACKNOWLEDGED')); await assert.rejects(transitionSql(f.worker,f.one,'RESOLVED'));
    const projection=await as(f.support,tx=>tx.execute(sql`select * from app_alert_authorized_contexts(null)`)); assert.equal(projection.length,0);
    const rows=await as(f.scoped,tx=>tx.execute(sql`select * from app_alert_authorized_contexts(null)`));
    assert.deepEqual(Object.keys(rows[0]).sort(),['building_id','alert_id','device_id','gateway_id','rule_id','rule_metric','device_type','gate_kind','parking_vehicle_type'].sort());
    for(const signature of ['app_alert_authorized_contexts(text,uuid)','app_alert_has_capability(text,text,text)','app_alert_can_read_feature_state(text)','app_transition_alert(uuid,text,text,text)']) {
      const [helper]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner)=pg_get_userbyid(c.proowner) as matching_owner,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,
        exists(select 1 from aclexplode(p.proacl) acl where grantee=0 and privilege_type='EXECUTE') as public from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(helper.prosecdef,true); assert.equal(helper.matching_owner,true); assert.equal(helper.app,true); assert.equal(helper.identity,false); assert.equal(helper.broker,false); assert.equal(helper.public,false); assert.ok(helper.proconfig.includes('search_path=public, pg_temp'));
      assert.equal(helper.provolatile,signature.startsWith('app_transition')?'v':'s');
    }
  }));
  it("denies forged migrated audits including invalid UUIDs and mismatched tenants",async()=>fixture(async f=>{
    for(const [user,tenant,id,action] of [[f.platform,f.a,f.one,'ALERT_ACKNOWLEDGED'],[f.worker,f.a,f.one,'ALERT_RESOLVED'],[f.direct,f.b,f.one,'ALERT_ACKNOWLEDGED'],[f.direct,f.a,'invalid-uuid','ALERT_RESOLVED']]) {
      await assert.rejects(as(user,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id) values(${tenant},${user},'USER',${action},'alert',${id})`)));
    }
    await as(f.scoped,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id) values(${f.a},${f.scoped},'USER','ALERT_ACKNOWLEDGED','alert',${f.one})`));
  }));
  it("respects pause without buildings read and restores historical alerts on resume",async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    const [permission]=await sqlClient`select active from permissions where key='buildings:read'`;
    try {
      await sqlClient`update permissions set active=false where key='buildings:read'`;
      assert.deepEqual(await items(await f.list(f.scoped)),[]); assert.equal((await f.transition(f.scoped)).status,403);
      await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
      await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',now())`;
      assert.deepEqual((await items(await f.list(f.scoped))).map(r=>r.id),[f.one]); assert.equal((await f.transition(f.scoped)).status,200);
    } finally { await sqlClient`update permissions set active=${permission.active} where key='buildings:read'`; }
  }));
  it("classifies adaptive daily pump rule gate and parking features from minimal context",async()=>fixture(async f=>{
    const {alertFeatureKeys}=await import('../src/modules/alerts/authorization.js');
    const contexts=await as(f.scoped,tx=>tx.execute(sql`select * from app_alert_authorized_contexts(null)`)); const context=contexts[0] as any;
    assert.deepEqual(alertFeatureKeys(context,'ADAPTIVE_WATER_LIMIT'),['AI_ANALYSIS','WATER_CONSUMPTION']); assert.deepEqual(alertFeatureKeys(context,'DAILY_ENERGY_LIMIT'),['ENERGY_CONSUMPTION']); assert.deepEqual(alertFeatureKeys(context,'PUMP_CONTINUOUS_LIMIT'),['PUMP']); assert.deepEqual(alertFeatureKeys(context,'WATER_LOW'),['WATER_TANK']);
    assert.deepEqual(alertFeatureKeys({...context,rule_metric:null,device_type:'GATE_CONTROLLER',gate_kind:'GARAGE'},'STATE'),['GARAGE_ACCESS']);
    assert.deepEqual(alertFeatureKeys({...context,rule_metric:null,device_type:'PARKING_SENSOR',parking_vehicle_type:'MOTORCYCLE'},'STATE'),['MOTORCYCLE_PARKING']);
    await sqlClient`update alerts set type='ADAPTIVE_WATER_LIMIT' where id=${f.one}`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'AI_ANALYSIS',false)`;
    assert.deepEqual(await items(await f.list(f.scoped)),[]); assert.equal((await f.transition(f.scoped)).status,403);
  }));
  it("keeps SQL and TypeScript capability catalogs aligned with only admin and manager resolve",async()=>{
    assert.ok(CAPABILITIES.includes('alerts:resolve' as any)); assert.ok(!SUPPORT_CAPABILITIES.includes('alerts:resolve' as any));
    for(const [role,caps] of Object.entries(ROLE_CAPABILITIES)) {
      const rows=await sqlClient`select permission_key from role_permissions where role_key=${role} order by permission_key`;
      assert.deepEqual(rows.map(r=>r.permission_key),[...caps].sort(),role); assert.equal(caps.includes('alerts:resolve' as any),['BUILDING_ADMIN','MAINTENANCE_MANAGER'].includes(role));
    }
  });
  it("returns precise SQL errors and rejects malformed helper IDs without UUID conversion errors",async()=>fixture(async f=>{
    for(const [user,id,state,code] of [[f.direct,f.one,'OPEN','22023'],[f.direct,randomUUID(),'ACKNOWLEDGED','P0002'],[f.scoped,f.neighbor,'ACKNOWLEDGED','P0002'],[f.worker,f.one,'RESOLVED','42501']]) {
      await assert.rejects(transitionSql(user,id,state),error=>pgErrorCode(error)===code);
    }
    await transitionSql(f.direct,f.one,'RESOLVED');
    await assert.rejects(transitionSql(f.direct,f.one,'ACKNOWLEDGED'),error=>pgErrorCode(error)==='P0409');
    for(const id of ['invalid-uuid','',null]) {
      const [allowed]=await as(f.direct,tx=>tx.execute(sql`select app_alert_has_capability(${f.a},${id},'alerts:read') as allowed`)); assert.equal(allowed.allowed,false);
      await assert.rejects(as(f.direct,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id) values(${f.a},${f.direct},'USER','ALERT_RESOLVED','alert',${id})`)),error=>pgErrorCode(error)==='42501');
    }
    const [invalid]=await as(f.direct,tx=>tx.execute(sql`select app_alert_has_capability(${f.a},${f.one},'devices:read') as allowed`)); assert.equal(invalid.allowed,false);
    assert.equal((await f.transition(f.direct,'invalid-uuid')).status,404);
    await assert.rejects(as(f.direct,tx=>tx.execute(sql`select app_transition_alert(${f.one}::uuid,null)`)),error=>pgErrorCode(error)==='22023');
  }));
  it("uses local grants for a global administrator and honors direct binding and role revocation",async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.platform},${f.a},'MAINTENANCE_MANAGER')`;
    assert.equal((await items(await f.list(f.platform))).length,4); assert.equal((await f.transition(f.platform,f.neighbor,'resolve')).status,200);
    for(const update of [()=>sqlClient`update role_bindings set active=false where id=${f.scopedBinding}`,()=>sqlClient`update role_bindings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=${f.scopedBinding}`,()=>sqlClient`update role_bindings set starts_at=now()+interval '1 hour',ends_at=null where id=${f.scopedBinding}`]) {
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.scopedBinding}`;
      await update();
      assert.equal((await f.list(f.scoped)).status,403); assert.equal((await f.transition(f.scoped)).status,404);
    }
    await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.scopedBinding}`;
    const [role]=await sqlClient`select active from roles where key='MAINTENANCE'`;
    try { await sqlClient`update roles set active=false where key='MAINTENANCE'`; assert.deepEqual(await raw(f.scoped),[]); assert.equal((await f.list(f.scoped)).status,403); }
    finally { await sqlClient`update roles set active=${role.active} where key='MAINTENANCE'`; }
  }));
  it("keeps exact RLS and context reads bounded when a tenant has thousands of historical alerts",async t=>fixture(async f=>{
    await sqlClient`insert into alerts(building_id,severity,type,message,created_at) select ${f.a},'HIGH','GENERAL','Historical',now()-n*interval '1 day' from generate_series(1,2000) n`;
    await sqlClient`analyze alerts`;
    const explain=await as(f.exact,tx=>tx.execute(sql`explain (analyze,format json) select id from alerts where id=${f.one}::uuid`));
    const plan=(explain[0]['QUERY PLAN'] as any)[0].Plan;
    assert.equal(plan['Actual Rows'],1); assert.ok(['Index Scan','Index Only Scan'].includes(plan['Node Type'])); assert.match(plan['Index Cond'],/id =/);
    t.diagnostic(`Exact alert RLS: ${plan['Node Type']} on ${plan['Index Name']}, rows ${plan['Actual Rows']}, loops ${plan['Actual Loops']}`);
    for(let n=0;n<10;n++) {
      const contexts=await as(f.exact,tx=>tx.execute(sql`select * from app_alert_authorized_contexts(${f.a},${f.one}::uuid)`)); assert.equal(contexts.length,1); assert.equal(contexts[0].alert_id,f.one);
    }
    const body=await (await f.list(f.direct,f.a,'limit=1')).json(); assert.equal(body.items.length,1);
  }));
  it("revalidates binding revocation after waiting for the alert row lock",async()=>fixture(async f=>{
    let pending: Promise<unknown> | undefined;
    await sqlClient.begin(async owner=>{
      await owner`select id from alerts where id=${f.one} for update`;
      pending=transitionSql(f.scoped,f.one,'ACKNOWLEDGED').then(()=>null,error=>pgErrorCode(error));
      const deadline=Date.now()+5000;
      let blocked=false;
      while(Date.now()<deadline) {
        const [activity]=await sqlClient`select exists(select 1 from pg_stat_activity where usename='predioon_app' and wait_event_type='Lock' and query like '%app_transition_alert%') as blocked`;
        if(activity.blocked) { blocked=true; break; }
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'transition must be waiting for the owner fixture row lock');
      await owner`update role_bindings set active=false where id=${f.scopedBinding}`;
    });
    assert.equal(await pending,'P0002');
    const [stored]=await sqlClient`select status from alerts where id=${f.one}`; assert.equal(stored.status,'OPEN');
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.one}`).length,0);
  }));
  it("authorizes feature state from current resource grants without needing alert history",async()=>fixture(async f=>{
    await sqlClient`delete from alerts where building_id=${f.a}`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    // Isolate the additive alerts policy; existing independent feature-state
    // permissions intentionally remain ORed in the production policies.
    const isolatedKeys=['buildings:read','telemetry:read','telemetry:read-published','features:manage','notices:read','common-areas:read','occurrences:read-own','occurrences:manage','reservations:read-own','reservations:manage','reservations:read-calendar'];
    const permissions=await sqlClient`select key,active from permissions where key in ${sqlClient(isolatedKeys)}`;
    const state=(user:string)=>as(user,async tx=>{
      const [allowed]=await tx.execute(sql`select app_alert_can_read_feature_state(${f.a}) as allowed`);
      const rows=await tx.execute(sql`select feature_key from building_feature_settings where building_id=${f.a}`);
      return {allowed:allowed.allowed,count:rows.length};
    });
    try {
      await sqlClient`update permissions set active=false where key in ${sqlClient(isolatedKeys)}`;
      assert.deepEqual(await state(f.scoped),{allowed:true,count:1});
      assert.deepEqual(await state(f.gateUser),{allowed:true,count:1});
      assert.deepEqual(await state(f.exact),{allowed:false,count:0});
      for(const user of [f.platform,f.resident,f.outsider,f.support]) assert.deepEqual(await state(user),{allowed:false,count:0});
      await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
      assert.deepEqual(await state(f.scoped),{allowed:false,count:0});
      await sqlClient`update role_bindings set resource_type='device',resource_id=${f.db} where id=${f.scopedBinding}`;
      assert.deepEqual(await state(f.scoped),{allowed:false,count:0});
      await sqlClient`update role_bindings set resource_id=${f.d1} where id=${f.scopedBinding}`;
      await sqlClient`update role_bindings set active=false where id=${f.scopedBinding}`;
      assert.deepEqual(await state(f.scoped),{allowed:false,count:0});
      await sqlClient`update role_bindings set resource_type='device',resource_id=${f.d1} where id=${f.teamBinding}`;
      assert.deepEqual(await state(f.worker),{allowed:true,count:1});
      await sqlClient`update team_members set active=false where team_id=${f.team}`;
      assert.deepEqual(await state(f.worker),{allowed:false,count:0});
      const grant=randomUUID();
      await sqlClient`insert into support_grants(id,support_user_id,granted_by,building_id,capability,resource_type,resource_id,reason,expires_at) values(${grant},${f.support},${f.direct},${f.a},'alerts:read','gateway',${f.gateway},'Feature diagnosis',now()+interval '1 hour')`;
      assert.deepEqual(await state(f.support),{allowed:true,count:1});
      await sqlClient`update support_grants set revoked_at=now() where id=${grant}`;
      assert.deepEqual(await state(f.support),{allowed:false,count:0});
      await sqlClient`update support_grants set revoked_at=null,resource_id=${f.foreignGateway} where id=${grant}`;
      // 016's independent selector policy also considers support grants. This
      // check isolates the alerts helper's exact resource validity decision.
      assert.equal((await state(f.support)).allowed,false);
      assert.equal((await f.list(f.support)).status,403);
      assert.deepEqual(await raw(f.support),[]);
      await sqlClient`update support_grants set resource_id=${f.gateway},created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${grant}`;
      assert.deepEqual(await state(f.support),{allowed:false,count:0});
      await sqlClient`update support_grants set expires_at=now()+interval '1 hour' where id=${grant}`;
      await sqlClient`update role_bindings set active=false where id=${f.supportBinding}`;
      assert.deepEqual(await state(f.support),{allowed:false,count:0});
      for(const table of ['users','organizations','buildings']) {
        const id=table==='users'?f.gateUser:table==='organizations'?f.org:f.a;
        await sqlClient.unsafe(`update ${table} set active=false where id=$1`,[id]);
        assert.deepEqual(await state(f.gateUser),{allowed:false,count:0});
        await sqlClient.unsafe(`update ${table} set active=true where id=$1`,[id]);
      }
    } finally { for(const permission of permissions) await sqlClient`update permissions set active=${permission.active} where key=${permission.key}`; }
  }));
  it("does not enumerate historical alerts inside actual feature settings and runtime RLS reads",async t=>fixture(async f=>{
    await sqlClient`insert into alerts(building_id,severity,type,message,created_at) select ${f.a},'HIGH','GENERAL','Unrelated history',now()-n*interval '1 day' from generate_series(1,2000) n`;
    const late=randomUUID();
    await sqlClient`insert into alerts(id,building_id,device_id,severity,type,message) values(${late},${f.a},${f.d1},'HIGH','WATER_LOW','Late exact grant')`;
    await sqlClient`update role_bindings set resource_id=${late} where user_id=${f.exact} and resource_type='alert'`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',now())`;
    await sqlClient`analyze alerts`;
    const [permission]=await sqlClient`select active from permissions where key='buildings:read'`;
    const plans: any[]=[];
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const instrumented=postgres(process.env.DATABASE_URL!,{max:1,onnotice:(notice:{message:string})=>{
      const start=notice.message.indexOf('{'); if(start<0) return;
      const plan=JSON.parse(notice.message.slice(start));
      if(plan['Query Text'].includes("SELECT app_has_capability(target_building_id,'alerts:read') OR EXISTS") || plan['Query Text'].includes('target_alert_id ~*') || /FROM "(building_feature_settings|feature_runtime)"/i.test(plan['Query Text'])) plans.push(plan);
    }});
    try {
      await sqlClient`update permissions set active=false where key='buildings:read'`;
      const states=await drizzle(instrumented).transaction(async tx=>{
        await tx.execute(sql`LOAD 'auto_explain'`);
        await tx.execute(sql`SET LOCAL plan_cache_mode=force_generic_plan`);
        await tx.execute(sql`SET LOCAL auto_explain.log_nested_statements=on`);
        await tx.execute(sql`SET LOCAL auto_explain.log_analyze=on`);
        await tx.execute(sql`SET LOCAL auto_explain.log_timing=off`);
        await tx.execute(sql`SET LOCAL auto_explain.log_format=json`);
        await tx.execute(sql`SET LOCAL auto_explain.log_level=notice`);
        await tx.execute(sql`SET LOCAL auto_explain.log_min_duration=0`);
        await tx.execute(sql`SET LOCAL ROLE predioon_app`);
        await tx.execute(sql`select set_config('app.user_id',${f.exact},true)`);
        return readFeatures(tx as unknown as AppTransaction,f.a);
      });
      assert.equal(states.WATER_TANK.enabled,false); assert.ok(states.WATER_TANK.resumedAt);
      await mkdir(new URL('../../../.local/',import.meta.url),{recursive:true});
      await writeFile(new URL('../../../.local/alert-feature-inner-plans.json',import.meta.url),JSON.stringify(plans,null,2));
      const helpers=plans.filter(plan=>plan['Query Text'].includes("SELECT app_has_capability(target_building_id,'alerts:read') OR EXISTS"));
      assert.ok(helpers.length>=2,'capture the feature-state helper from both actual local settings and runtime reads');
      const alertScans:any[]=[];
      function visit(node:any) { if(node['Relation Name']==='alerts' && node['Actual Loops']>0) alertScans.push(node); for(const child of node.Plans??[]) visit(child); }
      for(const helper of helpers) visit(helper.Plan);
      assert.equal(alertScans.length,0,'feature-state authorization must derive exact resources from live grants, never scan alerts by building');
      const points=plans.filter(plan=>plan['Query Text'].includes('target_alert_id ~*'));
      assert.ok(points.length>=2,'capture exact resource consistency lookups from both feature-state reads');
      for(const point of points) visit(point.Plan);
      assert.equal(alertScans.length,points.length);
      assert.ok(alertScans.every(node=>node['Index Name']==='alerts_pkey' && /id =/.test(node['Index Cond']) && node['Actual Rows']===1));
      t.diagnostic(`Actual readFeatures settings/runtime RLS: ${helpers.length} inner feature-state plans, zero alert-history scans, force_generic_plan`);
    } finally { await instrumented.end(); await sqlClient`update permissions set active=${permission.active} where key='buildings:read'`; }
  }));
});
