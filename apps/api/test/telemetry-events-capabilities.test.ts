import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { decodeJwt } from "jose";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/passwords.js";
import { startRealtimeBus } from "../src/modules/events/bus.js";
import { login, startTestServer } from "./helpers.js";

describe("live telemetry SSE capabilities", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); await startRealtimeBus(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });

  async function create() {
    const suffix = randomUUID(), org = `sse-org-${suffix}`, a = `sse-a-${suffix}`, b = `sse-b-${suffix}`;
    const d1 = `sse-d1-${suffix}`, d2 = `sse-d2-${suffix}`, db = `sse-db-${suffix}`;
    const direct = `sse-direct-${suffix}`, worker = `sse-worker-${suffix}`, scoped = `sse-scoped-${suffix}`;
    const resident = `sse-resident-${suffix}`, legacy = `sse-legacy-${suffix}`, support = `sse-support-${suffix}`;
    const platform = `sse-platform-${suffix}`, flag = `sse-flag-${suffix}`;
    const ids = [direct,worker,scoped,resident,legacy,support,platform,flag];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'SSE test',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash,is_platform_admin) values(${id},${id+'@sse.test'},${id},${passwordHash},${id===flag})`;
    await sqlClient`insert into devices(id,building_id,name,type,metadata) values(${d1},${a},'Mixed A','ENERGY_METER','{"secret":"private"}'),(${d2},${a},'Neighbor','WATER_LEVEL_SENSOR','{}'),(${db},${b},'Foreign','WATER_LEVEL_SENSOR','{}')`;
    const team = randomUUID(), teamBinding = randomUUID(), directBinding = randomUUID(), scopedBinding = randomUUID(), residentBinding = randomUUID(), supportBinding = randomUUID(), grant = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'SSE maintenance')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${directBinding},${direct},${a},'MAINTENANCE'),(${residentBinding},${resident},${a},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${scopedBinding},${scoped},${a},'MAINTENANCE','device',${d1})`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${legacy},${a},'RESIDENT')`;
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${a},${support},'telemetry:read','device',${d1},'SSE diagnosis',now()+interval '1 hour',${platform})`;
    const tokens = new Map<string,string>();
    for (const id of ids) tokens.set(id,(await login(server.url,id+'@sse.test')).accessToken);
    const [clock] = await sqlClient`select clock_timestamp() as time`;
    const event = (extra: Record<string,unknown> = {}) => ({ kind:'telemetry',buildingId:a,deviceId:d1,metric:'water_level_percent',value:42,unit:'private-unit',quality:'GOOD',time:new Date(clock.time).toISOString(),...extra });
    return {org,a,b,d1,d2,db,ids,direct,worker,scoped,resident,legacy,support,platform,flag,team,teamBinding,directBinding,scopedBinding,residentBinding,supportBinding,grant,tokens,event};
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); }
    finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  async function stream<T>(f: Fixture, user: string, run: (s: { batch: (events: Record<string,unknown>[]) => Promise<any[]>; reader: ReadableStreamDefaultReader<Uint8Array> }) => Promise<T>): Promise<T> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),20_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(`${server.url}/events/stream`,{headers:{Authorization:`Bearer ${f.tokens.get(user)}`},signal:controller.signal});
      assert.equal(response.status,200,await (response.status===200?Promise.resolve(''):response.text()));
      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      async function frame(): Promise<string> {
        while (!pending.includes('\n\n')) {
          const next = await reader!.read();
          assert.equal(next.done,false,'SSE closed unexpectedly before the marker');
          pending += decoder.decode(next.value,{stream:true});
        }
        const end = pending.indexOf('\n\n'), result = pending.slice(0,end); pending = pending.slice(end+2); return result;
      }
      assert.equal(await frame(),'retry: 5000');
      const batch = async (events: Record<string,unknown>[]) => {
        for (const event of events) await sqlClient`select pg_notify('predioon_events',${JSON.stringify(event)})`;
        await sqlClient`select pg_notify('predioon_events',${JSON.stringify({kind:'features-changed',buildingId:'*'})})`;
        const delivered: any[] = [];
        for (;;) {
          const next = await frame();
          const data = next.split('\n').find(line=>line.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          if (event.kind==='features-changed' && event.buildingId==='*') return delivered;
          delivered.push(event);
        }
      };
      return await run({batch,reader});
    } finally { clearTimeout(timeout); controller.abort(); await reader?.cancel().catch(()=>undefined); }
  }
  const only = (rows: any[]) => { assert.equal(rows.length,1); return rows[0]; };

  it("delivers direct and team maintenance telemetry without legacy memberships", async () => fixture(async f => {
    for (const user of [f.direct,f.worker]) await stream(f,user,async s => {
      const event = f.event({metric:'energy_total_kwh',value:'technical-reading'});
      assert.deepEqual(only(await s.batch([event])),event);
    });
  }));
  it("delivers only the exact authorized device and keeps denied scopes open", async () => fixture(async f => stream(f,f.scoped,async s => {
    const event = f.event();
    assert.deepEqual(await s.batch([f.event({deviceId:f.d2}),f.event({buildingId:f.b,deviceId:f.db}),f.event({buildingId:f.b}),f.event({deviceId:'missing'}),event]),[event]);
    await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
    assert.deepEqual(await s.batch([event]),[]);
  })));
  it("supports telemetry-only grants without devices:read", async () => fixture(async f => stream(f,f.support,async s => {
    const [scope] = await withUserContext({userId:f.support,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_has_capability(${f.a},'devices:read','device',${f.d1}) as allowed`));
    assert.equal(scope.allowed,false);
    assert.deepEqual(await s.batch([f.event({deviceId:f.d2}),f.event()]),[f.event()]);
  })));
  it("publishes water for resident bindings and prevents legacy resident private readings", async () => fixture(async f => {
    for (const user of [f.legacy,f.resident]) await stream(f,user,async s => {
      const rows = await s.batch([f.event({metric:'energy_total_kwh',value:'secret-energy'}),f.event({privateMetadata:'secret'})]);
      const row = only(rows);
      assert.deepEqual(Object.keys(row).sort(),['kind','buildingId','deviceId','metric','value','unit','quality','time'].sort());
      assert.equal(row.unit,'%'); assert.equal(row.value,42); assert.equal(row.quality,'GOOD');
    });
  }));
  it("denies global platform bindings and legacy platform flags until a local private grant exists", async () => fixture(async f => {
    for (const user of [f.flag,f.platform]) await stream(f,user,async s => {
      assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${user},${f.a},'MAINTENANCE','device',${f.d1})`;
      assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    });
  }));
  it("sanitizes publication, normalizes time and rejects invalid values and timestamps", async () => fixture(async f => stream(f,f.resident,async s => {
    for (const value of ['42',true,-1,101,NaN,Infinity,-Infinity]) assert.deepEqual(await s.batch([f.event({value})]),[],String(value));
    assert.deepEqual(await s.batch([f.event({time:'invalid-time'})]),[]);
    const event = f.event({value:0,quality:undefined,time:'2026-09-30T12:30:00-03:00',unit:'credentials-secret',metadata:'secret'});
    const row = only(await s.batch([event]));
    assert.deepEqual(row,{kind:'telemetry',buildingId:f.a,deviceId:f.d1,metric:'water_level_percent',value:0,unit:'%',quality:'UNCERTAIN',time:'2026-09-30T15:30:00.000Z'});
    assert.equal(only(await s.batch([f.event({value:100,quality:'BAD'})])).value,100);
  })));
  it("limits resident resource publication and rechecks it on the same stream", async () => fixture(async f => {
    await sqlClient`update role_bindings set resource_type='device',resource_id=${f.d1} where id=${f.residentBinding}`;
    await stream(f,f.resident,async s => {
      assert.equal((await s.batch([f.event(),f.event({deviceId:f.d2}),f.event({buildingId:f.b,deviceId:f.db})])).length,1);
      await sqlClient`update role_bindings set active=false where id=${f.residentBinding}`;
      assert.deepEqual(await s.batch([f.event()]),[]);
    });
  }));
  it("keeps raw precedence and delivers overlapping capabilities once", async () => fixture(async f => {
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.scoped},${f.a},'RESIDENT')`;
    await stream(f,f.scoped,async s => {
      const rows = await s.batch([f.event(),f.event({deviceId:f.d2})]);
      assert.equal(rows.length,2); assert.equal(rows[0].unit,'private-unit'); assert.equal(rows[1].unit,'%');
    });
  }));
  it("rechecks direct binding activity and windows on the same JWT and stream", async () => fixture(async f => stream(f,f.direct,async s => {
    assert.equal((await s.batch([f.event()])).length,1);
    for (const mutate of [
      () => sqlClient`update role_bindings set active=false where id=${f.directBinding}`,
      () => sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.directBinding}`,
      () => sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.directBinding}`,
    ]) {
      await mutate(); assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.directBinding}`;
      assert.equal((await s.batch([f.event()])).length,1);
    }
  })));
  it("rechecks team bindings, memberships and windows on the same stream", async () => fixture(async f => stream(f,f.worker,async s => {
    assert.equal((await s.batch([f.event()])).length,1);
    for (const mutate of [
      () => sqlClient`update role_bindings set active=false where id=${f.teamBinding}`,
      () => sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.teamBinding}`,
      () => sqlClient`update teams set active=false where id=${f.team}`,
      () => sqlClient`update team_members set active=false where team_id=${f.team}`,
      () => sqlClient`update team_members set ends_at=now()-interval '1 second' where team_id=${f.team}`,
      () => sqlClient`update team_members set starts_at=now()+interval '1 hour' where team_id=${f.team}`,
    ]) {
      await mutate(); assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.teamBinding}`;
      await sqlClient`update teams set active=true where id=${f.team}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
      assert.equal((await s.batch([f.event()])).length,1);
    }
  })));
  it("rechecks support grant expiry, revocation and global support role on the same stream", async () => fixture(async f => stream(f,f.support,async s => {
    assert.equal((await s.batch([f.event()])).length,1);
    for (const mutate of [
      () => sqlClient`update support_grants set revoked_at=now() where id=${f.grant}`,
      () => sqlClient`update support_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${f.grant}`,
      () => sqlClient`update role_bindings set active=false where id=${f.supportBinding}`,
    ]) {
      await mutate(); assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`update support_grants set revoked_at=null,created_at=now(),expires_at=now()+interval '1 hour' where id=${f.grant}`;
      await sqlClient`update role_bindings set active=true where id=${f.supportBinding}`;
      assert.equal((await s.batch([f.event()])).length,1);
    }
  })));
  it("enforces pause and resume with buildings:read independently revoked", async () => fixture(async f => {
    const [permission] = await sqlClient`select active from permissions where key='buildings:read'`;
    try {
      await sqlClient`update permissions set active=false where key='buildings:read'`;
      await stream(f,f.direct,async s => {
        const [scope] = await withUserContext({userId:f.direct,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_has_capability(${f.a},'buildings:read') as allowed`));
        assert.equal(scope.allowed,false);
        assert.equal((await s.batch([f.event()])).length,1);
        await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
        assert.deepEqual(await s.batch([f.event()]),[]);
        await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
        await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',clock_timestamp())`;
        const [clock] = await sqlClient`select clock_timestamp()+interval '1 second' as time`;
        assert.deepEqual(await s.batch([f.event(),f.event({time:new Date(clock.time).toISOString()})]),[f.event({time:new Date(clock.time).toISOString()})]);
      });
      await stream(f,f.resident,async s => {
        assert.deepEqual(await s.batch([f.event()]),[]);
        const [clock] = await sqlClient`select clock_timestamp()+interval '1 second' as time`;
        assert.equal((await s.batch([f.event({time:new Date(clock.time).toISOString()})])).length,1);
      });
    } finally { await sqlClient`update permissions set active=${permission.active} where key='buildings:read'`; }
  }));
  it("still ends streams after session revocation", async () => fixture(async f => stream(f,f.direct,async s => {
    await sqlClient`update sessions set revoked_at=now() where id=${decodeJwt(f.tokens.get(f.direct)!).sid as string}`;
    await sqlClient`select pg_notify('predioon_events',${JSON.stringify(f.event())})`;
    const next = await s.reader.read(); assert.equal(next.done,true,'Revoked session delivered an SSE frame');
  })));
});
