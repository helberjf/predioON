import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { sqlClient } from "@predioon/db";
import { appDb, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer, login, call } from "./helpers.js";

describe("monitoring capabilities: actual devices and current consumption authority", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
  async function create() {
    const suffix = randomUUID(), org = `023-org-${suffix}`, a = `023-a-${suffix}`, b = `023-b-${suffix}`;
    const d1 = `023-water-${suffix}`, d2 = `023-energy-${suffix}`, pump = `023-pump-${suffix}`, db = `023-foreign-${suffix}`, ga = `023-ga-${suffix}`, gb = `023-gb-${suffix}`;
    const admin = `023-admin-${suffix}`, worker = `023-worker-${suffix}`, scoped = `023-scoped-${suffix}`, gateway = `023-gateway-${suffix}`, resident = `023-resident-${suffix}`, support = `023-support-${suffix}`, platform = `023-platform-${suffix}`, manager = `023-manager-${suffix}`;
    const ids = [admin,worker,scoped,gateway,resident,support,platform,manager];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Monitoring capabilities',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for(const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id+'@monitoring.test'},${id},${passwordHash})`;
    await sqlClient`update users set is_platform_admin=true where id=${platform}`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${ga},${a},'A',${ga}),(${gb},${b},'B',${gb})`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${d1},${a},${ga},'Water','WATER_LEVEL_SENSOR','{"secret":"private"}'),(${d2},${a},null,'Energy','ENERGY_METER','{}'),(${pump},${a},null,'Pump','PUMP_MONITOR','{}'),(${db},${b},${gb},'Foreign','ENERGY_METER','{}')`;
    const p1 = randomUUID(), p2 = randomUUID(), pp = randomUUID(), pb = randomUUID();
    await sqlClient`insert into monitoring_profiles(id,building_id,device_id,kind,tariff) values(${p1},${a},${d1},'WATER',2),(${p2},${a},${d2},'ENERGY',3),(${pp},${a},${pump},'PUMP',null),(${pb},${b},${db},'ENERGY',99)`;
    for(const [profile,building] of [[p1,a],[p2,a],[pp,a],[pb,b]]) {
      await sqlClient`insert into daily_usage(profile_id,building_id,day,quantity,estimated_cost,covered_seconds,first_at,last_at) values(${profile},${building},'2026-10-01',5,10,60,now(),now())`;
      await sqlClient`insert into usage_cursors(profile_id,building_id,last_at,last_value,good) values(${profile},${building},now(),5,true)`;
    }
    const team = randomUUID(), teamBinding = randomUUID(), adminBinding = randomUUID(), scopedBinding = randomUUID(), supportBinding = randomUUID(), grant = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Monitoring team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${scopedBinding},${scoped},${a},'BUILDING_ADMIN','device',${d1}),(${randomUUID()},${gateway},${a},'BUILDING_ADMIN','gateway',${ga})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${adminBinding},${admin},${a},'BUILDING_ADMIN'),(${randomUUID()},${manager},${a},'MAINTENANCE_MANAGER')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${admin},${b},'RESIDENT'),(${resident},${a},'RESIDENT')`;
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${a},${support},'telemetry:read','device',${d1},'Consumption diagnostic',now()+interval '1 hour',${platform})`;
    const tokens = new Map<string,string>();
    for(const id of ids) tokens.set(id,(await login(server.url,id+'@monitoring.test')).accessToken);
    const request = (user: string, path: string, method='GET', body?: unknown) => call(server.url,path,{token:tokens.get(user),method,body});
    return {org,a,b,d1,d2,pump,db,ga,gb,p1,p2,pp,pb,admin,worker,scoped,gateway,resident,support,platform,manager,ids,team,teamBinding,adminBinding,scopedBinding,supportBinding,grant,request};
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture)=>Promise<void>) {
    const f=await create();
    try { await run(f); }
    finally {
      await sqlClient`delete from audit_logs where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function status(response: Response, expected: number) { assert.equal(response.status,expected,await response.clone().text()); }
  async function items(response: Response) { await status(response,200); return (await response.json()).items as any[]; }
  const read = (f: Fixture,user: string,building=f.a) => f.request(user,`/monitoring?buildingId=${building}&day=2026-10-01`);
  const raw = (user: string,table:'monitoring_profiles'|'daily_usage'|'usage_cursors') => as(user,tx=>tx.execute(sql`select * from ${sql.identifier(table)}`));

  // JSON preserves every column, while the explicit text timestamp retains
  // PostgreSQL microseconds when an existing role_permission must be restored.
  async function catalog(run: ()=>Promise<void>) {
    const permissions=await sqlClient`select to_jsonb(p)||jsonb_build_object('created_at',p.created_at::text) as row from permissions p`;
    const roles=await sqlClient`select to_jsonb(r)||jsonb_build_object('created_at',r.created_at::text) as row from roles r`;
    const rolePermissions=await sqlClient`select to_jsonb(rp)||jsonb_build_object('created_at',rp.created_at::text) as row from role_permissions rp`;
    try { await run(); }
    finally {
      const restored=await Promise.allSettled([
        sqlClient.begin(async tx=>{for(const {row} of permissions) await tx`insert into permissions ${tx(row)} on conflict(key) do update set ${tx(row)}`;}),
        sqlClient.begin(async tx=>{for(const {row} of roles) await tx`insert into roles ${tx(row)} on conflict(key) do update set ${tx(row)}`;}),
        sqlClient.begin(async tx=>{for(const {row} of rolePermissions) await tx`insert into role_permissions ${tx(row)} on conflict(role_key,permission_key) do update set ${tx(row)}`;}),
      ]);
      for(const result of restored) if(result.status==='rejected') throw result.reason;
    }
  }

  it("reads direct, team and manager consumption without legacy membership",async()=>fixture(async f=>{
    for(const u of [f.admin,f.worker,f.manager]) {
      assert.deepEqual(new Set((await items(await read(f,u))).map(r=>r.id)),new Set([f.p1,f.p2,f.pp]));
      for(const table of ['monitoring_profiles','daily_usage','usage_cursors'] as const) assert.equal((await raw(u,table)).length,3);
      await status(await read(f,u,f.b),403);
    }
  }));
  it("preserves database kind and name ordering including accented device names",async()=>fixture(async f=>{
    await sqlClient`update devices set name='Árvore' where id=${f.d1}`;
    await sqlClient`update devices set name='Zebra' where id=${f.pump}`;
    await sqlClient`insert into monitoring_profiles(building_id,device_id,kind) values(${f.a},${f.pump},'WATER')`;
    const expected=await sqlClient`select p.id,d.name from monitoring_profiles p join devices d on d.id=p.device_id where p.building_id=${f.a} order by p.kind,d.name`;
    assert.deepEqual((await items(await read(f,f.admin))).map(r=>({id:r.id,name:r.deviceName})),expected.map(r=>({id:r.id,name:r.name})));
  }));
  it("isolates exact-device grants and read-only support with no inventory permission",async()=>fixture(async f=>{
    for(const u of [f.scoped,f.support]) {
      const rows=await items(await read(f,u)); assert.deepEqual(rows.map(r=>r.id),[f.p1]);
      assert.equal(rows[0].deviceName,'Water'); assert.equal(rows[0].today.estimatedCost,10);
      assert.equal(rows[0].metadata,undefined); assert.equal(rows[0].gatewayId,undefined); assert.equal(rows[0].hardwareAddress,undefined);
      for(const table of ['monitoring_profiles','daily_usage','usage_cursors'] as const) assert.equal((await raw(u,table)).length,1);
    }
    await status(await f.request(f.support,`/devices?buildingId=${f.a}`),403);
    await status(await f.request(f.support,`/monitoring/${f.p1}`,'PATCH',{tariff:1}),403);
    for(const u of [f.worker,f.manager]) await status(await f.request(u,`/monitoring/${f.p1}`,'PATCH',{tariff:1}),403);
  }));
  it("denies publication, gateway, global flag and forged app.role private authority",async()=>fixture(async f=>{
    for(const u of [f.resident,f.gateway,f.platform]) {
      await status(await read(f,u),403);
      for(const table of ['monitoring_profiles','daily_usage','usage_cursors'] as const) assert.equal((await raw(u,table)).length,0);
    }
    await status(await f.request(f.admin,`/monitoring/${f.pb}`,'PATCH',{tariff:1}),404);
  }));
  it("creates profiles on existing exact-device scope and keeps identity immutable",async()=>fixture(async f=>{
    await sqlClient`delete from monitoring_profiles where id=${f.p1}`;
    const response=await f.request(f.scoped,'/monitoring','POST',{buildingId:f.a,deviceId:f.d1,kind:'WATER',tariff:4});
    await status(response,201); const row=await response.json(); assert.ok(row.id);
    await status(await f.request(f.scoped,'/monitoring','POST',{buildingId:f.a,deviceId:f.d1,kind:'WATER'}),409);
    await status(await f.request(f.scoped,`/monitoring/${row.id}`,'PATCH',{tariff:5}),200);
    for(const mutation of [sql`update monitoring_profiles set building_id=${f.b} where id=${row.id}`,sql`update monitoring_profiles set device_id=${f.db} where id=${row.id}`,sql`update monitoring_profiles set id=gen_random_uuid() where id=${row.id}`,sql`update monitoring_profiles set kind='ENERGY' where id=${row.id}`,sql`delete from monitoring_profiles where id=${row.id}`]) await assert.rejects(as(f.scoped,tx=>tx.execute(mutation)));
    for(const table of ['daily_usage','usage_cursors'] as const) await assert.rejects(as(f.admin,tx=>tx.execute(sql`delete from ${sql.identifier(table)}`)));
    const audits=await sqlClient`select action,actor_type,user_id,resource_id from audit_logs where building_id=${f.a}`;
    assert.deepEqual(audits.map(r=>r.action),['MONITORING_CREATED','MONITORING_UPDATED']); assert.ok(audits.every(r=>r.actor_type==='USER'&&r.user_id===f.scoped&&r.resource_id===row.id));
  }));
  it("hides owner-inconsistent profile, gateway and derivative tenant references",async()=>fixture(async f=>{
    await sqlClient`update monitoring_profiles set building_id=${f.b} where id=${f.p1}`;
    await sqlClient`update devices set gateway_id=${f.gb} where id=${f.d2}`;
    await sqlClient`update daily_usage set building_id=${f.b} where profile_id=${f.pp}`;
    await sqlClient`update usage_cursors set building_id=${f.b} where profile_id=${f.pp}`;
    assert.deepEqual((await items(await read(f,f.admin))).map(r=>r.id),[f.pp]);
    assert.equal((await raw(f.admin,'daily_usage')).length,0); assert.equal((await raw(f.admin,'usage_cursors')).length,0);
    const [invalid]=await as(f.admin,tx=>tx.execute(sql`select app_monitoring_profile_has_capability(${f.a},'invalid','telemetry:read') as allowed`)); assert.equal(invalid.allowed,false);
  }));

  it("requires telemetry independently of inventory, configuration and building discovery",async()=>fixture(async f=>catalog(async()=>{
    await sqlClient`delete from role_permissions where role_key='BUILDING_ADMIN' and permission_key='telemetry:read'`;
    await status(await f.request(f.admin,`/devices?buildingId=${f.a}`),200);
    await status(await read(f,f.admin),403);
    assert.equal((await raw(f.admin,'daily_usage')).length,0);
    await status(await f.request(f.admin,'/monitoring','POST',{buildingId:f.a,deviceId:f.d1,kind:'ENERGY'}),403);
  })));
  it("requires each configuration capability and hides disabled insert while allowing existing disabled edits",async()=>fixture(async f=>catalog(async()=>{
    for(const capability of ['devices:read','devices:configure']) {
      await sqlClient`update permissions set active=false where key=${capability}`;
      assert.equal((await items(await read(f,f.admin))).length,3);
      await status(await f.request(f.admin,`/monitoring/${f.p1}`,'PATCH',{tariff:4}),403);
      assert.equal((await as(f.admin,tx=>tx.execute(sql`update monitoring_profiles set tariff=4 returning id`))).length,0);
      await sqlClient`update permissions set active=true where key=${capability}`;
    }
    await sqlClient`update devices set enabled=false where id=${f.d1}`;
    await status(await f.request(f.scoped,`/monitoring/${f.p1}`,'PATCH',{tariff:4}),200);
    await status(await f.request(f.scoped,'/monitoring','POST',{buildingId:f.a,deviceId:f.d1,kind:'ENERGY'}),400);
  })));
  it("distinguishes authorized empty profiles/devices from wrong resource or invalid tenant scopes",async()=>fixture(async f=>{
    await sqlClient`delete from monitoring_profiles where building_id=${f.a}`;
    assert.deepEqual(await items(await read(f,f.scoped)),[]);
    await sqlClient`delete from devices where building_id=${f.a}`;
    assert.deepEqual(await items(await read(f,f.admin)),[]);
    await status(await read(f,f.scoped),403);
    await sqlClient`update role_bindings set resource_id=${f.db} where id=${f.scopedBinding}`;
    await status(await read(f,f.scoped),403);
  }));
  it("rechecks direct/team/member/support/account/tenant windows on the same JWT",async()=>fixture(async f=>{
    const mutations: Array<[string,()=>Promise<unknown>]> = [
      [f.scoped,()=>sqlClient`update role_bindings set active=false where id=${f.scopedBinding}`],
      [f.scoped,()=>sqlClient`update role_bindings set ends_at=statement_timestamp()-interval '1 second' where id=${f.scopedBinding}`],
      [f.scoped,()=>sqlClient`update role_bindings set starts_at=statement_timestamp()+interval '1 hour' where id=${f.scopedBinding}`],
      [f.worker,()=>sqlClient`update role_bindings set active=false where id=${f.teamBinding}`],
      [f.worker,()=>sqlClient`update role_bindings set ends_at=statement_timestamp()-interval '1 second' where id=${f.teamBinding}`],
      [f.worker,()=>sqlClient`update teams set active=false where id=${f.team}`],
      [f.worker,()=>sqlClient`update team_members set active=false where team_id=${f.team}`],
      [f.worker,()=>sqlClient`update team_members set starts_at=statement_timestamp()+interval '1 hour' where team_id=${f.team}`],
      [f.worker,()=>sqlClient`update team_members set ends_at=statement_timestamp()-interval '1 second' where team_id=${f.team}`],
      [f.support,()=>sqlClient`update support_grants set revoked_at=clock_timestamp() where id=${f.grant}`],
      [f.support,()=>sqlClient`update support_grants set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=${f.grant}`],
      [f.support,()=>sqlClient`update role_bindings set active=false where id=${f.supportBinding}`],
      [f.worker,()=>sqlClient`update buildings set active=false where id=${f.a}`],
      [f.worker,()=>sqlClient`update organizations set active=false where id=${f.org}`],
    ];
    for(const [user,mutate] of mutations) {
      await mutate(); await status(await read(f,user),403);
      for(const table of ['monitoring_profiles','daily_usage','usage_cursors'] as const) assert.equal((await raw(user,table)).length,0);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id in ${sqlClient([f.scopedBinding,f.teamBinding,f.supportBinding])}`;
      await sqlClient`update teams set active=true where id=${f.team}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
      await sqlClient`update support_grants set revoked_at=null,created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 hour' where id=${f.grant}`;
      await sqlClient`update buildings set active=true where id=${f.a}`; await sqlClient`update organizations set active=true where id=${f.org}`;
      await status(await read(f,user),200);
    }
    await sqlClient`update users set active=false where id=${f.scoped}`;
    assert.ok([401,403].includes((await read(f,f.scoped)).status)); assert.equal((await raw(f.scoped,'monitoring_profiles')).length,0);
  }));
  it("rechecks role, telemetry permission and legacy membership deactivation",async()=>fixture(async f=>catalog(async()=>{
    for(const table of ['roles','permissions'] as const) {
      const key=table==='roles'?'BUILDING_ADMIN':'telemetry:read';
      await sqlClient`update ${sqlClient(table)} set active=false where key=${key}`;
      await status(await read(f,f.scoped),403); assert.equal((await raw(f.scoped,'monitoring_profiles')).length,0);
      await sqlClient`update ${sqlClient(table)} set active=true where key=${key}`;
    }
    await sqlClient`update roles set active=false where key='PLATFORM_SUPPORT'`;
    await status(await read(f,f.support),403);assert.equal((await raw(f.support,'daily_usage')).length,0);
    await sqlClient`update roles set active=true where key='PLATFORM_SUPPORT'`;
    await sqlClient`delete from role_bindings where id=${f.adminBinding}`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${f.admin},${f.a},'BUILDING_ADMIN')`;
    await status(await read(f,f.admin),200);
    for(const mutate of [()=>sqlClient`update memberships set active=false where user_id=${f.admin} and building_id=${f.a}`,()=>sqlClient`update memberships set ends_at=clock_timestamp()-interval '1 second' where user_id=${f.admin} and building_id=${f.a}`]) {
      await mutate(); await status(await read(f,f.admin),403);
      await sqlClient`update memberships set active=true,ends_at=null where user_id=${f.admin} and building_id=${f.a}`;
    }
  })));
  it("enforces feature pauses with governance capabilities independently revoked and preserves paused AI config",async()=>fixture(async f=>catalog(async()=>{
    await sqlClient`update permissions set active=false where key in ('buildings:read','buildings:manage')`;
    await sqlClient`update monitoring_profiles set adaptive_enabled=true,minimum_history_days=12,deviation_percent=75 where id=${f.p1}`;
    for(const [feature,profile] of [['WATER_CONSUMPTION',f.p1],['ENERGY_CONSUMPTION',f.p2],['PUMP',f.pp]]) {
      await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},${feature},false) on conflict(building_id,feature_key) do update set enabled=false`;
      assert.ok((await items(await read(f,f.admin))).every(r=>r.id!==profile));
      await status(await f.request(f.admin,`/monitoring/${profile}`,'PATCH',{dailyLimit:6}),403);
      await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key=${feature}`;
    }
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'AI_ANALYSIS',false)`;
    const water=(await items(await read(f,f.support)))[0]; assert.equal(water.adaptiveEnabled,false); assert.equal(water.reference,null); assert.equal(water.analysisStatus,'DISABLED');
    await status(await f.request(f.scoped,`/monitoring/${f.p1}`,'PATCH',{tariff:7}),200);
    await status(await f.request(f.scoped,`/monitoring/${f.p1}`,'PATCH',{adaptiveEnabled:false}),403);
    const [stored]=await sqlClient`select adaptive_enabled,minimum_history_days,deviation_percent from monitoring_profiles where id=${f.p1}`;
    assert.deepEqual({...stored},{adaptive_enabled:true,minimum_history_days:12,deviation_percent:75});
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_CONSUMPTION',clock_timestamp())`;
    const resumed=(await items(await read(f,f.support)))[0]; assert.equal(resumed.fresh,false); assert.equal(resumed.lastReadingAt,null);
  })));
  it("keeps PATCH omitted fields, kind limits and inaccessible UUID behavior",async()=>fixture(async f=>{
    await sqlClient`update monitoring_profiles set max_gap_seconds=777,minimum_history_days=14,deviation_percent=125,adaptive_enabled=false where id=${f.p1}`;
    const response=await f.request(f.scoped,`/monitoring/${f.p1}`,'PATCH',{tariff:4}); await status(response,200); const row=await response.json();
    assert.equal(row.maxGapSeconds,777); assert.equal(row.minimumHistoryDays,14); assert.equal(row.deviationPercent,125); assert.equal(row.adaptiveEnabled,false);
    for(const [profile,body] of [[f.p1,{continuousLimitMinutes:5}],[f.pp,{tariff:5}],[f.pp,{dailyCostLimit:5}],[f.p1,{deviceId:f.db}],[f.p1,{kind:'PUMP'}]]) await status(await f.request(f.admin,`/monitoring/${profile}`,'PATCH',body),400);
    for(const id of ['invalid',randomUUID(),f.pb]) await status(await f.request(f.admin,`/monitoring/${id}`,'PATCH',{tariff:5}),404);
  }));
  it("rolls profile writes back when atomic audit policy rejects them",async()=>fixture(async f=>{
    const policy=`monitoring_023_${randomUUID().replaceAll('-','')}`;
    await sqlClient.unsafe(`create policy ${policy} on audit_logs as restrictive for insert to predioon_app with check (building_id <> '${f.a}')`);
    try {
      await status(await f.request(f.scoped,`/monitoring/${f.p1}`,'PATCH',{tariff:100}),403);
      await status(await f.request(f.scoped,'/monitoring','POST',{buildingId:f.a,deviceId:f.d1,kind:'ENERGY'}),403);
      const [stored]=await sqlClient`select tariff from monitoring_profiles where id=${f.p1}`; assert.equal(stored.tariff,2);
      assert.equal((await sqlClient`select id from monitoring_profiles where device_id=${f.d1} and kind='ENERGY'`).length,0);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    } finally { await sqlClient.unsafe(`drop policy ${policy} on audit_logs`); }
  }));

  // Only delay real query delivery. Every authorization and row value is read
  // from PostgreSQL; this exercises expiration after cached history/cursors.
  async function afterCursorRead(run:()=>Promise<void>,delay:()=>Promise<void>) {
    const original=appDb.transaction;
    let delayed=false;
    function builder(target:any):any {
      return new Proxy(target,{get(object,key) {
        const value=Reflect.get(object,key);
        if(key==='then') return (resolve:any,reject:any)=>object.then(async(rows:any)=>{
          if(!delayed&&object.toSQL().sql.includes('usage_cursors')) { delayed=true; await delay(); }
          return resolve(rows);
        },reject);
        if(typeof value==='function') return (...args:any[])=>{const result=value.apply(object,args); return result&&typeof result==='object'&&('from' in result||'toSQL' in result)?builder(result):result;};
        return value;
      }});
    }
    appDb.transaction=((callback:any,...options:any[])=>original.call(appDb,(tx:any)=>callback(new Proxy(tx,{get(target,key,receiver){
      if(key==='select') return (...args:any[])=>builder(target.select(...args));
      return Reflect.get(target,key,receiver);
    }})),...options)) as typeof appDb.transaction;
    try { await run(); assert.equal(delayed,true,'real cursor query was delayed'); }
    finally { appDb.transaction=original; }
  }
  it("drops cached profiles when exact support scope expires between history and final DTO",async()=>fixture(async f=>{
    await afterCursorRead(async()=>status(await read(f,f.support),403),async()=>{
      await sqlClient`update support_grants set expires_at=clock_timestamp()+interval '50 milliseconds' where id=${f.grant}`;
      await sqlClient`select pg_sleep(0.1)`;
    });
  }));
  it("drops only revoked cached items while another real device remains authorized",async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.admin},${f.a},'MAINTENANCE','device',${f.d2})`;
    await afterCursorRead(async()=>assert.deepEqual((await items(await read(f,f.admin))).map(r=>r.id),[f.p2]),async()=>{
      await sqlClient`update role_bindings set active=false where id=${f.adminBinding}`;
    });
  }));

  async function locked<T>(f:Fixture,start:()=>Promise<T>,during:()=>Promise<void>):Promise<T> {
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const client=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2});
    let release!:()=>void,ready!:(pid:number)=>void,rejectReady!:(error:unknown)=>void;
    const held=new Promise<void>(r=>{release=r;}),acquired=new Promise<number>((resolve,reject)=>{ready=resolve;rejectReady=reject;});
    let timer:ReturnType<typeof setTimeout>|undefined,acquiredSuccessfully=false,failure:unknown,result:T|undefined;
    let blockerDone:Promise<PromiseSettledResult<unknown>[]>|undefined,pendingDone:Promise<PromiseSettledResult<T>[]>|undefined;
    try {
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Monitoring blocker acquisition exceeded 5 seconds')),5000);});
      const blocker=client.begin(async owner=>{
        await owner`set local lock_timeout='2s'`; await owner`set local statement_timeout='3s'`;
        await owner`select id from monitoring_profiles where id=${f.p1} for update`;
        const [r]=await owner`select pg_backend_pid() as pid`; ready(r.pid); await held;
      });
      blockerDone=Promise.allSettled([blocker]);
      void blockerDone.then(([outcome])=>{if(outcome.status==='rejected') rejectReady(outcome.reason);});
      const pid=await Promise.race([acquired,deadline]); acquiredSuccessfully=true; clearTimeout(timer);
      pendingDone=Promise.allSettled([Promise.resolve().then(start)]);
      let waiting=false;
      for(let i=0;i<250;i++) {
        const [row]=await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app'
          and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))
          and exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted)) as waiting`;
        if(row.waiting) { waiting=true;break; } await new Promise(r=>setTimeout(r,20));
      }
      assert.equal(waiting,true,'authorized PATCH really waits on the fixture row lock'); await during();
    } catch(error) { failure=error; }
    finally {
      clearTimeout(timer);release();
      const forced=acquiredSuccessfully?[]:await Promise.allSettled([client.end({timeout:0})]);
      const [blocker,pending]=await Promise.all([blockerDone??Promise.resolve([]),pendingDone??Promise.resolve([])]);
      const closed=await Promise.allSettled([client.end({timeout:1})]);
      for(const outcome of [...blocker,...pending,...forced,...closed]) if(outcome.status==='rejected'&&failure===undefined) failure=outcome.reason;
      if(pending[0]?.status==='fulfilled') result=pending[0].value;
    }
    if(failure!==undefined) throw failure; return result as T;
  }
  for(const subject of ['direct','team','member'] as const) for(const change of ['revoke','expire'] as const) {
    it(`rechecks ${subject} ${change} after an observed row wait without mutation or audit`,async()=>fixture(async f=>{
      const user=subject==='direct'?f.scoped:f.worker;
      if(subject!=='direct') await sqlClient`update role_bindings set role_key='BUILDING_ADMIN',resource_type='device',resource_id=${f.d1} where id=${f.teamBinding}`;
      const response=await locked(f,()=>f.request(user,`/monitoring/${f.p1}`,'PATCH',{tariff:100}),async()=>{
        const table=subject==='member'?'team_members':'role_bindings';
        if(table==='team_members') {
          if(change==='revoke') await sqlClient`update team_members set active=false where team_id=${f.team}`;
          else await sqlClient`update team_members set ends_at=clock_timestamp()+interval '50 milliseconds' where team_id=${f.team}`;
        } else {
          const id=subject==='direct'?f.scopedBinding:f.teamBinding;
          if(change==='revoke') await sqlClient`update role_bindings set active=false where id=${id}`;
          else await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '50 milliseconds' where id=${id}`;
        }
        if(change==='expire') await sqlClient`select pg_sleep(0.1)`;
      });
      await status(response,403);
      const [stored]=await sqlClient`select tariff from monitoring_profiles where id=${f.p1}`; assert.equal(stored.tariff,2);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    }));
  }
  it("denies support PATCH before locking even while another owner holds the profile",async()=>fixture(async f=>{
    await sqlClient.begin(async owner=>{
      await owner`set local statement_timeout='3s'`; await owner`select id from monitoring_profiles where id=${f.p1} for update`;
      let timer:ReturnType<typeof setTimeout>;
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Read-only support attempted a row lock')),2000);});
      const pending=Promise.allSettled([f.request(f.support,`/monitoring/${f.p1}`,'PATCH',{tariff:100})]);
      try { const [outcome]=await Promise.race([pending,timeout]); if(outcome.status==='rejected') throw outcome.reason; await status(outcome.value,403); }
      finally { clearTimeout(timer!); }
    });
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
  }));
  it("exposes stable minimal projections only to app and retains the private relationship helper",async()=>fixture(async f=>{
    const signatures=['app_monitoring_device_has_capability(text,text,text)','app_monitoring_profile_has_capability(text,text,text)','app_monitoring_authorized_profiles(text)','app_monitoring_can_read_scope(text)','app_monitoring_scope_context(text)','app_monitoring_active_device(text,text)'];
    for(const signature of signatures) {
      const [row]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=base.proowner as same_owner,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,
        has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0) as public
        from pg_proc p cross join pg_proc base where p.oid=${signature}::regprocedure and base.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(row.prosecdef,true);assert.equal(row.provolatile,'s');assert.equal(row.same_owner,true);assert.deepEqual(row.proconfig,['search_path=public, pg_temp']);
      assert.equal(row.app,true);assert.equal(row.identity,false);assert.equal(row.broker,false);assert.equal(row.public,false);
    }
    await assert.rejects(as(f.admin,tx=>tx.execute(sql`select app_equipment_gateway_belongs(${f.a},${f.ga})`)));
    const projected=await as(f.support,tx=>tx.execute(sql`select * from app_monitoring_authorized_profiles(${f.a})`));
    assert.deepEqual(Object.keys(projected[0]).sort(),['profile_id','building_id','device_id','device_name','device_type','device_enabled','device_status','timezone'].sort());
    for(const capability of ['devices:configure','alerts:read','telemetry:read-published','invented']) {
      const [row]=await as(f.support,tx=>tx.execute(sql`select app_monitoring_profile_has_capability(${f.a},${f.p1},${capability}) as allowed`)); assert.equal(row.allowed,false);
    }
    for(const role of ['predioon_app','predioon_identity','predioon_broker_auth']) {
      const [row]=await sqlClient`select has_table_privilege(${role},'daily_usage','INSERT,UPDATE,DELETE') as totals,has_table_privilege(${role},'usage_cursors','INSERT,UPDATE,DELETE') as cursors`;
      assert.equal(row.totals,false);assert.equal(row.cursors,false);
    }
  }));
  it("uses one ordered pair InitPlan for thousands of totals and current profile authority",async()=>fixture(async f=>{
    await sqlClient`insert into daily_usage(profile_id,building_id,day,quantity,first_at,last_at)
      select ${f.p1},${f.a},to_char(date '2020-01-01'+n,'YYYY-MM-DD'),n,now(),now() from generate_series(1,1000) n`;
    await sqlClient`insert into daily_usage(profile_id,building_id,day,quantity,first_at,last_at) values(${f.p1},${f.b},'wrong-own-pair',999,now(),now()),(${f.pb},${f.a},'reversed-foreign-pair',999,now(),now())`;
    await sqlClient`update usage_cursors set building_id=${f.a} where profile_id=${f.pb}`;
    type Node={Plans?:Node[];[key:string]:unknown};
    const nodes=(node:Node):Node[]=>[node,...(node.Plans??[]).flatMap(nodes)];
    const summaries=[];
    for(const table of ['daily_usage','usage_cursors'] as const) {
      const rows=await raw(f.scoped,table);assert.equal(rows.length,table==='daily_usage'?1001:1);assert.ok(rows.every(r=>r.profile_id===f.p1&&r.building_id===f.a));
      const [explained]=await as(f.scoped,tx=>tx.execute(sql`explain(analyze,format json) select * from ${sql.identifier(table)}`));
      const plan=(explained['QUERY PLAN'] as Array<{Plan:Node}>)[0].Plan;
      const scans=nodes(plan).filter(n=>n['Function Name']==='app_monitoring_authorized_profiles');
      assert.equal(scans.length,1);assert.equal(scans[0]['Actual Loops'],1);assert.equal(scans[0]['Actual Rows'],1);
      const init=nodes(plan).find(n=>String(n['Subplan Name']).startsWith('InitPlan'));assert.ok(init);
      assert.equal(nodes(init).filter(n=>['daily_usage','usage_cursors'].includes(String(n['Relation Name']))).length,0);
      summaries.push({table,plan});
    }
    await mkdir(new URL('../../../.local/',import.meta.url),{recursive:true});
    await writeFile(new URL('../../../.local/023-monitoring-history-plans.json',import.meta.url),JSON.stringify(summaries,null,2));
  }));
  it("uses the actual owner point helper primary key plan without forced planner settings",async t=>fixture(async f=>{
    await sqlClient`insert into devices(id,building_id,name,type) select ${f.org}||'-large-'||n,${f.b},'Unrelated','SENSOR' from generate_series(1,600) n`;
    await sqlClient`insert into monitoring_profiles(building_id,device_id,kind) select ${f.b},id,'ENERGY' from devices where building_id=${f.b} and id<>${f.db}`;
    await sqlClient`analyze monitoring_profiles`;await sqlClient`analyze devices`;
    type Node={Plans?:Node[];[key:string]:unknown};type Plan={'Query Text':string;Plan:Node};
    const plans:Plan[]=[];
    const require=createRequire(import.meta.url),postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const instrumented=postgres(process.env.DATABASE_URL!,{max:1,onnotice:(notice:{message:string})=>{
      const start=notice.message.indexOf('{');if(start<0)return;
      const captured=JSON.parse(notice.message.slice(start)) as Plan;
      if(captured['Query Text'].includes('WHERE p.id=CASE WHEN target_profile_id')||captured['Query Text'].includes('JOIN monitoring_profiles p ON p.device_id')) plans.push(captured);
    }});
    try {
      await drizzle(instrumented).transaction(async tx=>{
        await tx.execute(sql`load 'auto_explain'`);await tx.execute(sql`set local auto_explain.log_nested_statements=on`);
        await tx.execute(sql`set local auto_explain.log_analyze=on`);await tx.execute(sql`set local auto_explain.log_timing=off`);
        await tx.execute(sql`set local auto_explain.log_format=json`);await tx.execute(sql`set local auto_explain.log_level=notice`);await tx.execute(sql`set local auto_explain.log_min_duration=0`);
        await tx.execute(sql`set local role predioon_app`);await tx.execute(sql`select set_config('app.user_id',${f.scoped},true)`);
        const [row]=await tx.execute(sql`select app_monitoring_profile_has_capability(${f.a},${f.p1},'telemetry:read') as allowed`);assert.equal(row.allowed,true);
        await tx.execute(sql`select * from app_monitoring_authorized_profiles(${f.a})`);
      });
      const nodes=(node:Node):Node[]=>[node,...(node.Plans??[]).flatMap(nodes)];
      const points=plans.filter(plan=>plan['Query Text'].includes('WHERE p.id=CASE WHEN target_profile_id'));assert.ok(points.length);
      for(const plan of points) {
        const scans=nodes(plan.Plan).filter(n=>n['Relation Name']==='monitoring_profiles'&&Number(n['Actual Loops'])>0);
        assert.equal(scans.length,1);assert.equal(scans[0]['Index Name'],'monitoring_profiles_pkey');assert.match(String(scans[0]['Index Cond']),/id =/);assert.equal(scans[0]['Actual Rows'],1);
      }
      assert.ok(plans.some(plan=>plan['Query Text'].includes('JOIN monitoring_profiles p ON p.device_id')));
      for(const plan of plans) assert.equal(nodes(plan.Plan).filter(n=>['daily_usage','usage_cursors','telemetry','alerts'].includes(String(n['Relation Name']))&&Number(n['Actual Loops'])>0).length,0);
      await writeFile(new URL('../../../.local/023-monitoring-owner-plans.json',import.meta.url),JSON.stringify(plans,null,2));
      t.diagnostic(`Actual owner plans: ${points.length} primary-key point scans, no history authority scans`);
    } finally {await instrumented.end();}
  }));
});
