import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { decodeJwt } from "jose";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { sqlClient } from "@predioon/db";
import { closeAppDb, lockFeatures, readFeatures, withUserContext, type AppTransaction } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { startRealtimeBus } from "../src/modules/events/bus.js";
import { projectDeviceStatusEvent } from "../src/modules/events/equipment.js";
import { login, startTestServer } from "./helpers.js";

describe("022 live equipment status and feature invalidation capabilities", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); await startRealtimeBus(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({userId,role:'PLATFORM_ADMIN'},run);
  async function create() {
    const suffix = randomUUID(), prefix = `022-${suffix}`, org = `${prefix}-org`, a = `${prefix}-a`, b = `${prefix}-b`;
    const d1 = `${prefix}-water`, d2 = `${prefix}-energy`, db = `${prefix}-foreign`, ga = `${prefix}-gw`, gb = `${prefix}-gwb`;
    const direct = `${prefix}-direct`, worker = `${prefix}-worker`, scoped = `${prefix}-device`, gateway = `${prefix}-gateway`;
    const support = `${prefix}-support`, resident = `${prefix}-resident`, legacy = `${prefix}-legacy`, platform = `${prefix}-platform`, flag = `${prefix}-flag`, outsider = `${prefix}-outsider`;
    const ids = [direct,worker,scoped,gateway,support,resident,legacy,platform,flag,outsider];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'022 equipment SSE',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash,is_platform_admin) values(${id},${id+'@022.test'},${id},${passwordHash},${id===flag})`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number,status,metadata) values(${ga},${a},'A',${ga},'ONLINE','{"secret":"gateway"}'),(${gb},${b},'B',${gb},'OFFLINE','{}')`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,status,metadata) values(${d1},${a},${ga},'Water','WATER_LEVEL_SENSOR','ONLINE','{"secret":"device"}'),(${d2},${a},null,'Energy','ENERGY_METER','OFFLINE','{}'),(${db},${b},${gb},'Foreign','WATER_LEVEL_SENSOR','OFFLINE','{}')`;
    const team = randomUUID(), teamBinding = randomUUID(), directBinding = randomUUID(), scopedBinding = randomUUID(), gatewayBinding = randomUUID(), supportBinding = randomUUID(), membership = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'022 maintenance')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${directBinding},${direct},${a},'MAINTENANCE'),(${randomUUID()},${resident},${a},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${scopedBinding},${scoped},${a},'MAINTENANCE','device',${d1}),(${gatewayBinding},${gateway},${a},'MAINTENANCE','gateway',${ga})`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into memberships(id,user_id,building_id,role) values(${membership},${legacy},${a},'BUILDING_ADMIN')`;
    const tokens = new Map<string,string>();
    for (const id of ids) tokens.set(id,(await login(server.url,id+'@022.test')).accessToken);
    const device = (extra: Record<string,unknown> = {}) => ({kind:'device-status',buildingId:a,deviceId:d1,status:'ONLINE',...extra});
    const gw = (extra: Record<string,unknown> = {}) => ({kind:'gateway-status',buildingId:a,gatewayId:ga,status:'ONLINE',...extra});
    const marker = (buildingId = a) => ({kind:'features-changed',buildingId});
    return {org,a,b,d1,d2,db,ga,gb,ids,direct,worker,scoped,gateway,support,resident,legacy,platform,flag,outsider,team,teamBinding,directBinding,scopedBinding,gatewayBinding,supportBinding,membership,tokens,device,gw,marker};
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); }
    finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
      await sqlClient`delete from gates where building_id in ${sqlClient([f.a,f.b])}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function stream<T>(f: Fixture, user: string, run: (s: { batch: (events: Record<string,unknown>[]) => Promise<Record<string,unknown>[]>; reader: ReadableStreamDefaultReader<Uint8Array>; marker: () => Promise<Record<string,unknown>> }) => Promise<T>, queryToken = false, timeoutMs = 20_000): Promise<T> {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const token = f.tokens.get(user)!;
      const response = await fetch(`${server.url}/events/stream${queryToken?'?access_token='+encodeURIComponent(token):''}`,{headers:queryToken?{}:{Authorization:`Bearer ${token}`},signal:controller.signal});
      assert.equal(response.status,200);
      reader = response.body!.getReader();
      const decoder = new TextDecoder(); let pending = '';
      async function frame(): Promise<string> {
        while (!pending.includes('\n\n')) {
          const next = await reader!.read(); assert.equal(next.done,false,'SSE closed before bounded marker');
          pending += decoder.decode(next.value,{stream:true});
        }
        const end = pending.indexOf('\n\n'), next = pending.slice(0,end); pending = pending.slice(end+2); return next;
      }
      assert.equal(await frame(),'retry: 5000');
      async function nextEvent() {
        for (;;) { const data = (await frame()).split('\n').find(line=>line.startsWith('data: ')); if (data) return JSON.parse(data.slice(6)) as Record<string,unknown>; }
      }
      async function marker() {
        await sqlClient`select pg_notify('predioon_events',${JSON.stringify({...f.marker('*'),metadata:'private',status:'forged'})})`;
        return nextEvent();
      }
      async function batch(events: Record<string,unknown>[]) {
        for (const event of events) await sqlClient`select pg_notify('predioon_events',${JSON.stringify(event)})`;
        await sqlClient`select pg_notify('predioon_events',${JSON.stringify(f.marker('*'))})`;
        const result: Record<string,unknown>[] = [];
        for (;;) { const event = await nextEvent(); if (event.kind==='features-changed' && event.buildingId==='*') return result; result.push(event); }
      }
      return await run({batch,reader,marker});
    } finally { clearTimeout(timer); controller.abort(); await reader?.cancel().catch(()=>undefined); }
  }
  const events = (f: Fixture) => [f.device(),f.device({deviceId:f.d2,status:'OFFLINE'}),f.gw()];
  const supportGrant = (f: Fixture, resourceType: string | null, resourceId: string | null) => sqlClient`insert into support_grants(building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${f.a},${f.support},'devices:read',${resourceType},${resourceId},'022 diagnosis',clock_timestamp()+interval '1 hour',${f.platform}) returning id`;

  it("delivers persisted statuses for current direct team and legacy grants", async () => fixture(async f => {
    for (const user of [f.direct,f.worker,f.legacy]) await stream(f,user,async s=>assert.deepEqual(await s.batch(events(f)),events(f)),user===f.worker);
  }));
  it("keeps exact device and gateway grants independent and reconstructs only four fields", async () => fixture(async f => {
    await stream(f,f.scoped,async s=>assert.deepEqual(await s.batch([...events(f),f.device({status:'FORGED',hash:'private',configuration:{secret:true},metadata:'private'})]),[f.device(),f.device()]));
    await stream(f,f.gateway,async s=>assert.deepEqual(await s.batch([...events(f),f.gw({status:'FORGED',hash:'private'})]),[f.gw(),f.gw()]));
  }));
  it("denies resident global role global flag and outsiders private status", async () => fixture(async f => {
    for (const user of [f.resident,f.platform,f.flag,f.outsider]) await stream(f,user,async s=>assert.deepEqual(await s.batch(events(f)),[]));
  }));
  it("delivers disabled inventory and current status after changes", async () => fixture(async f => stream(f,f.direct,async s=> {
    await sqlClient`update devices set enabled=false,status='OFFLINE' where id=${f.d1}`;
    await sqlClient`update gateways set enabled=false,status='OFFLINE' where id=${f.ga}`;
    assert.deepEqual(await s.batch([f.device(),f.gw()]),[f.device({status:'OFFLINE'}),f.gw({status:'OFFLINE'})]);
  })));
  it("skips strange TEXT missing foreign and inconsistent IDs without closing the stream", async () => fixture(async f => stream(f,f.direct,async s=> {
    const bad = `022-bad-${randomUUID()}`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type) values(${bad},${f.a},${f.gb},'Divergent','SENSOR')`;
    const odd = ['',"x'::uuid",'not-a-uuid','00000000-0000-0000-0000-000000000000'];
    assert.deepEqual(await s.batch([...odd.flatMap(id=>[f.device({deviceId:id}),f.gw({gatewayId:id})]),f.device({deviceId:bad}),f.device({deviceId:f.db}),f.device({buildingId:f.b}),f.gw({gatewayId:f.gb}),f.gw({buildingId:f.b}),f.device()]),[f.device()]);
  })));
  it("allows each temporary support scope and excludes its next message after revocation", async () => fixture(async f => {
    for (const [type,id,expected] of [[null,null,events(f)],['device',f.d1,[f.device()]],['gateway',f.ga,[f.gw()]]] as const) {
      const [grant] = await supportGrant(f,type,id);
      try { await stream(f,f.support,async s=> {
        assert.deepEqual(await s.batch(events(f)),expected);
        await sqlClient`update support_grants set revoked_at=clock_timestamp() where id=${grant.id}`;
        assert.deepEqual(await s.batch([...events(f),f.marker()]),[]);
      }); } finally { await sqlClient`delete from support_grants where id=${grant.id}`; }
    }
  }));
  it("delivers overlapping whole resource team and support grants once", async () => fixture(async f => {
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${f.team},${f.a},${f.direct})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.direct},${f.a},'MAINTENANCE','device',${f.d1})`;
    await sqlClient`insert into role_bindings(user_id,role_key) values(${f.direct},'PLATFORM_SUPPORT')`;
    await sqlClient`insert into support_grants(building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${f.a},${f.direct},'devices:read','device',${f.d1},'022 overlapping grant',clock_timestamp()+interval '1 hour',${f.platform})`;
    await stream(f,f.direct,async s=>assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.device(),f.marker()]));
  }));
  it("rechecks direct binding revocation start and end windows on the same JWT", async () => fixture(async f => stream(f,f.scoped,async s=> {
    for (const mutate of [()=>sqlClient`update role_bindings set active=false where id=${f.scopedBinding}`,()=>sqlClient`update role_bindings set starts_at=clock_timestamp()+interval '1 hour' where id=${f.scopedBinding}`,()=>sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.scopedBinding}`]) {
      await mutate(); assert.deepEqual(await s.batch([f.device(),f.marker()]),[]);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.scopedBinding}`;
      assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.device(),f.marker()]);
    }
  })));
  it("rechecks team binding team member and membership activity and windows", async () => fixture(async f => {
    await stream(f,f.worker,async s=> {
      for (const mutate of [()=>sqlClient`update role_bindings set active=false where id=${f.teamBinding}`,()=>sqlClient`update role_bindings set starts_at=clock_timestamp()+interval '1 hour' where id=${f.teamBinding}`,()=>sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.teamBinding}`,()=>sqlClient`update teams set active=false where id=${f.team}`,()=>sqlClient`update team_members set active=false where team_id=${f.team}`,()=>sqlClient`update team_members set starts_at=clock_timestamp()+interval '1 hour' where team_id=${f.team}`,()=>sqlClient`update team_members set ends_at=clock_timestamp()-interval '1 second' where team_id=${f.team}`]) {
        await mutate(); assert.deepEqual(await s.batch(events(f)),[]);
        await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.teamBinding}`;
        await sqlClient`update teams set active=true where id=${f.team}`;
        await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
        assert.deepEqual(await s.batch(events(f)),events(f));
      }
    });
    await stream(f,f.legacy,async s=> {
      for (const mutate of [()=>sqlClient`update memberships set active=false where id=${f.membership}`,()=>sqlClient`update memberships set ends_at=clock_timestamp()-interval '1 second' where id=${f.membership}`,()=>sqlClient`update memberships set starts_at=clock_timestamp()+interval '1 hour' where id=${f.membership}`]) {
        await mutate(); assert.deepEqual(await s.batch(events(f)),[]);
        await sqlClient`update memberships set active=true,starts_at=null,ends_at=null where id=${f.membership}`;
        assert.deepEqual(await s.batch(events(f)),events(f));
      }
    });
  }));
  it("rechecks support creation expiry and support role on the same stream", async () => fixture(async f => {
    const [grant] = await supportGrant(f,'device',f.d1);
    await stream(f,f.support,async s=> {
      for (const mutate of [()=>sqlClient`update support_grants set created_at=clock_timestamp()+interval '10 minutes' where id=${grant.id}`,()=>sqlClient`update support_grants set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=${grant.id}`,()=>sqlClient`update role_bindings set active=false where id=${f.supportBinding}`]) {
        await mutate(); assert.deepEqual(await s.batch([f.device(),f.marker()]),[]);
        await sqlClient`update support_grants set created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 hour' where id=${grant.id}`;
        await sqlClient`update role_bindings set active=true where id=${f.supportBinding}`;
        assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.device(),f.marker()]);
      }
    });
  }));
  it("rechecks organization and building activation", async () => fixture(async f => stream(f,f.direct,async s=> {
    for (const table of ['organizations','buildings'] as const) {
      const id = table==='organizations'?f.org:f.a;
      await sqlClient`update ${sqlClient(table)} set active=false where id=${id}`;
      assert.deepEqual(await s.batch(events(f)),[]);
      await sqlClient`update ${sqlClient(table)} set active=true where id=${id}`;
      assert.deepEqual(await s.batch(events(f)),events(f));
    }
  })));
  it("honors water pause resume and mixed device ANY semantics without freshness", async () => fixture(async f => stream(f,f.direct,async s=> {
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false),(${f.a},'ENERGY_CONSUMPTION',false)`;
    assert.deepEqual(await s.batch(events(f)),[f.device({deviceId:f.d2,status:'OFFLINE'}),f.gw()]);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'ELECTRICAL',false)`;
    assert.deepEqual(await s.batch(events(f)),[f.gw()]);
    await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',clock_timestamp()+interval '1 hour')`;
    assert.deepEqual(await s.batch([f.device(),f.gw()]),[f.device(),f.gw()]);
  })));
  it("uses explicit gate and parking classifications only from the actual building", async () => fixture(async f => stream(f,f.direct,async s=> {
    await sqlClient`update devices set type='GATE_CONTROLLER' where id=${f.d1}`;
    await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id) values(${f.a},'Gate','PEDESTRIAN',${f.ga},${f.d1})`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'PEDESTRIAN_ACCESS',false)`;
    assert.deepEqual(await s.batch([f.device()]),[]);
    await sqlClient`update devices set type='GATE_CONTROLLER' where id=${f.db}`;
    await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id) values(${f.b},'Foreign gate','PEDESTRIAN',${f.gb},${f.db})`;
    await sqlClient`update devices set building_id=${f.a},gateway_id=${f.ga} where id=${f.db}`;
    assert.deepEqual(await s.batch([f.device({deviceId:f.db})]),[f.device({deviceId:f.db,status:'OFFLINE'})]);
    await sqlClient`delete from gates where device_id=${f.d1}`;
    await sqlClient`update devices set type='PARKING_SENSOR' where id=${f.d1}`;
    await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity,sensor_id) values(${f.a},'MOTORCYCLE',10,${f.d1})`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'MOTORCYCLE_PARKING',false)`;
    assert.deepEqual(await s.batch([f.device()]),[]);
    await sqlClient`update devices set type='PARKING_SENSOR',building_id=${f.b},gateway_id=${f.gb} where id=${f.db}`;
    await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity,sensor_id) values(${f.b},'MOTORCYCLE',10,${f.db})`;
    await sqlClient`update devices set building_id=${f.a},gateway_id=${f.ga} where id=${f.db}`;
    assert.deepEqual(await s.batch([f.device({deviceId:f.db})]),[f.device({deviceId:f.db,status:'OFFLINE'})]);
  })));
  it("reads equipment-only feature settings and runtime without fail-open defaults", async t => fixture(async f => {
    const removed = await sqlClient`delete from role_permissions where role_key='MAINTENANCE' and permission_key<>'devices:read' returning role_key,permission_key,created_at::text as created_at`;
    try {
      await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
      await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',clock_timestamp())`;
      const states = await as(f.scoped,tx=>readFeatures(tx,f.a));
      assert.equal(states.WATER_TANK.localEnabled,false); assert.ok(states.WATER_TANK.resumedAt);
      for (const user of [f.scoped,f.gateway]) await stream(f,user,async s=>assert.deepEqual(await s.batch([f.device(),f.gw(),f.marker()]),user===f.scoped?[f.marker()]:[f.gw(),f.marker()]));
      await stream(f,f.scoped,async s=> {
        const started = performance.now();
        const [rights] = await as(f.scoped,tx=>tx.execute(sql`select app_device_has_capability(${f.a},${f.d1},'devices:read') as equipment,app_has_capability(${f.a},'buildings:read','device',${f.d1}) as building,app_has_capability(${f.a},'telemetry:read','device',${f.d1}) as telemetry,app_has_capability(${f.a},'alerts:read','device',${f.d1}) as alerts`));
        assert.deepEqual(rights,{equipment:true,building:false,telemetry:false,alerts:false});
        await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'PEDESTRIAN_ACCESS',false),(${f.a},'MOTORCYCLE_PARKING',false),(${f.a},'ENERGY_CONSUMPTION',false),(${f.a},'ELECTRICAL',true)`;
        await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'PEDESTRIAN_ACCESS',clock_timestamp()),(${f.a},'MOTORCYCLE_PARKING',clock_timestamp()),(${f.a},'ENERGY_CONSUMPTION',clock_timestamp()),(${f.a},'ELECTRICAL',clock_timestamp())`;
        const state = async (key: 'PEDESTRIAN_ACCESS'|'MOTORCYCLE_PARKING'|'ENERGY_CONSUMPTION'|'ELECTRICAL', enabled: boolean) => {
          const current = await as(f.scoped,tx=>readFeatures(tx,f.a));
          assert.equal(current[key].localEnabled,enabled); assert.equal(current[key].enabled,enabled); assert.ok(current[key].resumedAt,'equipment-only runtime row must remain visible');
        };
        const resume = async (key: 'PEDESTRIAN_ACCESS'|'MOTORCYCLE_PARKING'|'ELECTRICAL') => {
          await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key=${key}`;
          await sqlClient`update feature_runtime set resumed_at=clock_timestamp()+interval '1 hour' where building_id=${f.a} and feature_key=${key}`;
          await state(key,true);
          assert.deepEqual(await s.batch([f.device(),f.device({deviceId:f.d2}),f.gw(),f.marker()]),[f.device(),f.marker()]);
        };
        await sqlClient`update devices set type='GATE_CONTROLLER' where id=${f.d1}`;
        await sqlClient`insert into gates(building_id,name,kind,gateway_id,device_id) values(${f.a},'Equipment-only pedestrian gate','PEDESTRIAN',${f.ga},${f.d1})`;
        assert.deepEqual([...(await as(f.scoped,tx=>tx.execute(sql`select * from app_equipment_device_classification(${f.a},${f.d1})`)))],[{device_type:'GATE_CONTROLLER',gate_kind:'PEDESTRIAN',parking_vehicle_type:null}]);
        await state('PEDESTRIAN_ACCESS',false);
        assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.marker()]);
        await resume('PEDESTRIAN_ACCESS');
        t.diagnostic(`Equipment-only pedestrian gate pause/resume verified after ${Math.round(performance.now()-started)}ms`);
        await sqlClient`delete from gates where device_id=${f.d1}`;
        await sqlClient`update devices set type='PARKING_SENSOR' where id=${f.d1}`;
        await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity,sensor_id) values(${f.a},'MOTORCYCLE',10,${f.d1})`;
        assert.deepEqual([...(await as(f.scoped,tx=>tx.execute(sql`select * from app_equipment_device_classification(${f.a},${f.d1})`)))],[{device_type:'PARKING_SENSOR',gate_kind:null,parking_vehicle_type:'MOTORCYCLE'}]);
        await state('MOTORCYCLE_PARKING',false);
        assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.marker()]);
        await resume('MOTORCYCLE_PARKING');
        t.diagnostic(`Equipment-only motorcycle parking pause/resume verified after ${Math.round(performance.now()-started)}ms`);
        await sqlClient`delete from parking_lots where sensor_id=${f.d1}`;
        await sqlClient`update devices set type='ENERGY_METER' where id=${f.d1}`;
        await state('ENERGY_CONSUMPTION',false); await state('ELECTRICAL',true);
        assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.device(),f.marker()]);
        await sqlClient`update building_feature_settings set enabled=false where building_id=${f.a} and feature_key='ELECTRICAL'`;
        await state('ENERGY_CONSUMPTION',false); await state('ELECTRICAL',false);
        assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.marker()]);
        await resume('ELECTRICAL'); await state('ENERGY_CONSUMPTION',false);
        t.diagnostic(`Equipment-only mixed ANY pause/resume verified after ${Math.round(performance.now()-started)}ms`);
      },false,45_000);
      await sqlClient`update role_bindings set resource_id=${f.db} where id=${f.scopedBinding}`;
      const rows = await as(f.scoped,tx=>tx.execute(sql`select * from building_feature_settings where building_id=${f.a}`)); assert.equal(rows.length,0);
      await stream(f,f.scoped,async s=>assert.deepEqual(await s.batch([f.device(),f.marker()]),[]));
      await sqlClient`update role_bindings set resource_id=${f.gb} where id=${f.gatewayBinding}`;
      assert.equal((await as(f.gateway,tx=>tx.execute(sql`select * from feature_runtime where building_id=${f.a}`))).length,0);
      await stream(f,f.gateway,async s=>assert.deepEqual(await s.batch([f.gw(),f.marker()]),[]));
    } finally { for (const row of removed) await sqlClient`insert into role_permissions(role_key,permission_key,created_at) values(${row.role_key},${row.permission_key},${row.created_at}::timestamptz)`; }
  }));
  it("denies inactive equipment role and permission without promoting other domains", async () => fixture(async f => {
    for (const [table,key] of [['roles','MAINTENANCE'],['permissions','devices:read']] as const) {
      const [original] = await sqlClient`select active from ${sqlClient(table)} where key=${key}`;
      try {
        await stream(f,f.scoped,async s=> {
          await sqlClient`update ${sqlClient(table)} set active=false where key=${key}`;
          assert.deepEqual(await s.batch(events(f)),[]);
          await sqlClient`update ${sqlClient(table)} set active=${original.active} where key=${key}`;
          assert.deepEqual(await s.batch(events(f)),[f.device()]);
        });
      } finally { await sqlClient`update ${sqlClient(table)} set active=${original.active} where key=${key}`; }
    }
    await sqlClient`update role_bindings set resource_type='alert',resource_id=${randomUUID()} where id=${f.scopedBinding}`;
    await stream(f,f.scoped,async s=>assert.deepEqual(await s.batch(events(f)),[]));
  }));
  it("delivers exact global markers to any valid identity and local markers only with current feature rights", async () => fixture(async f => {
    for (const user of f.ids) await stream(f,user,async s=> {
      assert.deepEqual(await s.marker(),f.marker('*'));
      const allowed = [f.direct,f.worker,f.scoped,f.gateway,f.resident,f.legacy,f.platform,f.flag].includes(user);
      assert.deepEqual(await s.batch([{...f.marker(),hash:'private'},f.marker('missing'),f.marker(f.b)]),allowed?[f.marker(),...([f.platform,f.flag].includes(user)?[f.marker(f.b)]:[])]:[]);
    });
  }));
  it("keeps local markers visible while equipment features are paused and revokes them with resource grants", async () => fixture(async f => stream(f,f.scoped,async s=> {
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    assert.deepEqual(await s.batch([f.device(),f.marker()]),[f.marker()]);
    await sqlClient`update role_bindings set resource_id='missing' where id=${f.scopedBinding}`;
    assert.deepEqual(await s.batch([f.marker(),f.device()]),[]);
  })));
  it("never delivers an unknown future event kind", async () => fixture(async f => stream(f,f.legacy,async s=> {
    assert.deepEqual(await s.batch([{kind:'future-private',buildingId:f.a,configuration:'secret'},f.device()]),[f.device()]);
  })));
  it("keeps telemetry and alert-only support independent of technical equipment status", async () => fixture(async f => {
    for (const capability of ['telemetry:read','alerts:read']) {
      const [grant] = await sqlClient`insert into support_grants(building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${f.a},${f.support},${capability},'device',${f.d1},'022 independent domain',clock_timestamp()+interval '1 hour',${f.platform}) returning id`;
      try {
        await stream(f,f.support,async s=>assert.deepEqual(await s.batch([...events(f),f.marker(),f.marker(f.b)]),[f.marker()]));
      } finally { await sqlClient`delete from support_grants where id=${grant.id}`; }
    }
  }));
  it("rechecks exact authority after feature queries when a support window expires", async () => fixture(async f => {
    const [grant] = await supportGrant(f,'device',f.d1);
    await as(f.support,async tx=> {
      await lockFeatures(tx);
      let queries = 0;
      // All authorization and RLS results come from PostgreSQL. Delay only the
      // final statement so expiration falls strictly between classification and delivery.
      const delayed = new Proxy(tx,{get(target,key,receiver) {
        if (key==='execute') return async (...args: Parameters<typeof tx.execute>) => {
          if (++queries===2) {
            await sqlClient`update support_grants set expires_at=clock_timestamp()+interval '50 milliseconds' where id=${grant.id}`;
            await target.execute(sql`select pg_sleep(0.1)`);
          }
          return target.execute(...args);
        };
        return Reflect.get(target,key,receiver);
      }});
      assert.equal(await projectDeviceStatusEvent(delayed,{kind:'device-status',buildingId:f.a,deviceId:f.d1,status:'FORGED'}),null);
      assert.equal(queries,2);
    });
  }));
  it("ends the same stream for a revoked session or inactive account", async () => fixture(async f => {
    for (const user of [f.direct,f.worker]) await stream(f,user,async s=> {
      if (user===f.direct) await sqlClient`update sessions set revoked_at=clock_timestamp() where id=${decodeJwt(f.tokens.get(user)!).sid as string}`;
      else await sqlClient`update users set active=false where id=${user}`;
      await sqlClient`select pg_notify('predioon_events',${JSON.stringify(f.device())})`;
      assert.equal((await s.reader.read()).done,true);
    });
  }));
  it("exposes only stable owner-controlled classification and feature authorization helpers", async () => fixture(async f => {
    const rows = await sqlClient`select p.proname,p.prosecdef,p.provolatile,p.proconfig,p.proowner=base.proowner as same_owner,pg_get_function_result(p.oid) as result,pg_get_functiondef(p.oid) as definition from pg_proc p cross join pg_proc base where base.oid='app_has_capability(text,text,text,text)'::regprocedure and p.oid in ('app_equipment_device_classification(text,text)'::regprocedure,'app_can_read_feature_event(text)'::regprocedure)`;
    assert.equal(rows.length,2);
    for (const row of rows) {
      assert.equal(row.prosecdef,true); assert.equal(row.provolatile,'s'); assert.equal(row.same_owner,true); assert.deepEqual(row.proconfig,['search_path=public, pg_temp']);
      assert.doesNotMatch(row.definition,/\b(telemetry|alerts|metadata|configuration|password_hash)\s*(?:\.|FROM|JOIN)/i);
    }
    assert.equal(rows.find(row=>row.proname==='app_equipment_device_classification')!.result,'TABLE(device_type text, gate_kind text, parking_vehicle_type text)');
    const acl = await sqlClient`select p.proname,coalesce(r.rolname,'PUBLIC') as grantee from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee where p.oid in ('app_equipment_device_classification(text,text)'::regprocedure,'app_can_read_feature_event(text)'::regprocedure) and a.grantee<>p.proowner`;
    assert.equal(acl.length,2); assert.ok(acl.every(row=>row.grantee==='predioon_app'));
    const access = await sqlClient`select r.rolname,has_function_privilege(r.oid,'app_equipment_device_classification(text,text)','EXECUTE') as classification,has_function_privilege(r.oid,'app_can_read_feature_event(text)','EXECUTE') as features from pg_roles r where r.rolname in ('predioon_app','predioon_identity','predioon_broker_auth')`;
    for (const role of access) { assert.equal(role.classification,role.rolname==='predioon_app'); assert.equal(role.features,role.rolname==='predioon_app'); }
    const classified = await as(f.scoped,tx=>tx.execute(sql`select * from app_equipment_device_classification(${f.a},${f.d1})`));
    assert.deepEqual([...classified],[{device_type:'WATER_LEVEL_SENSOR',gate_kind:null,parking_vehicle_type:null}]);
    const denied = await as(f.scoped,tx=>tx.execute(sql`select * from app_equipment_device_classification(${f.b},${f.db})`)); assert.equal(denied.length,0);
    const policies = await sqlClient`select tablename,cmd,roles,qual from pg_policies where policyname in ('building_features_equipment_read','feature_runtime_equipment_read') order by tablename`;
    assert.equal(policies.length,2); for (const policy of policies) { assert.equal(policy.cmd,'SELECT'); assert.deepEqual(policy.roles,['predioon_app']); assert.match(policy.qual,/app_equipment_can_read_scope/); }
  }));
  it("uses bounded point classification and no historical scans in actual feature settings and runtime RLS", async t => fixture(async f => {
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type) select ${f.org}||'-inventory-'||n,${f.b},${f.gb},'Unrelated inventory','SENSOR' from generate_series(1,500) n`;
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',clock_timestamp())`;
    await sqlClient`analyze devices`;
    const removed = await sqlClient`delete from role_permissions where role_key='MAINTENANCE' and permission_key<>'devices:read' returning role_key,permission_key,created_at::text as created_at`;
    type PlanNode = { Plans?: PlanNode[]; [key: string]: unknown };
    type CapturedPlan = { 'Query Text': string; Plan: PlanNode };
    const plans: CapturedPlan[] = [];
    const require = createRequire(import.meta.url);
    const postgres = createRequire(require.resolve('@predioon/db'))('postgres') as (url: string, options: object) => typeof sqlClient;
    const instrumented = postgres(process.env.DATABASE_URL!,{max:1,onnotice:(notice: { message: string })=> {
      const start = notice.message.indexOf('{'); if (start<0) return;
      const plan = JSON.parse(notice.message.slice(start)) as CapturedPlan;
      if (/point_device AS MATERIALIZED|SELECT target_resource_type IN \('device','gateway'\)|FROM "(building_feature_settings|feature_runtime)"/i.test(plan['Query Text'])) plans.push(plan);
    }});
    try {
      await drizzle(instrumented).transaction(async tx=> {
        await tx.execute(sql`LOAD 'auto_explain'`);
        await tx.execute(sql`SET LOCAL auto_explain.log_nested_statements=on`);
        await tx.execute(sql`SET LOCAL auto_explain.log_analyze=on`);
        await tx.execute(sql`SET LOCAL auto_explain.log_timing=off`);
        await tx.execute(sql`SET LOCAL auto_explain.log_format=json`);
        await tx.execute(sql`SET LOCAL auto_explain.log_level=notice`);
        await tx.execute(sql`SET LOCAL auto_explain.log_min_duration=0`);
        await tx.execute(sql`SET LOCAL ROLE predioon_app`);
        await tx.execute(sql`select set_config('app.user_id',${f.scoped},true)`);
        assert.deepEqual([...(await tx.execute(sql`select * from app_equipment_device_classification(${f.a},${f.d1})`))],[{device_type:'WATER_LEVEL_SENSOR',gate_kind:null,parking_vehicle_type:null}]);
        const states = await readFeatures(tx as unknown as AppTransaction,f.a);
        assert.equal(states.WATER_TANK.enabled,false); assert.ok(states.WATER_TANK.resumedAt);
      });
      const nodes = (node: PlanNode): PlanNode[] => [node,...(node.Plans??[]).flatMap(nodes)];
      const points = plans.filter(plan=>/point_device AS MATERIALIZED/i.test(plan['Query Text']));
      assert.ok(points.length,'capture the actual owner classification helper');
      for (const point of points) {
        const devices = nodes(point.Plan).filter(node=>node['Relation Name']==='devices' && Number(node['Actual Loops'])>0);
        assert.equal(devices.length,1); assert.equal(devices[0]['Index Name'],'devices_pkey');
        assert.match(String(devices[0]['Index Cond']),/id =/); assert.equal(devices[0]['Actual Rows'],1);
      }
      const states = plans.filter(plan=>/FROM "(building_feature_settings|feature_runtime)"/i.test(plan['Query Text']));
      assert.equal(states.length,2,'capture both actual readFeatures SELECT statements');
      const scopes = plans.filter(plan=>/SELECT target_resource_type IN \('device','gateway'\)/i.test(plan['Query Text']));
      assert.ok(scopes.length>=2,'capture equipment authorization inside settings and runtime RLS');
      for (const plan of plans) assert.equal(nodes(plan.Plan).filter(node=>['telemetry','alerts'].includes(String(node['Relation Name'])) && Number(node['Actual Loops'])>0).length,0,'equipment classification/state must never scan historical telemetry or alerts');
      const summaries = plans.map(plan=>({purpose:/point_device/i.test(plan['Query Text'])?'classification':/FROM "(building_feature_settings|feature_runtime)"/i.test(plan['Query Text'])?'feature-state':'equipment-scope',scans:nodes(plan.Plan).filter(node=>node['Relation Name']).map(node=>({relation:node['Relation Name'],index:node['Index Name'],condition:node['Index Cond'],rows:node['Actual Rows'],loops:node['Actual Loops']}))}));
      await mkdir(new URL('../../../.local/',import.meta.url),{recursive:true});
      await writeFile(new URL('../../../.local/022-equipment-actual-plans.json',import.meta.url),JSON.stringify(summaries,null,2));
      t.diagnostic(`Natural actual plans: ${points.length} classification, ${states.length} feature-table queries, ${scopes.length} inner equipment scope, zero history scans`);
    } finally {
      try { await instrumented.end(); }
      finally { for (const row of removed) await sqlClient`insert into role_permissions(role_key,permission_key,created_at) values(${row.role_key},${row.permission_key},${row.created_at}::timestamptz)`; }
    }
  }));
});
