import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type NoticeView = { id: string; title: string; category: string; pinned: boolean; updatedAt: string; schedule: { recurrence: string } | null; nextOccurrenceAt: string | null };

describe("notices use current resource capabilities and publication windows", () => {
  let server: TestServer, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);

  async function create() {
    const suffix = randomUUID(), org = `notice-org-${suffix}`, a = `notice-a-${suffix}`, b = `notice-b-${suffix}`;
    const kinds = ["manager", "reader", "worker", "exact", "exactReader", "mixed", "resident", "platform", "flag", "support", "outsider", "actionOnly"] as const;
    const ids = Object.fromEntries(kinds.map(kind => [kind, `notice-${kind}-${suffix}`])) as Record<typeof kinds[number], string>;
    const role = `NOTICE_MANAGER_${suffix}`, readerRole = `NOTICE_READER_${suffix}`, actionRole = `NOTICE_ACTION_${suffix}`;
    const team = randomUUID(), binding = randomUUID(), exactBinding = randomUUID();
    const published = randomUUID(), future = randomUUID(), expired = randomUUID(), governance = randomUUID(), foreign = randomUUID();
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Notice capabilities',${org})`;
    for (const building of [a,b]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},${building},${building})`;
    for (const [kind,id] of Object.entries(ids)) await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id+'@notices.test'},${passwordHash},${kind==='flag'})`;
    for (const key of [role,readerRole,actionRole]) await sqlClient`insert into roles(key,scope,label) values(${key},'BUILDING',${key})`;
    await sqlClient`insert into role_permissions(role_key,permission_key) values(${role},'notices:read'),(${role},'notices:manage'),(${readerRole},'notices:read'),(${actionRole},'notices:manage')`;
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Notice team')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${role})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.reader},${a},${readerRole}),(${ids.actionOnly},${a},${actionRole})`;
    await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${role})`;
    await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN'),(${ids.support},'PLATFORM_SUPPORT')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.mixed},${a},'BUILDING_ADMIN'),(${ids.mixed},${b},'RESIDENT'),(${ids.resident},${a},'RESIDENT')`;
    await sqlClient`insert into notices(id,building_id,title,body,published_at,expires_at,pinned,category,created_by) values
      (${published},${a},'Published private notice','Private published body',statement_timestamp()-interval '1 hour',null,true,'COMMUNICATION',${ids.manager}),
      (${future},${a},'Future private notice','Private future body',statement_timestamp()+interval '1 day',null,false,'EVENT',${ids.manager}),
      (${expired},${a},'Expired private notice','Private expired body',statement_timestamp()-interval '2 day',statement_timestamp()-interval '1 day',false,'COMMUNICATION',${ids.manager}),
      (${governance},${a},'Management report notice','Private transparency body',statement_timestamp()-interval '1 hour',null,false,'GESTAO',${ids.manager}),
      (${foreign},${b},'Foreign private notice','Another tenant body',statement_timestamp()-interval '1 hour',null,false,'COMMUNICATION',${ids.mixed})`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${exactBinding},${ids.exact},${a},${role},'notice',${future})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${ids.exactReader},${a},${readerRole},'notice',${published})`;
    for (const notice of [published,future,expired,governance]) await sqlClient`insert into notice_schedules(notice_id,building_id,starts_at,recurrence,time_zone) values(${notice},${a},statement_timestamp()+interval '2 day',${notice===future?'WEEKLY':'NONE'},'America/Sao_Paulo')`;
    const tokens = new Map<string,string>();
    for (const id of Object.values(ids)) tokens.set(id,(await login(server.url,id+'@notices.test')).accessToken);
    const request = (user: string, path: string, method='GET', body?: unknown) => call(server.url,path,{token:tokens.get(user),method,body});
    const list = (user=ids.manager, flags='', building=a) => request(user,`/notices?buildingId=${building}${flags}`);
    return {org,a,b,ids,role,readerRole,actionRole,team,binding,exactBinding,published,future,expired,governance,foreign,request,list};
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); } finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(f.ids))}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(f.ids))}`;
      await sqlClient`delete from roles where key in ${sqlClient([f.role,f.readerRole,f.actionRole])}`;
    }
  }
  async function items(response: Response) {
    const body = await response.json() as {items: NoticeView[]};
    assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(response.headers.get('cache-control'),'no-store');
    return body.items;
  }
  const newNotice = (buildingId: string) => ({buildingId,title:'New authorized notice',body:'This is the announcement body.'});
  const raw = (user: string, building: string) => as(user,tx=>tx.execute(sql`select id from notices where building_id=${building}`));

  it("allows RBAC-only people and teams while hiding future/expired notices and schedules from readers",async()=>fixture(async f=>{
    for (const user of [f.ids.manager,f.ids.worker]) {
      assert.equal((await f.request(user,'/notices','POST',newNotice(f.a))).status,201);
      assert.equal((await items(await f.list(user,'&includeUnpublished=true&includeExpired=true'))).length,user===f.ids.manager?5:6);
    }
    for (const user of [f.ids.reader,f.ids.resident]) {
      const rows=await items(await f.list(user));
      assert.equal(rows[0]!.id,f.published,'pinned first');
      assert.ok(!rows.some(row=>[f.future,f.expired].includes(row.id)));
      const ids=(await raw(user,f.a)).map(row=>row.id);
      assert.ok(!ids.includes(f.future)&&!ids.includes(f.expired));
      const schedules=await as(user,tx=>tx.execute(sql`select notice_id from notice_schedules where building_id=${f.a}`));
      assert.deepEqual(schedules.map(row=>row.notice_id).sort(),[f.published,f.governance].sort());
      assert.equal((await f.list(user,'&includeUnpublished=true')).status,403);
      assert.equal((await f.list(user,'&includeExpired=true')).status,403);
      assert.equal((await f.request(user,`/notices/${f.published}`,'PATCH',{title:'Reader edit'})).status,403);
      assert.equal((await f.request(user,`/notices/${f.future}`,'PATCH',{title:'Hidden edit'})).status,404);
    }
  }));

  it("keeps an exact grant scoped to its real notice for administrative reads, writes and schedules",async()=>fixture(async f=>{
    const rows=await items(await f.list(f.ids.exact,'&includeUnpublished=true&includeExpired=true'));
    assert.deepEqual(rows.map(row=>row.id),[f.future]); assert.equal(rows[0]!.schedule!.recurrence,'WEEKLY'); assert.ok(rows[0]!.nextOccurrenceAt);
    assert.equal((await f.request(f.ids.exact,'/notices','POST',newNotice(f.a))).status,403);
    assert.equal((await f.request(f.ids.exact,`/notices/${f.published}`,'PATCH',{title:'Cross resource'})).status,404);
    assert.equal((await f.request(f.ids.exact,`/notices/${f.future}`,'PATCH',{title:'Exact edit',schedule:{startsAt:new Date(Date.now()+3_600_000).toISOString(),recurrence:'NONE',timeZone:'UTC'}})).status,200);
    assert.deepEqual((await raw(f.ids.exactReader,f.a)).map(row=>row.id),[f.published]);
    assert.equal((await f.list(f.ids.exactReader,'&includeUnpublished=true')).status,403);
    assert.equal((await f.request(f.ids.exact,`/notices/${f.future}`,'DELETE')).status,204);
    const audit=await sqlClient`select action from audit_logs where resource_id=${f.future} order by created_at`;
    assert.deepEqual(audit.map(row=>row.action),['NOTICE_UPDATED','NOTICE_DELETED']);
    assert.equal((await sqlClient`select notice_id from notice_schedules where notice_id=${f.future}`).length,0);
  }));

  it("does not infer private authority from platform flags, support, app.role or another tenant",async()=>fixture(async f=>{
    for(const user of [f.ids.platform,f.ids.flag,f.ids.support,f.ids.outsider,f.ids.actionOnly]) {
      assert.equal((await f.list(user)).status,403,user);
      assert.equal((await raw(user,f.a)).length,0);
      assert.equal((await f.request(user,'/notices','POST',newNotice(f.a))).status,403);
      assert.equal((await f.request(user,`/notices/${f.published}`,'DELETE')).status,404);
    }
    assert.equal((await f.list(f.ids.manager,'',f.b)).status,403);
    assert.equal((await f.request(f.ids.mixed,`/notices/${f.foreign}`,'PATCH',{title:'Wrong building authority'})).status,403);
    for(const id of ['not-a-uuid',randomUUID()]) assert.equal((await f.request(f.ids.manager,`/notices/${id}`,'PATCH',{title:'Invalid resource'})).status,404);
    const [bad]=await as(f.ids.manager,tx=>tx.execute(sql`select app_notice_has_capability(${f.a},'bad-uuid','notices:read') as malformed, app_notice_has_capability(${f.a},${f.foreign},'notices:read') as foreign_resource, app_notice_has_capability(${f.a},${f.published},'devices:read') as wrong_capability`));
    assert.deepEqual({...bad},{malformed:false,foreign_resource:false,wrong_capability:false});
  }));

  it("preserves feature pause and separate TRANSPARENCY state without buildings:read",async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'NOTICES',false)`;
    const [state]=await as(f.ids.reader,tx=>tx.execute(sql`select enabled from building_feature_settings where building_id=${f.a} and feature_key='NOTICES'`));
    assert.equal(state!.enabled,false);
    assert.deepEqual((await items(await f.list(f.ids.reader))).map(row=>row.id),[f.governance]);
    assert.equal((await f.list(f.ids.reader,'&category=COMMUNICATION')).status,403);
    assert.equal((await f.request(f.ids.manager,'/notices','POST',newNotice(f.a))).status,403);
    assert.equal((await f.request(f.ids.manager,`/notices/${f.published}`,'PATCH',{title:'Paused'})).status,403);
    assert.equal((await f.request(f.ids.manager,`/notices/${f.governance}`,'PATCH',{title:'Transparency still enabled'})).status,200);
    const [event]=await as(f.ids.reader,tx=>tx.execute(sql`select app_can_read_feature_event(${f.a}) as allowed`)); assert.equal(event!.allowed,true);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'TRANSPARENCY',false)`;
    assert.deepEqual(await items(await f.list(f.ids.reader)),[]);
  }));

  it("prevents identity, tenant and creator changes by raw runtime SQL and requires both permissions",async()=>fixture(async f=>{
    for (const assignment of [sql`id=${randomUUID()}::uuid`,sql`building_id=${f.b}`,sql`created_by=${f.ids.reader}`,sql`created_at=statement_timestamp()`]) {
      await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`update notices set ${assignment} where id=${f.published}::uuid`)),e=>pgErrorCode(e)==='42501');
    }
    for (const assignment of [sql`notice_id=${f.governance}::uuid`,sql`building_id=${f.b}`]) await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`update notice_schedules set ${assignment} where notice_id=${f.published}::uuid`)),e=>pgErrorCode(e)==='42501');
    await assert.rejects(as(f.ids.actionOnly,tx=>tx.execute(sql`insert into notices(building_id,title,body,created_by) values(${f.a},'No read','Cannot create',${f.ids.actionOnly})`)),e=>pgErrorCode(e)==='42501');
    await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`insert into notices(building_id,title,body,created_by) values(${f.a},'Wrong creator','Cannot impersonate',${f.ids.reader})`)),e=>pgErrorCode(e)==='42501');
    for(const action of ['NOTICE_SCHEDULED','NOTICE_PUBLISHED','NOTICE_UPDATED','NOTICE_DELETED']) {
      await assert.rejects(as(f.ids.flag,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${f.ids.flag},${action},'notice',${f.published})`)),e=>pgErrorCode(e)==='42501');
      for(const target of ['malformed',f.foreign]) await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${f.ids.manager},${action},'notice',${target})`)),e=>pgErrorCode(e)==='42501');
    }
  }));

  it("hides a schedule whose notice was moved by the owner to another tenant",async()=>fixture(async f=>{
    await sqlClient`update notices set building_id=${f.b} where id=${f.published}`;
    assert.equal((await as(f.ids.manager,tx=>tx.execute(sql`select * from notice_schedules where notice_id=${f.published}::uuid`))).length,0);
    const row=(await items(await f.list(f.ids.mixed,'',f.b))).find(row=>row.id===f.published)!;
    assert.equal(row.schedule,null);
  }));

  async function waitPast(boundary: unknown) {
    for(let i=0;i<100;i++) {
      const [row]=await sqlClient`select clock_timestamp()>${boundary as Date}::timestamptz as expired`;
      if(row!.expired)return;
      await sqlClient`select pg_sleep(0.02)`;
    }
    assert.fail('database deadline did not pass within the bounded wait');
  }
  it("publication and expiry advance between statements inside one transaction",async()=>fixture(async f=>{
    await as(f.ids.reader,async tx=>{
      const [future]=await sqlClient`update notices set published_at=clock_timestamp()+interval '0.25 seconds' where id=${f.future} returning published_at as boundary`;
      const read=()=>tx.execute(sql`select id from notices where id=${f.future}::uuid`);
      assert.equal((await read()).length,0); await waitPast(future!.boundary); assert.equal((await read()).length,1);
      const [expired]=await sqlClient`update notices set expires_at=clock_timestamp()+interval '0.25 seconds' where id=${f.future} returning expires_at as boundary`;
      assert.equal((await read()).length,1); await waitPast(expired!.boundary); assert.equal((await read()).length,0);
      assert.equal((await tx.execute(sql`select notice_id from notice_schedules where notice_id=${f.future}::uuid`)).length,0);
    });
  }));

  it("rechecks revocation, time windows and all active parents on the same JWT",async()=>fixture(async f=>{
    const changes=[['users','id',f.ids.worker],['buildings','id',f.a],['organizations','id',f.org],['teams','id',f.team],['roles','key',f.role],['permissions','key','notices:read']];
    for(const [table,key,value] of changes) {
      const [original]=await sqlClient`select active from ${sqlClient(table!)} where ${sqlClient(key!)}=${value!}`;
      try {
        await sqlClient`update ${sqlClient(table!)} set active=false where ${sqlClient(key!)}=${value!}`;
        assert.ok([401,403].includes((await f.list(f.ids.worker)).status),table);
        assert.equal((await raw(f.ids.worker,f.a)).length,0,table);
      } finally { await sqlClient`update ${sqlClient(table!)} set active=${original!.active} where ${sqlClient(key!)}=${value!}`; }
    }
    await sqlClient`update team_members set active=false where team_id=${f.team}`;
    assert.equal((await f.list(f.ids.worker)).status,403);
    await sqlClient`update role_bindings set ends_at=statement_timestamp()-interval '1 second' where id=${f.binding}`;
    assert.equal((await f.list()).status,403);
    await sqlClient`update role_bindings set active=false where id=${f.exactBinding}`;
    assert.equal((await f.list(f.ids.exact,'&includeUnpublished=true')).status,403);
  }));

  it("requires read and manage independently after removing a role permission",async()=>fixture(async f=>{
    for(const permission of ['notices:manage','notices:read']) {
      const [original]=await sqlClient`select role_key,permission_key,created_at::text as created_at from role_permissions where role_key=${f.role} and permission_key=${permission}`;
      try {
        await sqlClient`delete from role_permissions where role_key=${f.role} and permission_key=${permission}`;
        assert.equal((await f.request(f.ids.manager,`/notices/${f.published}`,'PATCH',{title:'Revoked permission'})).status,permission==='notices:read'?404:403);
        assert.equal((await f.request(f.ids.manager,'/notices','POST',newNotice(f.a))).status,403);
        assert.equal((await f.list(f.ids.manager,'&includeUnpublished=true')).status,403);
      } finally {
        // Keep PostgreSQL's complete timestamp precision when restoring catalogs.
        await sqlClient`insert into role_permissions(role_key,permission_key,created_at) values(${original!.role_key},${original!.permission_key},${original!.created_at}::timestamptz)`;
      }
      const [restored]=await sqlClient`select role_key,permission_key,created_at::text as created_at from role_permissions where role_key=${f.role} and permission_key=${permission}`;
      assert.deepEqual(restored,original);
    }
  }));

  it("checks expectedUpdatedAt and keeps NONE/WEEKLY schedule edits atomic",async()=>fixture(async f=>{
    const current=(await items(await f.list())).find(row=>row.id===f.published)!;
    const responses=await Promise.all(['First edit','Second edit'].map(title=>f.request(f.ids.manager,`/notices/${f.published}`,'PATCH',{title,expectedUpdatedAt:current.updatedAt})));
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal((await f.request(f.ids.manager,`/notices/${f.published}`,'PATCH',{expiresAt:'2000-01-01T00:00:00Z'})).status,400);
    assert.equal((await f.request(f.ids.manager,`/notices/${f.published}`,'PATCH',{schedule:{startsAt:new Date().toISOString(),recurrence:'WEEKLY',timeZone:'Invalid/Zone'}})).status,400);
    assert.equal((await f.request(f.ids.manager,`/notices/${f.published}`,'PATCH',{schedule:null})).status,200);
    assert.equal((await sqlClient`select notice_id from notice_schedules where notice_id=${f.published}`).length,0);
  }));

  // A dedicated owner connection makes lock acquisition bounded and observable;
  // release and both outcomes are drained even when the test assertion fails.
  async function locked<T>(f: Fixture, start:()=>Promise<T>, during:()=>Promise<void>) {
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const blockerClient=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2});
    let release!:()=>void, ready!:(pid:number)=>void, rejectReady!:(error:unknown)=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}), acquired=new Promise<number>((resolve,reject)=>{ready=resolve;rejectReady=reject;});
    let timeout:ReturnType<typeof setTimeout>|undefined, started=false;
    let pending:Promise<PromiseSettledResult<T>[]>|undefined;
    const blocker=Promise.allSettled([blockerClient.begin(async owner=>{
      await owner`set local lock_timeout='2s'`; await owner`set local statement_timeout='3s'`;
      await owner`select id from notices where id=${f.published} for update`;
      const [row]=await owner`select pg_backend_pid() as pid`; ready(row!.pid); await held;
    })]);
    void blocker.then(([result])=>{if(result!.status==='rejected')rejectReady(result.reason);});
    let response:T|undefined;
    try {
      const pid=await Promise.race([acquired,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Notice fixture lock timeout')),5000);})]);
      clearTimeout(timeout); started=true;
      pending=Promise.allSettled([Promise.resolve().then(start)]);
      let waiting=false;
      for(let i=0;i<250;i++) {
        const [row]=await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`;
        if(row!.waiting){waiting=true;break;} await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,true,'request must really wait on the notice row'); await during();
    } finally {
      clearTimeout(timeout); release();
      if(!started)await blockerClient.end({timeout:0});
      const [blockerResults,results]=await Promise.all([blocker,pending??Promise.resolve([])]);
      await blockerClient.end({timeout:1});
      for(const result of [...blockerResults,...results])if(result.status==='rejected')throw result.reason;
      if(results[0]?.status==='fulfilled')response=results[0].value;
    }
    return response as T;
  }
  for(const kind of ['person-expiry','person-revocation','team-expiry','team-revocation','management-revocation'] as const) {
    it(`revalidates ${kind} after a real row lock before mutation/audit`,async()=>fixture(async f=>{
      const before=await sqlClient`select to_jsonb(n) as row from notices n where id=${f.published}`;
      const team=kind.startsWith('team');
      const response=await locked(f,()=>f.request(team?f.ids.worker:f.ids.manager,`/notices/${f.published}`,team?'DELETE':'PATCH',{title:'Should never persist'}),async()=>{
        if(kind==='team-revocation')await sqlClient`update team_members set active=false where team_id=${f.team}`;
        else if(kind==='person-revocation')await sqlClient`update role_bindings set active=false where id=${f.binding}`;
        else if(kind==='management-revocation')await sqlClient`delete from role_permissions where role_key=${f.role} and permission_key='notices:manage'`;
        else if(kind==='team-expiry'){const [row]=await sqlClient`update team_members set ends_at=clock_timestamp()+interval '0.1 seconds' where team_id=${f.team} returning ends_at`; await waitPast(row!.ends_at);}
        else {const [row]=await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 seconds' where id=${f.binding} returning ends_at`; await waitPast(row!.ends_at);}
      });
      assert.equal(response.status,kind==='management-revocation'?403:404,await response.clone().text());
      assert.deepEqual(await sqlClient`select to_jsonb(n) as row from notices n where id=${f.published}`,before);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
      assert.equal((await sqlClient`select notice_id from notice_schedules where notice_id=${f.published}`).length,1);
    }));
  }

  it("rolls back notice, schedule and delete when audit insertion fails without logging content",async t=>fixture(async f=>{
    const errorLog=t.mock.method(console,'error',()=>undefined);
    const name='notice_audit_failure_'+randomUUID().replaceAll('-','');
    // Identifiers and the actor literal are generated only by this fixture.
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.user_id=TG_ARGV[0] then raise exception 'audit fixture rejected'; end if; return NEW; end $$`);
    await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.ids.manager}')`);
    try {
      const original=await sqlClient`select to_jsonb(n) as row from notices n where id=${f.published}`;
      const schedule=await sqlClient`select to_jsonb(s) as row from notice_schedules s where notice_id=${f.published}`;
      for(const [method,body] of [['PATCH',{title:'Sensitive rejected title',body:'Sensitive rejected body',schedule:null}],['DELETE',undefined]] as const) {
        const response=await f.request(f.ids.manager,`/notices/${f.published}`,method,body);
        assert.equal(response.status,500); assert.ok(!(await response.text()).includes('Sensitive'));
        assert.deepEqual(await sqlClient`select to_jsonb(n) as row from notices n where id=${f.published}`,original);
        assert.deepEqual(await sqlClient`select to_jsonb(s) as row from notice_schedules s where notice_id=${f.published}`,schedule);
      }
      const before=await sqlClient`select id from notices where building_id=${f.a}`;
      assert.equal((await f.request(f.ids.manager,'/notices','POST',{...newNotice(f.a),schedule:{startsAt:new Date().toISOString(),recurrence:'NONE',timeZone:'UTC'}})).status,500);
      assert.deepEqual(await sqlClient`select id from notices where building_id=${f.a}`,before);
      assert.equal(errorLog.mock.callCount(),0,'private SQL/parameters must not reach the global error logger');
    } finally { await sqlClient.unsafe(`drop trigger ${name} on audit_logs`); await sqlClient.unsafe(`drop function ${name}()`); }
  }));

  it("keeps helpers stable, private to runtime and owned by the authorization owner",async()=>fixture(async f=>{
    for(const signature of ['app_notice_has_capability(text,text,text)','app_notice_can_read(text,text)','app_notice_can_read_scope(text,boolean)','app_notice_can_read_feature_state(text)']) {
      const [row]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,
        has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,
        has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker,
        exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
        from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(row!.prosecdef,true); assert.equal(row!.provolatile,'s'); assert.equal(row!.owned,true); assert.ok(row!.proconfig.includes('search_path=public, pg_temp'));
      assert.equal(row!.app,true); assert.equal(row!.identity,false); assert.equal(row!.broker,false); assert.equal(row!.public_execute,false);
    }
    const [acl]=await sqlClient`select has_table_privilege('predioon_app','notices','UPDATE') as table_update,
      has_column_privilege('predioon_app','notices','title','UPDATE') as title_update,
      has_column_privilege('predioon_app','notices','building_id','UPDATE') as tenant_update,
      has_column_privilege('predioon_app','notice_schedules','notice_id','UPDATE') as schedule_identity`;
    assert.deepEqual({...acl},{table_update:false,title_update:true,tenant_update:false,schedule_identity:false});
    assert.equal((await as(f.ids.exactReader,tx=>tx.execute(sql`select app_notice_can_read_feature_state(${f.a}) as allowed`)))[0]!.allowed,true);
  }));

  it("captures real point and feature-state plans without forcing planner flags",async t=>fixture(async f=>{
    const [point]=await as(f.ids.exactReader,tx=>tx.execute(sql`explain (format json) select id from notices where id=${f.published}::uuid`));
    const [scope]=await sqlClient`select prosrc from pg_proc where oid='app_notice_can_read_scope(text,boolean)'::regprocedure`;
    // Explain the stored SQL body itself so the state plan is not hidden behind
    // the SECURITY DEFINER function's opaque outer Result node. Bind its inputs.
    const body=String(scope!.prosrc).replaceAll('target_building_id','$1').replaceAll('require_management','$2');
    const [state]=await sqlClient.begin(async owner=>{
      await owner`select set_config('app.user_id',${f.ids.exactReader},true)`;
      return owner.unsafe(`explain (format json) ${body}`,[f.a,false]);
    });
    assert.ok(point?.['QUERY PLAN']); assert.ok(state?.['QUERY PLAN']);
    t.diagnostic(`point plan: ${JSON.stringify(point!['QUERY PLAN'])}`);
    t.diagnostic(`feature-state plan: ${JSON.stringify(state!['QUERY PLAN'])}`);
  }));
});
