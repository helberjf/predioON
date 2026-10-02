import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext, type AppTransaction } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { startTestServer, login, call } from "./helpers.js";

describe("authorization uses current statement time and fresh time after controlled lock waits", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: (tx: AppTransaction) => Promise<T>) => withUserContext({userId, role:"PLATFORM_ADMIN"}, run);
  async function create() {
    const suffix = randomUUID(), org = `tw-org-${suffix}`, building = `tw-building-${suffix}`;
    const device = `tw-device-${suffix}`, gateway = `tw-gateway-${suffix}`;
    const direct = `tw-direct-${suffix}`, worker = `tw-worker-${suffix}`, legacy = `tw-legacy-${suffix}`;
    const support = `tw-support-${suffix}`, platform = `tw-platform-${suffix}`;
    const ids = [direct,worker,legacy,support,platform], binding = randomUUID(), teamBinding = randomUUID(), team = randomUUID();
    const supportBinding = randomUUID(), platformBinding = randomUUID(), grant = randomUUID(), alert = randomUUID();
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Time windows',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'Time windows','TW')`;
    for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id+'@windows.test'},${id},${passwordHash})`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number,metadata) values(${gateway},${building},'Original gateway',${gateway},'{"mqttPasswordHash":"original-hash","mqttUsername":"original-user"}')`;
    await sqlClient`insert into devices(id,building_id,gateway_id,name,type) values(${device},${building},${gateway},'Original device','WATER_LEVEL_SENSOR')`;
    await sqlClient`insert into teams(id,building_id,name) values(${team},${building},'Timed team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${building},${worker})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${direct},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into role_bindings(id,team_id,building_id,role_key) values(${teamBinding},${team},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${platformBinding},${platform},'PLATFORM_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${legacy},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,reason,expires_at,granted_by) values(${grant},${building},${support},'devices:read','Time window diagnosis',clock_timestamp()+interval '1 hour',${direct})`;
    await sqlClient`insert into alerts(id,building_id,device_id,severity,type,message) values(${alert},${building},${device},'HIGH','WATER_LOW','Time window alert')`;
    const tokens = new Map<string,string>();
    for (const id of [direct,worker,platform]) tokens.set(id,(await login(server.url,id+'@windows.test')).accessToken);
    const request = (user:string,path:string,method='GET',body?:unknown) => call(server.url,path,{token:tokens.get(user),method,body});
    return {org,building,device,gateway,direct,worker,legacy,support,platform,ids,binding,teamBinding,team,supportBinding,platformBinding,grant,alert,request};
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run:(f:Fixture)=>Promise<void>) {
    const f = await create();
    try { await run(f); } finally {
      await sqlClient`delete from telemetry where building_id in (select id from buildings where organization_id=${f.org})`;
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
      await sqlClient`delete from gate_commands where building_id=${f.building}`;
      await sqlClient`delete from gates where building_id=${f.building}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
    }
  }
  // The clock and boundary both come from PostgreSQL, never the host clock.
  async function waitPast(boundary: unknown) {
    for(let i=0;i<100;i++) {
      const [r] = await sqlClient`select clock_timestamp()>${boundary as Date}::timestamptz as expired`;
      if(r.expired) return;
      await sqlClient`select pg_sleep(0.02)`;
    }
    assert.fail('database clock did not cross the authorization boundary within the bounded wait');
  }
  const capability = (tx:AppTransaction,f:Fixture) => tx.execute(sql`select app_has_capability(${f.building},'devices:read','device',${f.device}) as allowed`);
  async function expire(f:Fixture,kind:string,seconds=0.25) {
    let rows;
    if(kind==='member') rows=await sqlClient`update team_members set ends_at=clock_timestamp()+${seconds}*interval '1 second' where team_id=${f.team} returning ends_at as boundary`;
    else if(kind==='legacy') rows=await sqlClient`update memberships set ends_at=clock_timestamp()+${seconds}*interval '1 second' where user_id=${f.legacy} returning ends_at as boundary`;
    else if(kind==='grant') rows=await sqlClient`update support_grants set expires_at=clock_timestamp()+${seconds}*interval '1 second' where id=${f.grant} returning expires_at as boundary`;
    else { const id=kind==='team'?f.teamBinding:kind==='supportRole'?f.supportBinding:kind==='platform'?f.platformBinding:f.binding;
      rows=await sqlClient`update role_bindings set ends_at=clock_timestamp()+${seconds}*interval '1 second' where id=${id} returning ends_at as boundary`; }
    return rows[0].boundary;
  }
  for(const kind of ['direct','member','team','legacy','grant','supportRole','platform']) {
    it(`expires ${kind} authority between statements in one app transaction`,async()=>fixture(async f=>{
      const user=kind==='member'||kind==='team'?f.worker:kind==='legacy'?f.legacy:kind==='grant'||kind==='supportRole'?f.support:f.platform;
      await as(kind==='direct'?f.direct:user,async tx=>{
        const boundary=await expire(f,kind);
        const check=()=>kind==='platform'?tx.execute(sql`select app_has_global_capability('features:manage') as allowed`):capability(tx,f);
        assert.equal((await check())[0].allowed,true,'authorized before database deadline');
        await waitPast(boundary);
        assert.equal((await check())[0].allowed,false,'new statement must lose expired authority in the same transaction');
      });
    }));
  }
  it("activates a future binding on the next statement of the same transaction",async()=>fixture(async f=>{
    await as(f.direct,async tx=>{
      const [r]=await sqlClient`update role_bindings set starts_at=clock_timestamp()+interval '0.25 seconds' where id=${f.binding} returning starts_at as boundary`;
      assert.equal((await capability(tx,f))[0].allowed,false);
      await waitPast(r.boundary);
      assert.equal((await capability(tx,f))[0].allowed,true);
    });
  }));
  it("uses one authorization instant for a normal statement that finishes after expiry",async()=>fixture(async f=>{
    await as(f.direct,async tx=>{
      const boundary=await expire(f,'direct');
      const [r]=await tx.execute(sql`with delay as materialized (select pg_sleep(0.4))
        select app_has_capability(${f.building},'devices:read','device',${f.device}) as allowed,
          clock_timestamp()>${boundary}::timestamptz as expired from delay`);
      assert.equal(r.expired,true); assert.equal(r.allowed,true,'ordinary reads retain the statement snapshot and authorization instant');
      assert.equal((await capability(tx,f))[0].allowed,false);
    });
  }));
  it("preserves null, finite, active and valid interval rules",async()=>fixture(async f=>{
    await as(f.direct,async tx=>{
      const [r]=await tx.execute(sql`select app_rbac_window(true,null,null) as unbounded,
        app_rbac_window(false,null,null) as inactive, app_rbac_window(null,null,null) as absent,
        app_rbac_window(true,'-infinity',null) as infinite_start, app_rbac_window(true,null,'infinity') as infinite_end,
        app_rbac_window(true,statement_timestamp(),statement_timestamp()) as empty,
        app_rbac_window(true,statement_timestamp()+interval '1 second',statement_timestamp()-interval '1 second') as inverted`);
      assert.deepEqual({...r},{unbounded:true,inactive:false,absent:false,infinite_start:false,infinite_end:false,empty:false,inverted:false});
      await sqlClient`delete from role_bindings where id=${f.supportBinding}`;
      assert.equal((await as(f.support,t=>capability(t,f)))[0].allowed,false,'support grant requires current global SUPPORT role');
    });
  }));
  it("denies inactive account, tenant, organization, team, role and permission",async()=>fixture(async f=>{
    const changes=[['users','id',f.worker],['buildings','id',f.building],['organizations','id',f.org],['teams','id',f.team],['roles','key','BUILDING_ADMIN'],['permissions','key','devices:read']];
    for(const [table,key,value] of changes) {
      const [original]=await sqlClient`select active from ${sqlClient(table)} where ${sqlClient(key)}=${value}`;
      try { await sqlClient`update ${sqlClient(table)} set active=false where ${sqlClient(key)}=${value}`;
        assert.equal((await as(f.worker,t=>capability(t,f)))[0].allowed,false,table);
      } finally { await sqlClient`update ${sqlClient(table)} set active=${original.active} where ${sqlClient(key)}=${value}`; }
    }
  }));
  it("expires scoped support candidates and support-grant RLS on subsequent statements",async()=>fixture(async f=>{
    await sqlClient`update support_grants set resource_type='device',resource_id=${f.device} where id=${f.grant}`;
    const telemetryGrant=randomUUID(), alertGrant=randomUUID();
    await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values
      (${telemetryGrant},${f.building},${f.support},'telemetry:read','device',${f.device},'Telemetry diagnosis',clock_timestamp()+interval '1 hour',${f.direct}),
      (${alertGrant},${f.building},${f.support},'alerts:read','alert',${f.alert},'Alert diagnosis',clock_timestamp()+interval '1 hour',${f.direct})`;
    await as(f.support,async tx=>{
      const [boundary]=await sqlClient`update support_grants set expires_at=statement_timestamp()+interval '0.4 seconds' where support_user_id=${f.support} returning expires_at as time`;
      const scopes=()=>tx.execute(sql`select app_equipment_can_read_scope(${f.building},'device') as equipment,
        (select count(*)::int from app_telemetry_authorized_devices(${f.building})) as telemetry,
        (select count(*)::int from app_alert_authorized_contexts(${f.building},${f.alert}::uuid)) as alerts,
        app_alert_can_read_feature_state(${f.building}) as feature,
        (select count(*)::int from support_grants where building_id=${f.building}) as grants`);
      assert.deepEqual({...((await scopes())[0])},{equipment:true,telemetry:1,alerts:1,feature:true,grants:3});
      await waitPast(boundary.time);
      assert.deepEqual({...((await scopes())[0])},{equipment:false,telemetry:0,alerts:0,feature:false,grants:0});
    });
  }));
  it("keeps telemetry tuple keys ordered and collision-safe and refreshes them after expiry",async()=>fixture(async f=>{
    const split=f.device.indexOf('-'), collisionBuilding=f.building+'-'+f.device.slice(0,split), collisionDevice=f.device.slice(split+1);
    // These pairs collide under delimiter concatenation; reversing a pair
    // must also never reuse the original tuple's authority.
    assert.equal(f.building+'-'+f.device,collisionBuilding+'-'+collisionDevice);
    for(const building of [f.device,collisionBuilding]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${f.org},'Adversarial tenant',${building})`;
    await sqlClient`insert into devices(id,building_id,name,type) values(${f.building},${f.device},'Reversed tuple','WATER_LEVEL_SENSOR'),(${collisionDevice},${collisionBuilding},'Delimiter collision','WATER_LEVEL_SENSOR')`;
    for(const [building,device] of [[f.building,f.device],[f.device,f.building],[collisionBuilding,collisionDevice]]) {
      await sqlClient`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value) values(statement_timestamp(),${randomUUID()},${building},${device},'water_level_percent','42'::jsonb,42)`;
    }
    await as(f.direct,async tx=>{
      const read=()=>tx.execute(sql`select building_id,device_id from telemetry`);
      assert.deepEqual([...await read()].map(r=>({...r})),[{building_id:f.building,device_id:f.device}]);
      await waitPast(await expire(f,'direct'));
      assert.equal((await read()).length,0);
    });
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.support},${f.building},'RESIDENT')`;
    assert.equal((await as(f.support,tx=>tx.execute(sql`select device_id from telemetry`))).length,0);
    assert.equal((await as(f.support,tx=>tx.execute(sql`select device_id from app_published_water_levels(${f.building})`))).length,1);
    assert.equal((await as(f.platform,tx=>tx.execute(sql`select device_id from telemetry`))).length,0);
  }));
  const privateSignatures=[
    'app_rbac_window_at(boolean,timestamptz,timestamptz,timestamptz)',
    'app_rbac_platform_role_at(text,text,timestamptz)',
    'app_rbac_team_member_at(text,uuid,timestamptz)',
    'app_has_capability_at(text,text,text,text,timestamptz)',
    'app_has_global_capability_at(text,timestamptz)',
    'app_alert_has_capability_at(text,text,text,timestamptz)',
  ];
  it("keeps explicit time helpers owned, stable and inaccessible to every non-owner ACL",async()=>{
    for(const signature of privateSignatures) {
      const [p]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,
        not exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner) as owner_only,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,
        has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,
        has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,
        pg_get_functiondef(p.oid) as definition
        from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      const pure=signature.startsWith('app_rbac_window_at(');
      assert.equal(p.owned,true); assert.equal(p.owner_only,true); assert.equal(p.app,false); assert.equal(p.identity,false); assert.equal(p.broker,false);
      assert.equal(p.prosecdef,!pure); assert.equal(p.provolatile,pure?'i':'s');
      assert.ok(p.proconfig.includes(pure?'search_path=pg_catalog':'search_path=public, pg_temp'));
      assert.ok(!p.definition.includes('clock_timestamp('),'STABLE helpers receive their instant instead of reading wall time');
    }
    for(const signature of ['app_has_capability(text,text,text,text)','app_has_global_capability(text)','app_rbac_platform_role(text,text)','app_rbac_team_member(text,uuid)','app_alert_has_capability(text,text,text)']) {
      const [p]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app from pg_proc p where p.oid=${signature}::regprocedure`;
      assert.equal(p.prosecdef,true); assert.equal(p.provolatile,'s'); assert.equal(p.app,true); assert.ok(p.proconfig.includes('search_path=public, pg_temp'));
    }
  });
  it("rejects NULL/infinite private instants and prevents a runtime caller choosing historical authority",async()=>fixture(async f=>{
    await sqlClient.begin(async owner=>{
      await owner`select set_config('app.user_id',${f.direct},true)`;
      for(const instant of [null,'infinity','-infinity']) {
        const [r]=await owner`select app_rbac_window_at(true,null,null,${instant}::timestamptz) as window,
          app_rbac_platform_role_at(${f.platform},'PLATFORM_ADMIN',${instant}::timestamptz) as platform,
          app_rbac_team_member_at(${f.building},${f.team}::uuid,${instant}::timestamptz) as team,
          app_has_capability_at(${f.building},'devices:read','device',${f.device},${instant}::timestamptz) as capability,
          app_has_global_capability_at('features:manage',${instant}::timestamptz) as global,
          app_alert_has_capability_at(${f.building},${f.alert},'alerts:read',${instant}::timestamptz) as alert`;
        assert.ok(Object.values(r).every(v=>v===false));
      }
    });
    await assert.rejects(as(f.direct,tx=>tx.execute(sql`select app_has_capability_at(${f.building},'devices:read','device',${f.device},statement_timestamp()-interval '1 hour')`)),e=>pgErrorCode(e)==='42501');
    await as(f.direct,async tx=>{
      await tx.execute(sql`select set_config('app.authorization_time','infinity',true)`);
      await waitPast(await expire(f,'direct'));
      assert.equal((await capability(tx,f))[0].allowed,false,'caller-supplied authorization time cannot preserve access');
    });
  }));
  // Pair pg_stat_activity with actual blocker/lock ownership, using a bounded poll.
  async function locked<T>(lockSql:(owner:any)=>Promise<unknown>,start:()=>Promise<T>,during:()=>Promise<void>) {
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const blockerClient=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2});
    let release!:()=>void, ready!:(pid:number)=>void, rejectReady!:(error:unknown)=>void;
    const held=new Promise<void>(r=>{release=r;}), acquired=new Promise<number>((resolve,reject)=>{ready=resolve; rejectReady=reject;});
    let timer:ReturnType<typeof setTimeout>|undefined, acquiredSuccessfully=false, failed=false, failure:unknown, result:T|undefined;
    let blockerDone:Promise<PromiseSettledResult<unknown>[]>|undefined, pendingDone:Promise<PromiseSettledResult<T>[]>|undefined;
    try {
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Fixture lock acquisition exceeded its 5 second deadline')),5000);});
      const blocker=blockerClient.begin(async owner=>{
        await owner`set local lock_timeout='2s'`; await owner`set local statement_timeout='3s'`;
        await lockSql(owner);
        const [r]=await owner`select pg_backend_pid() as pid`; ready(r.pid);
        await held;
      });
      // Observe rejections immediately and forward acquisition failure. Keep
      // the settled outcome so cleanup can report failures after ready too.
      blockerDone=Promise.allSettled([blocker]);
      void blockerDone.then(([outcome])=>{if(outcome.status==='rejected') rejectReady(outcome.reason);});
      const pid=await Promise.race([acquired,deadline]);
      acquiredSuccessfully=true; clearTimeout(timer);
      pendingDone=Promise.allSettled([Promise.resolve().then(start)]);
      let waiting=false;
      for(let i=0;i<250;i++) {
        const [r]=await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app'
          and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))
          and exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted)) as waiting`;
        if(r.waiting) { waiting=true; break; }
        await new Promise(r=>setTimeout(r,20));
      }
      assert.equal(waiting,true,'authorized operation must actually wait on the exclusive fixture lock');
      await during();
    } catch(error) {
      failed=true; failure=error;
    } finally {
      clearTimeout(timer); release();
      // This client belongs only to this fixture. Force-close it when startup
      // failed so a late connection or query cannot keep acquisition pending.
      const forcedClose=acquiredSuccessfully?[]:await Promise.allSettled([blockerClient.end({timeout:0})]);
      const [blockerOutcomes,pendingOutcomes]=await Promise.all([blockerDone??Promise.resolve([]),pendingDone??Promise.resolve([])]);
      const closed=await Promise.allSettled([blockerClient.end({timeout:1})]);
      for(const outcome of [...blockerOutcomes,...pendingOutcomes,...forcedClose,...closed]) {
        if(outcome.status==='rejected'&&!failed) { failed=true; failure=outcome.reason; }
      }
      if(pendingOutcomes[0]?.status==='fulfilled') result=pendingOutcomes[0].value;
    }
    if(failed) throw failure;
    return result as T;
  }
  function acquisitionWatchdog<T>(pending:Promise<T>,timeout=4500) {
    let timer:ReturnType<typeof setTimeout>;
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Lock acquisition did not settle within the external regression deadline')),timeout);});
    return Promise.race([pending,deadline]).finally(()=>clearTimeout(timer));
  }
  it("rejects failed blocker SQL promptly without starting the operation or retaining its lock",async()=>{
    let pid:number|undefined, started=false, during=false;
    await assert.rejects(acquisitionWatchdog(locked(async owner=>{
      const [r]=await owner`select pg_backend_pid() as pid`; pid=r.pid;
      await owner`select pg_advisory_xact_lock(814772,22)`;
      await owner`select 1/0`;
    },async()=>{started=true;},async()=>{during=true;})),e=>pgErrorCode(e)==='22012');
    assert.equal(started,false); assert.equal(during,false); assert.ok(pid);
    const [locks]=await sqlClient`select count(*)::int as count from pg_locks where pid=${pid}`;
    assert.equal(locks.count,0);
  });
  it("bounds a genuinely contended blocker acquisition and drains both transactions",async()=>{
    let holderPid:number|undefined, blockerPid:number|undefined, started=false, during=false, pending:Promise<void>|undefined;
    try {
      await sqlClient.begin(async holder=>{
        await holder`set local lock_timeout='2s'`; await holder`set local statement_timeout='3s'`;
        const [r]=await holder`select pg_backend_pid() as pid`; holderPid=r.pid;
        await holder`select pg_advisory_xact_lock(814772,21)`;
        pending=locked(async owner=>{
          const [r]=await owner`select pg_backend_pid() as pid`; blockerPid=r.pid;
          await owner`select pg_advisory_xact_lock(814772,21)`;
        },async()=>{started=true;},async()=>{during=true;});
        await assert.rejects(acquisitionWatchdog(pending),e=>pgErrorCode(e)==='55P03');
      });
    } finally {
      // The holder transaction releases before draining a potentially stalled
      // old helper, so the RED run cannot retain the fixture advisory lock.
      if(pending) await Promise.allSettled([pending]);
    }
    assert.equal(started,false); assert.equal(during,false); assert.ok(holderPid); assert.ok(blockerPid);
    const [locks]=await sqlClient`select count(*)::int as count from pg_locks where locktype='advisory' and pid in (${holderPid},${blockerPid})`;
    assert.equal(locks.count,0);
  });
  for(const kind of ['device','gateway','metric','credentials']) {
    it(`HTTP ${kind} write loses expired authority after its row lock on the same JWT`,async()=>fixture(async f=>{
      const gateway=kind==='gateway'||kind==='credentials', table=gateway?'gateways':'devices', id=gateway?f.gateway:f.device;
      // Exercise both direct binding and team member windows on real routes.
      const user=kind==='metric'||kind==='credentials'?f.worker:f.direct, source=user===f.worker?'member':'direct';
      const before=await sqlClient`select to_jsonb(t) as row from ${sqlClient(table)} t where id=${id}`;
      const response=await locked(owner=>owner`select id from ${owner(table)} where id=${id} for update`,
        ()=>kind==='credentials'?f.request(user,`/gateways/${id}/credentials`,'POST'):
          kind==='metric'?f.request(user,`/devices/${id}/metrics`,'POST',{key:'expired',label:'Expired'}):f.request(user,`/${table}/${id}`,'PATCH',{name:'Expired mutation'}),
        async()=>{await waitPast(await expire(f,source));});
      assert.equal(response.status,404,await response.clone().text());
      assert.deepEqual(await sqlClient`select to_jsonb(t) as row from ${sqlClient(table)} t where id=${id}`,before);
      assert.equal((await sqlClient`select id from device_metrics where device_id=${f.device}`).length,0);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.building}`).length,0);
    }));
  }
  for(const kind of ['read','action']) {
    it(`SQL alert transition rechecks ${kind} expiry inside one outer statement after the row lock`,async()=>fixture(async f=>{
      if(kind==='action') {
        await sqlClient`update role_bindings set role_key='MAINTENANCE' where id=${f.binding}`;
        await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.direct},${f.building},'RESIDENT')`;
        // Keep read authority separate from the timed action binding.
        await sqlClient`insert into support_grants(building_id,support_user_id,capability,reason,expires_at,granted_by) values(${f.building},${f.direct},'alerts:read','Independent read',clock_timestamp()+interval '1 hour',${f.platform})`;
        await sqlClient`insert into role_bindings(user_id,role_key) values(${f.direct},'PLATFORM_SUPPORT')`;
      }
      const before=await sqlClient`select to_jsonb(a) as row from alerts a where id=${f.alert}`;
      const code=await locked(owner=>owner`select id from alerts where id=${f.alert} for update`,
        ()=>as(f.direct,tx=>tx.execute(sql`select app_transition_alert(${f.alert}::uuid,'ACKNOWLEDGED')`)).then(()=>null,e=>pgErrorCode(e)),
        async()=>{await waitPast(await expire(f,'direct'));});
      assert.equal(code,kind==='read'?'P0002':'42501');
      assert.deepEqual(await sqlClient`select to_jsonb(a) as row from alerts a where id=${f.alert}`,before);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.building}`).length,0);
    }));
  }
  for(const feature of ['CAR_PARKING','GARAGE_ACCESS']) {
    it(`SQL ${feature} transition rechecks a timed global binding after the advisory lock`,async()=>fixture(async f=>{
    await sqlClient`insert into feature_runtime(building_id,feature_key,paused_at) values(${f.building},${feature},clock_timestamp())`;
    await sqlClient`insert into parking_lots(building_id,vehicle_type,capacity,occupied,source,observed_at) values(${f.building},'CAR',10,3,'MANUAL',clock_timestamp())`;
    const gate=randomUUID();
    await sqlClient`update devices set type='GATE_CONTROLLER' where id=${f.device}`;
    await sqlClient`insert into gates(id,building_id,name,kind,gateway_id,device_id) values(${gate},${f.building},'Fixture gate','GARAGE',${f.gateway},${f.device})`;
    await sqlClient`insert into gate_commands(request_id,gate_id,building_id,gateway_id,device_id,requested_by,expires_at) values(${randomUUID()},${gate},${f.building},${f.gateway},${f.device},${f.direct},statement_timestamp()+interval '10 seconds')`;
    const before=await sqlClient`select to_jsonb(r) as row from feature_runtime r where building_id=${f.building}`;
    const parking=await sqlClient`select to_jsonb(p) as row from parking_lots p where building_id=${f.building}`;
    const commands=await sqlClient`select to_jsonb(c) as row from gate_commands c where building_id=${f.building}`;
    const code=await locked(owner=>owner`select pg_advisory_xact_lock(814772,1)`,
      ()=>as(f.platform,tx=>tx.execute(sql`select app_apply_feature_transition(${f.building},${feature},false)`)).then(()=>null,e=>pgErrorCode(e)),
      async()=>{await waitPast(await expire(f,'platform'));});
    assert.equal(code,'42501');
    assert.deepEqual(await sqlClient`select to_jsonb(r) as row from feature_runtime r where building_id=${f.building}`,before);
    assert.deepEqual(await sqlClient`select to_jsonb(p) as row from parking_lots p where building_id=${f.building}`,parking);
    assert.deepEqual(await sqlClient`select to_jsonb(c) as row from gate_commands c where building_id=${f.building}`,commands);
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.building}`).length,0);
    }));
  }
  it("SQL feature post-lock evaluation sees committed global binding revocation",async()=>fixture(async f=>{
    const code=await locked(owner=>owner`select pg_advisory_xact_lock(814772,1)`,
      ()=>as(f.platform,tx=>tx.execute(sql`select app_apply_feature_transition(${f.building},'GAS',false)`)).then(()=>null,e=>pgErrorCode(e)),
      async()=>{await sqlClient`update role_bindings set active=false where id=${f.platformBinding}`;});
    assert.equal(code,'42501');
    assert.equal((await sqlClient`select * from feature_runtime where building_id=${f.building}`).length,0);
  }));
  it("HTTP feature editing uses a new statement after the advisory wait",async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.building},'GAS',true)`;
    const before=await sqlClient`select to_jsonb(r) as row from building_feature_settings r where building_id=${f.building}`;
    const response=await locked(owner=>owner`select pg_advisory_xact_lock(814772,1)`,
      ()=>f.request(f.platform,`/features/buildings/${f.building}/GAS`,'PUT',{enabled:false,version:1,reason:'Expired feature authority'}),
      async()=>{await waitPast(await expire(f,'platform'));});
    assert.equal(response.status,403,await response.clone().text());
    assert.deepEqual(await sqlClient`select to_jsonb(r) as row from building_feature_settings r where building_id=${f.building}`,before);
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.building}`).length,0);
  }));
  it("preserves valid controlled transitions, idempotence, conflicts and rollback",async()=>fixture(async f=>{
    const transition=(status:string)=>as(f.direct,tx=>tx.execute(sql`select app_transition_alert(${f.alert}::uuid,${status})`));
    await transition('ACKNOWLEDGED'); await transition('ACKNOWLEDGED');
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.alert}`).length,1);
    await transition('RESOLVED');
    await assert.rejects(transition('ACKNOWLEDGED'),e=>pgErrorCode(e)==='P0409');
    await as(f.platform,tx=>tx.execute(sql`select app_apply_feature_transition(${f.building},'GAS',false)`));
    const before=await sqlClient`select to_jsonb(r) as row from feature_runtime r where building_id=${f.building}`;
    await assert.rejects(as(f.platform,async tx=>{await tx.execute(sql`select app_apply_feature_transition(${f.building},'GAS',true)`); throw new Error('rollback');}),/rollback/);
    assert.deepEqual(await sqlClient`select to_jsonb(r) as row from feature_runtime r where building_id=${f.building}`,before);
  }));
});
