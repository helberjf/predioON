import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { sqlClient } from '@predioon/db';
import { closeAppDb, withUserContext } from '@predioon/db/runtime';
import { hashPassword } from '../src/auth/passwords.js';
import { pgErrorCode } from '../src/http/errors.js';
import { call, login, startTestServer, type TestServer } from './helpers.js';

describe('occurrences use current capabilities and private requester timelines', () => {
  let server: TestServer, passwordHash: string;
  before(async () => { passwordHash = await hashPassword('predioon123'); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: 'PLATFORM_ADMIN' }, run);
  const input = (buildingId: string) => ({ buildingId, category: 'GENERAL', title: 'Private request', description: 'Private description', priority: 'HIGH' });
  async function create() {
    const suffix=randomUUID(), org=`occ-org-${suffix}`, a=`occ-a-${suffix}`, b=`occ-b-${suffix}`;
    const names=['resident','neighbor','manager','worker','exact','reader','creator','assigned','platform','support','outsider','discovery'] as const;
    const ids=Object.fromEntries(names.map(name=>[name,`occ-${name}-${suffix}`])) as Record<typeof names[number],string>;
    const role=`OCC_MANAGER_${suffix}`, ownRole=`OCC_OWN_${suffix}`, readRole=`OCC_READ_${suffix}`, createRole=`OCC_CREATE_${suffix}`, discoveryRole=`OCC_DISCOVERY_${suffix}`;
    const team=randomUUID(), binding=randomUUID(), ownBinding=randomUUID(), exactBinding=randomUUID(), group=randomUUID();
    const own=randomUUID(), neighbor=randomUUID(), closed=randomUUID(), solo=randomUUID(), second=randomUUID(), foreign=randomUUID();
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Occurrences fixture',${org})`;
    for(const building of [a,b]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},${building},${building})`;
    for(const id of Object.values(ids)) await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${id},${id+'@occurrences.test'},${passwordHash},${id===ids.platform})`;
    for(const key of [role,ownRole,readRole,createRole,discoveryRole]) await sqlClient`insert into roles(key,scope,label) values(${key},'BUILDING',${key})`;
    await sqlClient`insert into role_permissions(role_key,permission_key) values(${role},'occurrences:manage'),(${ownRole},'occurrences:read-own'),(${ownRole},'occurrences:create-own'),(${readRole},'occurrences:read-own'),(${createRole},'occurrences:create-own'),(${discoveryRole},'buildings:read')`;
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${role}),(${ownBinding},${ids.resident},${a},${ownRole})`;
    for(const user of [ids.neighbor,ids.assigned]) await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${user},${a},${ownRole})`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.neighbor},${b},${ownRole}),(${ids.reader},${a},${readRole}),(${ids.creator},${a},${createRole}),(${ids.discovery},${a},${discoveryRole})`;
    await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.support},'PLATFORM_SUPPORT')`;
    await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Call management')`;
    await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
    await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${role})`;
    for(const [id,building,author,groupId,state] of [[own,a,ids.resident,group,'OPEN'],[neighbor,a,ids.neighbor,group,'OPEN'],[closed,a,ids.neighbor,group,'DONE'],[solo,a,ids.neighbor,null,'OPEN'],[second,a,ids.neighbor,null,'OPEN'],[foreign,b,ids.neighbor,null,'OPEN']] as const) {
      await sqlClient`insert into occurrences(id,building_id,protocol,title,description,category,opened_by,group_id,status,closed_at,assigned_to) values(${id},${building},${'FIX-'+id},'Same topic','Private description','GENERAL',${author},${groupId},${state},${state==='DONE'?'2026-01-01T00:00:00Z':null}::timestamptz,${ids.assigned})`;
      await sqlClient`insert into occurrence_events(occurrence_id,building_id,author_id,kind,message) values(${id},${building},${author},'COMMENT',${'private-'+id})`;
    }
    await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${exactBinding},${ids.exact},${a},${role},'occurrence',${own})`;
    const tokens=new Map<string,string>();
    for(const id of Object.values(ids)) tokens.set(id,(await login(server.url,id+'@occurrences.test')).accessToken);
    const request=(user:string,path:string,method='GET',body?:unknown)=>call(server.url,path,{token:tokens.get(user),method,body});
    return {org,a,b,ids,role,ownRole,readRole,createRole,discoveryRole,team,binding,ownBinding,exactBinding,group,own,neighbor,closed,solo,second,foreign,request};
  }
  type Fixture=Awaited<ReturnType<typeof create>>;
  async function fixture(run:(f:Fixture)=>Promise<void>) {
    const f=await create(); try {await run(f);} finally {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(f.ids))}`;
      await sqlClient`delete from buildings where organization_id=${f.org}`;
      await sqlClient`delete from organizations where id=${f.org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(f.ids))}`;
      await sqlClient`delete from roles where key in ${sqlClient([f.role,f.ownRole,f.readRole,f.createRole,f.discoveryRole])}`;
    }
  }
  async function status(response:Response,code:number) {const body=await response.json();assert.equal(response.status,code,JSON.stringify(body));return body;}
  const list=(f:Fixture,user:string,extra='')=>f.request(user,`/occurrences?buildingId=${f.a}${extra}`);
  const raw=(user:string)=>as(user,tx=>tx.execute(sql`select id from occurrences`));

  it('opens and reads own requests without a legacy membership and never exposes assigned or grouped neighbors',async()=>fixture(async f=>{
    const created=await status(await f.request(f.ids.resident,'/occurrences','POST',input(f.a)),201);
    assert.equal(created.openedBy,f.ids.resident); assert.ok(created.protocol);
    const items=(await status(await list(f,f.ids.resident),200)).items;
    assert.deepEqual(items.map((r:{id:string})=>r.id).sort(),[f.own,created.id].sort());
    const detail=await status(await f.request(f.ids.resident,`/occurrences/${f.own}`),200);
    assert.equal(detail.timeline.length,1);assert.equal(detail.timeline[0].message,'private-'+f.own);
    for(const id of [f.neighbor,f.foreign])await status(await f.request(f.ids.resident,`/occurrences/${id}`),404);
    assert.deepEqual((await status(await list(f,f.ids.assigned),200)).items,[]);
    assert.deepEqual((await raw(f.ids.resident)).map(row=>row.id).sort(),[f.own,created.id].sort());
  }));
  it('separates read-own, create-own, management and basic discovery without global private access',async()=>fixture(async f=>{
    assert.deepEqual((await status(await list(f,f.ids.reader),200)).items,[]);
    for(const user of [f.ids.reader,f.ids.creator,f.ids.manager,f.ids.exact])await status(await f.request(user,'/occurrences','POST',input(f.a)),403);
    for(const user of [f.ids.creator,f.ids.discovery,f.ids.platform,f.ids.support,f.ids.outsider]) {
      await status(await list(f,user),403); await status(await f.request(user,`/occurrences/${f.own}`),404); assert.equal((await raw(user)).length,0);
    }
    await status(await f.request(f.ids.resident,'/occurrences/not-uuid'),400);
  }));
  it('allows whole and team management but exact grants cannot mutate a hidden part of a group',async()=>fixture(async f=>{
    for(const user of [f.ids.manager,f.ids.worker]) assert.equal((await status(await list(f,user),200)).items.length,5);
    assert.deepEqual((await status(await list(f,f.ids.exact),200)).items.map((r:{id:string})=>r.id),[f.own]);
    await status(await f.request(f.ids.exact,`/occurrences/${f.neighbor}`,'PATCH',{status:'DONE'}),404);
    for(const [path,method,body] of [[`/occurrences/${f.own}`,'PATCH',{status:'DONE',applyToGroup:true}],[`/occurrences/${f.own}/comments`,'POST',{message:'Must not partially copy',applyToGroup:true}]] as const) await status(await f.request(f.ids.exact,path,method,body),403);
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    await status(await f.request(f.ids.exact,`/occurrences/${f.own}`,'PATCH',{priority:'HIGH',priorityReason:'Urgent repair needed'}),200);
  }));
  it('comments and cancels only own open requests without gaining administrative SQL UPDATE',async()=>fixture(async f=>{
    await status(await f.request(f.ids.resident,`/occurrences/${f.own}/comments`,'POST',{message:'Own progress message'}),201);
    assert.equal((await as(f.ids.resident,tx=>tx.execute(sql`update occurrences set priority='HIGH' where id=${f.own}::uuid returning id`))).length,0);
    await status(await f.request(f.ids.resident,`/occurrences/${f.own}`,'PATCH',{priority:'HIGH',priorityReason:'Not administrative'}),403);
    const cancelled=await status(await f.request(f.ids.resident,`/occurrences/${f.own}`,'PATCH',{status:'CANCELLED'}),200);
    assert.equal(cancelled.status,'CANCELLED');assert.ok(cancelled.closedAt);
    await status(await f.request(f.ids.resident,`/occurrences/${f.own}`,'PATCH',{status:'CANCELLED'}),409);
    const events=await sqlClient`select kind,author_id,message from occurrence_events where occurrence_id=${f.own} order by created_at`;
    assert.equal(events.filter(e=>e.kind==='STATUS_CHANGED').length,1); assert.equal(events.at(-1)!.author_id,f.ids.resident);
  }));
  it('preserves closed neighbors, closed_at and private event recipients during collective management',async()=>fixture(async f=>{
    const before=await sqlClient`select to_jsonb(o) as row from occurrences o where id=${f.closed}`;
    await status(await f.request(f.ids.worker,`/occurrences/${f.own}`,'PATCH',{status:'DONE',applyToGroup:true}),200);
    assert.deepEqual(await sqlClient`select to_jsonb(o) as row from occurrences o where id=${f.closed}`,before);
    const [closed]=await sqlClient`select closed_at::text as closed_at from occurrences where id=${f.own}`;
    await status(await f.request(f.ids.manager,`/occurrences/${f.own}`,'PATCH',{priority:'HIGH',priorityReason:'Record severity'}),200);
    assert.equal((await sqlClient`select closed_at::text as closed_at from occurrences where id=${f.own}`)[0]!.closed_at,closed!.closed_at);
    await status(await f.request(f.ids.worker,`/occurrences/${f.own}/comments`,'POST',{message:'Shared public response',applyToGroup:true}),201);
    const timeline=(await status(await f.request(f.ids.resident,`/occurrences/${f.own}`),200)).timeline;
    assert.ok(timeline.every((e:{occurrenceId:string})=>e.occurrenceId===f.own));
    assert.equal(timeline.filter((e:{message:string})=>e.message==='Shared public response').length,1);
  }));
  it('validates manual grouping and duplicate suggestions against every real manageable ticket',async()=>fixture(async f=>{
    await status(await f.request(f.ids.exact,'/occurrences/group','POST',{buildingId:f.a,occurrenceIds:[f.own,f.solo]}),404);
    await status(await f.request(f.ids.manager,'/occurrences/group','POST',{buildingId:f.a,occurrenceIds:[f.solo,f.foreign]}),404);
    await status(await f.request(f.ids.manager,'/occurrences/group','POST',{buildingId:f.a,occurrenceIds:[f.own,f.solo]}),409);
    assert.deepEqual((await status(await f.request(f.ids.exact,`/occurrences/duplicates?buildingId=${f.a}`),200)).items,[]);
    const grouped=await status(await f.request(f.ids.worker,'/occurrences/group','POST',{buildingId:f.a,occurrenceIds:[f.solo,f.second]}),201);
    assert.equal(grouped.count,2); assert.ok(grouped.groupId);
    await status(await f.request(f.ids.worker,'/occurrences/group','POST',{buildingId:f.a,occurrenceIds:[f.solo,f.second]}),409);
  }));
  it('hides inconsistent timeline parents and blocks forged actor, tenant, audit and identity writes',async()=>fixture(async f=>{
    await sqlClient`insert into occurrence_events(occurrence_id,building_id,author_id,kind,message) values(${f.own},${f.b},${f.ids.neighbor},'COMMENT','Cross-tenant poison')`;
    assert.equal((await status(await f.request(f.ids.manager,`/occurrences/${f.own}`),200)).timeline.length,1);
    for(const assignment of [sql`id=${randomUUID()}::uuid`,sql`building_id=${f.b}`,sql`opened_by=${f.ids.manager}`,sql`protocol='forged'`,sql`description='forged'`,sql`created_at=statement_timestamp()`]) await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`update occurrences set ${assignment} where id=${f.own}::uuid`)),e=>pgErrorCode(e)==='42501');
    for(const statement of [sql`insert into occurrence_events(occurrence_id,building_id,author_id,kind) values(${f.own}::uuid,${f.b},${f.ids.manager},'COMMENT')`,sql`insert into occurrence_events(occurrence_id,building_id,author_id,kind) values(${f.own}::uuid,${f.a},${f.ids.neighbor},'COMMENT')`,sql`delete from occurrences where id=${f.own}::uuid`,sql`update occurrence_events set message='forged'`,sql`delete from occurrence_events`])await assert.rejects(as(f.ids.manager,tx=>tx.execute(statement)),e=>pgErrorCode(e)==='42501');
    await assert.rejects(as(f.ids.resident,tx=>tx.execute(sql`insert into occurrence_events(occurrence_id,building_id,author_id,kind) values(${f.own}::uuid,${f.a},${f.ids.resident},'STATUS_CHANGED')`)),e=>pgErrorCode(e)==='42501');
    for(const user of [f.ids.platform,f.ids.resident])await assert.rejects(as(user,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${user},'OCCURRENCE_UPDATED','occurrence',${f.neighbor})`)),e=>pgErrorCode(e)==='42501');
  }));
  it('uses feature settings without building discovery and preserves normal priority when paused',async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'TICKET_PRIORITY',false)`;
    const created=await status(await f.request(f.ids.resident,'/occurrences','POST',input(f.a)),201);assert.equal(created.priority,'NORMAL');
    await status(await f.request(f.ids.manager,`/occurrences/${f.own}`,'PATCH',{priority:'HIGH',priorityReason:'Paused priority'}),403);
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'TICKETS',false)`;
    await status(await list(f,f.ids.resident),403);await status(await f.request(f.ids.resident,`/occurrences/${f.own}`),403);
    assert.deepEqual((await status(await f.request(f.ids.resident,'/occurrences'),200)).items,[]);
    assert.equal((await as(f.ids.resident,tx=>tx.execute(sql`select app_can_read_feature_event(${f.a}) as allowed`)))[0]!.allowed,true);
  }));
  it('rechecks every active parent and grant windows using the same JWT',async()=>fixture(async f=>{
    for(const [table,key,value] of [['users','id',f.ids.worker],['organizations','id',f.org],['buildings','id',f.a],['teams','id',f.team],['roles','key',f.role],['permissions','key','occurrences:manage']] as const) {
      const [saved]=await sqlClient`select active from ${sqlClient(table)} where ${sqlClient(key)}=${value}`;
      try {await sqlClient`update ${sqlClient(table)} set active=false where ${sqlClient(key)}=${value}`;assert.ok([401,403].includes((await list(f,f.ids.worker)).status));assert.equal((await raw(f.ids.worker)).length,0);}
      finally {await sqlClient`update ${sqlClient(table)} set active=${saved!.active} where ${sqlClient(key)}=${value}`;}
    }
    await sqlClient`update team_members set active=false where team_id=${f.team}`;await status(await list(f,f.ids.worker),403);
    await sqlClient`update role_bindings set ends_at=statement_timestamp()-interval '1 second' where id=${f.binding}`;await status(await list(f,f.ids.manager),403);
    await sqlClient`update role_bindings set starts_at=statement_timestamp()+interval '1 day',ends_at=null where id=${f.exactBinding}`;await status(await list(f,f.ids.exact),403);
  }));
  it('accepts only an active local assignee and never grants that assignee private reading',async()=>fixture(async f=>{
    await status(await f.request(f.ids.manager,`/occurrences/${f.own}`,'PATCH',{assignedTo:f.ids.worker}),200);
    await sqlClient`update team_members set active=false where team_id=${f.team}`;
    await status(await f.request(f.ids.manager,`/occurrences/${f.own}`,'PATCH',{assignedTo:f.ids.worker}),400);
    await status(await f.request(f.ids.manager,`/occurrences/${f.own}`,'PATCH',{assignedTo:f.ids.outsider}),400);
    await status(await f.request(f.ids.assigned,`/occurrences/${f.own}`),404);
  }));

  async function locked<T>(f:Fixture,kind:'row'|'advisory',operation:()=>Promise<T>,during:()=>Promise<void>):Promise<T> {
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const blockerClient=postgres(process.env.DATABASE_URL!,{max:1,onnotice:()=>{}});
    let release!:()=>void, acquired!:(pid:number)=>void, fail!:(error:unknown)=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;});
    const ready=new Promise<number>((resolve,reject)=>{acquired=resolve;fail=reject;});
    const blocker=Promise.allSettled([blockerClient.begin(async owner=>{
      await owner`set local lock_timeout='2s'`;await owner`set local statement_timeout='3s'`;
      if(kind==='row')await owner`select id from occurrences where id=${f.own} for update`;
      else await owner`select pg_advisory_xact_lock(hashtextextended(${`occurrences:${f.a}`},0))`;
      const [row]=await owner`select pg_backend_pid() as pid`;acquired(Number(row!.pid));await hold;
    }).catch(error=>{fail(error);throw error;})]);
    const timer=setTimeout(()=>fail(new Error('bounded occurrence blocker acquisition exceeded')),5000);
    let pending:Promise<PromiseSettledResult<T>[]>|undefined, value:T|undefined;
    try {
      const pid=await ready;clearTimeout(timer);pending=Promise.allSettled([operation()]);
      let blocked=false;
      for(let i=0;i<250;i++) {
        const [row]=await sqlClient`select exists(select 1 from pg_stat_activity a where usename='predioon_app' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as blocked`;
        if(row!.blocked){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'operation really waits for the isolated fixture lock');await during();
    } finally {
      clearTimeout(timer);release();const [first,second]=await Promise.all([blocker,pending??Promise.resolve([])]);
      await blockerClient.end({timeout:1});
      for(const result of [...first,...second])if(result.status==='rejected')throw result.reason;
      if(second[0]?.status==='fulfilled')value=second[0].value;
    }
    return value!;
  }
  for(const kind of ['manager-row-revoke','team-advisory-expire','own-cancel-row-expire','own-touch-row-revoke'] as const) {
    it(`revalidates ${kind} after an observed bounded lock with no partial effects`,async()=>fixture(async f=>{
      const before=await sqlClient`select to_jsonb(o) as row from occurrences o where building_id=${f.a} order by id`;
      const events=await sqlClient`select to_jsonb(e) as row from occurrence_events e where building_id=${f.a} order by id`;
      const own=kind.startsWith('own');
      const result=await locked(f,kind==='team-advisory-expire'?'advisory':'row',()=>own
        ?as(f.ids.resident,tx=>tx.execute(kind==='own-cancel-row-expire'?sql`select app_occurrence_cancel_own(${f.a},${f.own}::uuid)`:sql`select app_occurrence_touch_own(${f.a},${f.own}::uuid)`)).then(()=>200,error=>pgErrorCode(error))
        :f.request(kind==='team-advisory-expire'?f.ids.worker:f.ids.manager,`/occurrences/${f.own}`,'PATCH',{status:'DONE',applyToGroup:true}).then(response=>response.status),async()=>{
          if(kind==='manager-row-revoke')await sqlClient`update role_bindings set active=false where id=${f.binding}`;
          else if(kind==='own-touch-row-revoke')await sqlClient`update role_bindings set active=false where id=${f.ownBinding}`;
          else {
            if(own)await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 second' where id=${f.ownBinding}`;
            else await sqlClient`update team_members set ends_at=clock_timestamp()+interval '0.1 second' where team_id=${f.team}`;
            await sqlClient`select pg_sleep(0.15)`;
          }
        });
      assert.equal(result,own?'P0002':404);
      assert.deepEqual(await sqlClient`select to_jsonb(o) as row from occurrences o where building_id=${f.a} order by id`,before);
      assert.deepEqual(await sqlClient`select to_jsonb(e) as row from occurrence_events e where building_id=${f.a} order by id`,events);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    }));
  }
  it('rolls back collective rows and events together when audit rejects without logging private parameters',async t=>fixture(async f=>{
    const logger=t.mock.method(console,'error',()=>undefined), name='occ_audit_failure_'+randomUUID().replaceAll('-','');
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.user_id=TG_ARGV[0] then raise exception 'audit rejected'; end if; return NEW; end $$`);
    await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.ids.manager}')`);
    try {
      const rows=await sqlClient`select to_jsonb(o) as row from occurrences o where building_id=${f.a} order by id`, events=await sqlClient`select to_jsonb(e) as row from occurrence_events e where building_id=${f.a} order by id`;
      for(const [path,method,body] of [[`/occurrences/${f.own}`,'PATCH',{status:'DONE',applyToGroup:true}],[`/occurrences/${f.own}/comments`,'POST',{message:'Private response',applyToGroup:true}],['/occurrences/group','POST',{buildingId:f.a,occurrenceIds:[f.solo,f.second]}]] as const) {
        await status(await f.request(f.ids.manager,path,method,body),500);
        assert.deepEqual(await sqlClient`select to_jsonb(o) as row from occurrences o where building_id=${f.a} order by id`,rows);
        assert.deepEqual(await sqlClient`select to_jsonb(e) as row from occurrence_events e where building_id=${f.a} order by id`,events);
      }
      assert.equal(logger.mock.callCount(),0);
    } finally {await sqlClient.unsafe(`drop trigger ${name} on audit_logs`);await sqlClient.unsafe(`drop function ${name}()`);}
  }));
  it('keeps private clocks inaccessible and narrow routines hardened while rejecting malformed point IDs',async()=>fixture(async f=>{
    const signatures=['app_occurrence_has_capability(text,text,text)','app_occurrence_can_read_scope(text,boolean)','app_occurrence_can_read_feature_state(text)','app_occurrence_group_can_manage(text,text)','app_occurrence_can_manage_group(text,text)','app_occurrence_assignee_active(text,text,text)','app_occurrence_cancel_own(text,uuid)','app_occurrence_touch_own(text,uuid)'];
    for(const signature of signatures) {
      const [row]=await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,p.proowner=c.proowner as owned,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(row!.prosecdef,true);assert.equal(row!.owned,true);assert.ok(row!.proconfig.includes('search_path=public, pg_temp'));assert.equal(row!.app,true);assert.equal(row!.identity,false);assert.equal(row!.broker,false);
      assert.equal(row!.provolatile,signature.includes('_own(')?'v':'s');
    }
    for(const runtime of ['predioon_app','predioon_identity','predioon_broker_auth'])assert.equal((await sqlClient`select has_function_privilege(${runtime},'app_occurrence_has_capability_at(text,text,text,timestamptz)','EXECUTE') as allowed`)[0]!.allowed,false);
    const [bad]=await as(f.ids.manager,tx=>tx.execute(sql`select app_occurrence_has_capability(${f.a},'bad-uuid','occurrences:manage') as malformed,app_occurrence_has_capability(${f.a},${f.foreign},'occurrences:manage') as foreign_resource,app_occurrence_has_capability(${f.a},${f.own},'notices:read') as wrong_capability`));
    assert.deepEqual({...bad},{malformed:false,foreign_resource:false,wrong_capability:false});
  }));
});
