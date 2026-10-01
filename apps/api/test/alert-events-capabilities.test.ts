import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { decodeJwt } from "jose";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/passwords.js";
import { startRealtimeBus } from "../src/modules/events/bus.js";
import { call, login, startTestServer } from "./helpers.js";

describe("live alert SSE capabilities", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); await startRealtimeBus(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });

  async function create() {
    const suffix = randomUUID(), org = `alert-sse-org-${suffix}`, a = `alert-sse-a-${suffix}`, b = `alert-sse-b-${suffix}`;
    const d1 = `alert-sse-d1-${suffix}`, d2 = `alert-sse-d2-${suffix}`, db = `alert-sse-db-${suffix}`;
    const gateway = `alert-sse-gw-${suffix}`, foreignGateway = `alert-sse-gwb-${suffix}`;
    const direct = `alert-sse-direct-${suffix}`, worker = `alert-sse-worker-${suffix}`, scoped = `alert-sse-scoped-${suffix}`;
    const exact = `alert-sse-exact-${suffix}`, gateUser = `alert-sse-gate-${suffix}`, support = `alert-sse-support-${suffix}`;
    const resident = `alert-sse-resident-${suffix}`, legacy = `alert-sse-legacy-${suffix}`, admin = `alert-sse-admin-${suffix}`;
    const platform = `alert-sse-platform-${suffix}`, flag = `alert-sse-flag-${suffix}`;
    const ids = [direct,worker,scoped,exact,gateUser,support,resident,legacy,admin,platform,flag];
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Alert SSE test',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'A','A'),(${b},${org},'B','B')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash,is_platform_admin) values(${id},${id+'@alert-sse.test'},${id},${passwordHash},${id===flag})`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gateway},${a},'A',${gateway}),(${foreignGateway},${b},'B',${foreignGateway})`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type,metadata) values(${d1},${a},${gateway},'Mixed A','ENERGY_METER','{"secret":"private"}'),(${d2},${a},null,'Neighbor','WATER_LEVEL_SENSOR','{}'),(${db},${b},null,'Foreign','WATER_LEVEL_SENSOR','{}')`;
    const one = randomUUID(), neighbor = randomUUID(), gateAlert = randomUUID(), foreign = randomUUID(), rule = randomUUID();
    await sqlClient`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template) values(${rule},${a},${d1},'Rule','water_level_percent','LT',10,'WATER_LOW','private threshold')`;
    await sqlClient`insert into alerts(id,building_id,device_id,rule_id,gateway_id,severity,type,message,triggered_value,triggered_at) values
      (${one},${a},${d1},${rule},null,'HIGH','WATER_LOW','Persisted water alert','"private-reading"',clock_timestamp()),
      (${neighbor},${a},${d2},null,null,'LOW','WATER_HIGH','Neighbor',null,clock_timestamp()),
      (${gateAlert},${a},null,null,${gateway},'CRITICAL','GATEWAY_OFFLINE','Persisted gateway alert',null,clock_timestamp()),
      (${foreign},${b},${db},null,${foreignGateway},'HIGH','WATER_LOW','Foreign',null,clock_timestamp())`;
    const team = randomUUID(), teamBinding = randomUUID(), directBinding = randomUUID(), scopedBinding = randomUUID(), supportBinding = randomUUID(), grant = randomUUID();
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'SSE maintenance')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${worker})`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${a},'MAINTENANCE')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${directBinding},${direct},${a},'MAINTENANCE'),(${randomUUID()},${resident},${a},'RESIDENT')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values
      (${scopedBinding},${scoped},${a},'MAINTENANCE','device',${d1}),
      (${randomUUID()},${exact},${a},'MAINTENANCE_MANAGER','alert',${one}),
      (${randomUUID()},${gateUser},${a},'MAINTENANCE_MANAGER','gateway',${gateway})`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${randomUUID()},${platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${legacy},${a},'RESIDENT'),(${admin},${a},'BUILDING_ADMIN')`;
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${a},${support},'alerts:read','alert',${one},'SSE diagnosis',now()+interval '1 hour',${platform})`;
    const tokens = new Map<string,string>();
    for (const id of ids) tokens.set(id,(await login(server.url,id+'@alert-sse.test')).accessToken);
    const event = (extra: Record<string,unknown> = {}) => ({kind:'alert',buildingId:a,alertId:one,deviceId:d1,gatewayId:null,severity:'HIGH',type:'WATER_LOW',message:'Persisted water alert',status:'OPEN',...extra});
    const gatewayEvent = () => event({alertId:gateAlert,deviceId:null,gatewayId:gateway,severity:'CRITICAL',type:'GATEWAY_OFFLINE',message:'Persisted gateway alert'});
    return {org,a,b,d1,d2,db,gateway,foreignGateway,one,neighbor,gateAlert,foreign,rule,ids,direct,worker,scoped,exact,gateUser,support,resident,legacy,admin,platform,flag,team,teamBinding,directBinding,scopedBinding,supportBinding,grant,tokens,event,gatewayEvent};
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
  async function stream<T>(f: Fixture, user: string, run: (s: { batch: (events: Record<string,unknown>[]) => Promise<Record<string,unknown>[]>; reader: ReadableStreamDefaultReader<Uint8Array> }) => Promise<T>): Promise<T> {
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
        const delivered: Record<string,unknown>[] = [];
        for (;;) {
          const next = await frame();
          const data = next.split('\n').find(line=>line.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6)) as Record<string,unknown>;
          if (event.kind==='features-changed' && event.buildingId==='*') return delivered;
          delivered.push(event);
        }
      };
      return await run({batch,reader});
    } finally { clearTimeout(timeout); controller.abort(); await reader?.cancel().catch(()=>undefined); }
  }

  it("delivers direct and team maintenance alerts without legacy memberships", async () => fixture(async f => {
    for (const user of [f.direct,f.worker]) await stream(f,user,async s => assert.deepEqual(await s.batch([f.event()]),[f.event()]));
  }));
  it("reconstructs all nine fields from persistence for a legacy administrator", async () => fixture(async f => stream(f,f.admin,async s => {
    await sqlClient`update alerts set status='RESOLVED' where id=${f.one}`;
    const fake = f.event({deviceId:f.d2,gatewayId:f.foreignGateway,severity:'LOW',type:'GENERAL',message:'Forged',status:'OPEN',triggeredValue:'private',rules:{secret:true},config:{secret:true}});
    assert.deepEqual(await s.batch([fake]),[f.event({status:'RESOLVED'})]);
  })));
  it("restricts exact alert and device grants to their own persisted alert", async () => fixture(async f => {
    for (const user of [f.scoped,f.exact]) await stream(f,user,async s => {
      const denied = [f.event({alertId:f.neighbor}),f.event({buildingId:f.b,alertId:f.foreign}),f.event({buildingId:f.b}),f.event({alertId:f.foreign}),f.event({alertId:randomUUID()})];
      assert.deepEqual(await s.batch([...denied,f.event({deviceId:f.d2,gatewayId:f.foreignGateway})]),[f.event()]);
    });
    await stream(f,f.scoped,async s => {
      await sqlClient`update role_bindings set resource_type='building',resource_id=${f.a} where id=${f.scopedBinding}`;
      assert.deepEqual(await s.batch([f.event()]),[]);
    });
  }));
  it("requires explicit persisted gateway association for gateway grants", async () => fixture(async f => stream(f,f.gateUser,async s => {
    assert.deepEqual(await s.batch([f.event({gatewayId:f.gateway}),f.gatewayEvent()]),[f.gatewayEvent()]);
  })));
  it("delivers alert-only support without device or telemetry read", async () => fixture(async f => stream(f,f.support,async s => {
    const [scope] = await withUserContext({userId:f.support,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_has_capability(${f.a},'devices:read','device',${f.d1}) as devices,app_has_capability(${f.a},'telemetry:read','device',${f.d1}) as telemetry`));
    assert.equal(scope.devices,false); assert.equal(scope.telemetry,false);
    assert.deepEqual(await s.batch([f.event({alertId:f.neighbor}),f.gatewayEvent(),f.event()]),[f.event()]);
  })));
  it("denies resident and global platform identities until an independent local grant exists", async () => fixture(async f => {
    for (const user of [f.resident,f.legacy,f.platform,f.flag]) await stream(f,user,async s => {
      assert.deepEqual(await s.batch([f.event(),f.gatewayEvent()]),[]);
      await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${user},${f.a},'MAINTENANCE','alert',${f.one})`;
      assert.deepEqual(await s.batch([f.event(),f.gatewayEvent()]),[f.event()]);
    });
  }));
  it("quietly skips malformed missing and divergent IDs while keeping an authorized stream open", async () => fixture(async f => stream(f,f.admin,async s => {
    for (const alertId of ['', 'malformed', "x'::uuid", '00000000-0000-0000-0000-000000000000', randomUUID()]) {
      assert.deepEqual(await s.batch([f.event({alertId})]),[],alertId);
    }
    assert.deepEqual(await s.batch([f.event({buildingId:f.b}),f.event({alertId:f.foreign}),f.event({buildingId:'missing'}),f.event()]),[f.event()]);
  })));
  it("reflects current persisted status and nullable gateway on the same stream", async () => fixture(async f => stream(f,f.direct,async s => {
    await sqlClient`update alerts set status='ACKNOWLEDGED',message='Current message',severity='CRITICAL',type='GENERAL',gateway_id=${f.gateway} where id=${f.one}`;
    assert.deepEqual(await s.batch([f.event()]),[f.event({status:'ACKNOWLEDGED',message:'Current message',severity:'CRITICAL',type:'GENERAL',gatewayId:f.gateway})]);
    await sqlClient`update alerts set status='RESOLVED',gateway_id=null where id=${f.one}`;
    const rows = await s.batch([f.event({gatewayId:f.gateway})]);
    assert.deepEqual(rows,[f.event({status:'RESOLVED',message:'Current message',severity:'CRITICAL',type:'GENERAL',gatewayId:null})]);
    assert.deepEqual(Object.keys(rows[0]).sort(),['kind','buildingId','alertId','deviceId','gatewayId','severity','type','message','status'].sort());
  })));
  it("delivers overlapping direct team resource and support grants once", async () => fixture(async f => {
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${f.team},${f.a},${f.direct})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${f.direct},${f.a},'MAINTENANCE','alert',${f.one})`;
    await sqlClient`insert into role_bindings(user_id,role_key) values(${f.direct},'PLATFORM_SUPPORT')`;
    await sqlClient`insert into support_grants(building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${f.a},${f.direct},'alerts:read','alert',${f.one},'Overlapping SSE grant',now()+interval '1 hour',${f.platform})`;
    await stream(f,f.direct,async s => assert.deepEqual(await s.batch([f.event()]),[f.event()]));
  }));
  it("rechecks direct binding activity and time windows on the same JWT and stream", async () => fixture(async f => stream(f,f.direct,async s => {
    assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    for (const mutate of [
      () => sqlClient`update role_bindings set active=false where id=${f.directBinding}`,
      () => sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.directBinding}`,
      () => sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.directBinding}`,
    ]) {
      await mutate(); assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.directBinding}`;
      assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    }
  })));
  it("rechecks team bindings membership activity and windows on the same stream", async () => fixture(async f => stream(f,f.worker,async s => {
    assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    for (const mutate of [
      () => sqlClient`update role_bindings set active=false where id=${f.teamBinding}`,
      () => sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.teamBinding}`,
      () => sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.teamBinding}`,
      () => sqlClient`update teams set active=false where id=${f.team}`,
      () => sqlClient`update team_members set active=false where team_id=${f.team}`,
      () => sqlClient`update team_members set ends_at=now()-interval '1 second' where team_id=${f.team}`,
      () => sqlClient`update team_members set starts_at=now()+interval '1 hour' where team_id=${f.team}`,
    ]) {
      await mutate(); assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.teamBinding}`;
      await sqlClient`update teams set active=true where id=${f.team}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
      assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    }
  })));
  it("rechecks read-only support grant expiry revocation and global support role", async () => fixture(async f => stream(f,f.support,async s => {
    assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    for (const mutate of [
      () => sqlClient`update support_grants set revoked_at=now() where id=${f.grant}`,
      () => sqlClient`update support_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${f.grant}`,
      () => sqlClient`update role_bindings set active=false where id=${f.supportBinding}`,
    ]) {
      await mutate(); assert.deepEqual(await s.batch([f.event()]),[]);
      await sqlClient`update support_grants set revoked_at=null,created_at=now(),expires_at=now()+interval '1 hour' where id=${f.grant}`;
      await sqlClient`update role_bindings set active=true where id=${f.supportBinding}`;
      assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    }
  })));
  it("rechecks live organization and building activity on the same stream", async () => fixture(async f => stream(f,f.direct,async s => {
    for (const target of ['organization','building']) {
      if (target==='organization') await sqlClient`update organizations set active=false where id=${f.org}`;
      else await sqlClient`update buildings set active=false where id=${f.a}`;
      assert.deepEqual(await s.batch([f.event()]),[]);
      if (target==='organization') await sqlClient`update organizations set active=true where id=${f.org}`;
      else await sqlClient`update buildings set active=true where id=${f.a}`;
      assert.deepEqual(await s.batch([f.event()]),[f.event()]);
    }
  })));
  it("suppresses paused and pre-resume stored alerts independently of buildings read", async () => fixture(async f => {
    const [permission] = await sqlClient`select active from permissions where key='buildings:read'`;
    try {
      await sqlClient`update permissions set active=false where key='buildings:read'`;
      await stream(f,f.support,async s => {
        const [scope] = await withUserContext({userId:f.support,role:'PLATFORM_ADMIN'},tx=>tx.execute(sql`select app_has_capability(${f.a},'buildings:read') as allowed`));
        assert.equal(scope.allowed,false);
        assert.deepEqual(await s.batch([f.event()]),[f.event()]);
        await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'WATER_TANK',false)`;
        assert.deepEqual(await s.batch([f.event({type:'GENERAL'})]),[]);
        await sqlClient`update building_feature_settings set enabled=true where building_id=${f.a} and feature_key='WATER_TANK'`;
        await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'WATER_TANK',clock_timestamp())`;
        assert.deepEqual(await s.batch([f.event()]),[]);
        // Retained HTTP history remains readable after resuming.
        const response = await call(server.url,`/alerts?buildingId=${f.a}`,{token:f.tokens.get(f.support)});
        assert.equal(response.status,200); assert.deepEqual((await response.json()).items.map((row: { id:string })=>row.id),[f.one]);
        await sqlClient`update alerts set triggered_at=(select resumed_at from feature_runtime where building_id=${f.a} and feature_key='WATER_TANK') where id=${f.one}`;
        assert.deepEqual(await s.batch([f.event()]),[]);
        await sqlClient`update alerts set triggered_at=clock_timestamp() where id=${f.one}`;
        assert.deepEqual(await s.batch([f.event()]),[f.event()]);
      });
    } finally { await sqlClient`update permissions set active=${permission.active} where key='buildings:read'`; }
  }));
  it("delivers equipment status and feature changes using current capabilities", async () => fixture(async f => {
    const events = [
      {kind:'device-status',buildingId:f.a,deviceId:f.d1,status:'ONLINE'},
      {kind:'gateway-status',buildingId:f.a,gatewayId:f.gateway,status:'ONLINE'},
      {kind:'features-changed',buildingId:f.a},
    ];
    const [device] = await sqlClient`select status from devices where id=${f.d1}`;
    const [gateway] = await sqlClient`select status from gateways where id=${f.gateway}`;
    const expected = [{...events[0],status:device.status},{...events[1],status:gateway.status},events[2]];
    for (const user of [f.admin,f.direct]) await stream(f,user,async s => assert.deepEqual(await s.batch(events),expected));
  }));
  it("ends the same stream when its session is revoked", async () => fixture(async f => stream(f,f.direct,async s => {
    await sqlClient`update sessions set revoked_at=now() where id=${decodeJwt(f.tokens.get(f.direct)!).sid as string}`;
    await sqlClient`select pg_notify('predioon_events',${JSON.stringify(f.event())})`;
    const next = await s.reader.read(); assert.equal(next.done,true,'Revoked session delivered an SSE frame');
  })));
  it("ends the same stream when its account is disabled", async () => fixture(async f => stream(f,f.direct,async s => {
    await sqlClient`update users set active=false where id=${f.direct}`;
    await sqlClient`select pg_notify('predioon_events',${JSON.stringify(f.event())})`;
    const next = await s.reader.read(); assert.equal(next.done,true,'Disabled account delivered an SSE frame');
  })));
});
