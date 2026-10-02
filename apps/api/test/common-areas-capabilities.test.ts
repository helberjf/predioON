import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { CAPABILITIES, ROLE_CAPABILITIES } from "@predioon/shared";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type Area = { id: string; buildingId: string; name: string; active: boolean; opensAt: string; closesAt: string; requiresApproval: boolean; maxHoursPerBooking: number };

describe("áreas comuns com capacidades atuais e configuração preservada", () => {
  let server: TestServer, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);

  async function create() {
    const suffix = randomUUID(), org = `area-org-${suffix}`, a = `area-a-${suffix}`, b = `area-b-${suffix}`;
    const kinds = ["manager", "reader", "worker", "exact", "actionOnly", "mixed", "platform", "flag", "support", "outsider"] as const;
    const ids = Object.fromEntries(kinds.map(kind => [kind, `area-${kind}-${suffix}`])) as Record<typeof kinds[number], string>;
    const role = `AREA_MANAGER_${suffix}`, readerRole = `AREA_READER_${suffix}`, actionRole = `AREA_ACTION_${suffix}`;
    const area = randomUUID(), inactive = randomUUID(), foreign = randomUUID(), team = randomUUID(), binding = randomUUID(), exactBinding = randomUUID();
    const cleanup = async () => {
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from buildings where organization_id=${org}`;
      await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from roles where key in ${sqlClient([role,readerRole,actionRole])}`;
    };
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Common area capabilities',${org})`;
      await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'Common area A','A'),(${b},${org},'Common area B','B')`;
      for (const [kind,id] of Object.entries(ids)) await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id.toLowerCase()+'@areas.test'},${passwordHash},${kind==='flag'})`;
      for (const key of [role,readerRole,actionRole]) await sqlClient`insert into roles(key,scope,label) values(${key},'BUILDING',${key})`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${role},'common-areas:read'),(${role},'common-areas:manage'),(${readerRole},'common-areas:read'),(${actionRole},'common-areas:manage')`;
      await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Area team')`;
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},${role})`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.reader},${a},${readerRole}),(${ids.actionOnly},${a},${actionRole})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${role})`;
      await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN'),(${ids.support},'PLATFORM_SUPPORT')`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.mixed},${a},'BUILDING_ADMIN'),(${ids.mixed},${b},'RESIDENT')`;
      await sqlClient`insert into common_areas(id,building_id,name,opens_at,closes_at,requires_approval,max_hours_per_booking,active) values
        (${area},${a},'Active area','06:30','23:15',false,3,true),
        (${inactive},${a},'Inactive area','10:00','18:00',true,2,false),
        (${foreign},${b},'Foreign area','08:00','22:00',true,4,true)`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${exactBinding},${ids.exact},${a},${role},'common_area',${area})`;
      const tokens = new Map<string,string>();
      const request = async (user: string, path: string, method="GET", body?: unknown) => {
        if (!tokens.has(user)) tokens.set(user, (await login(server.url, user+'@areas.test')).accessToken);
        return call(server.url,path,{token:tokens.get(user),method,body});
      };
      const list = (user=ids.manager, building=a) => request(user,`/common-areas?buildingId=${building}`);
      return {org,a,b,ids,role,readerRole,actionRole,team,binding,exactBinding,area,inactive,foreign,request,list,cleanup};
    } catch (error) { await cleanup(); throw error; }
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); } finally { await f.cleanup(); }
  }
  async function items(response: Response): Promise<Area[]> {
    const body = await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"),"no-store");
    return body.items;
  }
  const newArea = (buildingId: string) => ({ buildingId, name: "Área autorizada" });
  const raw = (user: string) => as(user,tx=>tx.execute(sql`select id from common_areas`));

  it("permite pessoa/equipe sem membership e lista apenas áreas ativas do escopo", async()=>fixture(async f=>{
    for (const user of [f.ids.manager,f.ids.worker,f.ids.reader]) assert.deepEqual((await items(await f.list(user))).map(row=>row.id),[f.area]);
    assert.deepEqual((await raw(f.ids.manager)).map(row=>row.id).sort(),[f.area,f.inactive].sort());
    for (const user of [f.ids.manager,f.ids.worker]) {
      const response=await f.request(user,"/common-areas","POST",newArea(f.a));
      assert.equal(response.status,201,await response.clone().text());
      const row=await response.json() as Area;
      assert.equal(row.buildingId,f.a); assert.equal(row.opensAt,"08:00"); assert.equal(row.closesAt,"22:00");
      assert.equal(row.requiresApproval,true); assert.equal(row.maxHoursPerBooking,6);
    }
    assert.equal((await f.request(f.ids.reader,"/common-areas","POST",newArea(f.a))).status,403);
    assert.equal((await f.request(f.ids.actionOnly,"/common-areas","POST",newArea(f.a))).status,403);
  }));

  it("PATCH do nome conserva horários, limite e aprovação omitidos e audita", async()=>fixture(async f=>{
    const [before]=await sqlClient`select to_jsonb(a) as row from common_areas a where id=${f.area}`;
    const response=await f.request(f.ids.manager,`/common-areas/${f.area}`,"PATCH",{name:"Área renomeada"});
    assert.equal(response.status,200,await response.clone().text());
    const row=await response.json() as Area;
    assert.equal(row.name,"Área renomeada"); assert.equal(row.opensAt,"06:30"); assert.equal(row.closesAt,"23:15");
    assert.equal(row.requiresApproval,false); assert.equal(row.maxHoursPerBooking,3);
    const [after]=await sqlClient`select to_jsonb(a) as row from common_areas a where id=${f.area}`;
    const omit=(value: Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>!["name","updated_at"].includes(key)));
    assert.deepEqual(omit(after!.row),omit(before!.row));
    const audits=await sqlClient`select action,resource_type,resource_id,user_id from audit_logs where building_id=${f.a}`;
    assert.deepEqual(audits.map(row=>({...row})),[{action:"COMMON_AREA_UPDATED",resource_type:"common_area",resource_id:f.area,user_id:f.ids.manager}]);
  }));

  it("concessão exata edita só a área real, inclusive inativa, sem criar outras", async()=>fixture(async f=>{
    assert.deepEqual((await items(await f.list(f.ids.exact))).map(row=>row.id),[f.area]);
    assert.equal((await f.request(f.ids.exact,"/common-areas","POST",newArea(f.a))).status,403);
    assert.equal((await f.request(f.ids.exact,`/common-areas/${f.inactive}`,"PATCH",{name:"Fora do escopo"})).status,404);
    assert.equal((await f.request(f.ids.exact,`/common-areas/${f.area}`,"PATCH",{active:false})).status,200);
    assert.deepEqual(await items(await f.list(f.ids.exact)),[]);
    assert.equal((await f.request(f.ids.exact,`/common-areas/${f.area}`,"PATCH",{name:"Reativada",active:true})).status,200);
    assert.deepEqual((await items(await f.list(f.ids.exact))).map(row=>row.id),[f.area]);
  }));

  it("rejeita área alheia/inexistente, flags globais e suporte sem abrir cadastro", async()=>fixture(async f=>{
    for (const user of [f.ids.platform,f.ids.flag,f.ids.support,f.ids.outsider,f.ids.actionOnly]) {
      assert.equal((await f.list(user)).status,403);
      assert.equal((await raw(user)).length,0);
    }
    // A diagnostic grant still cannot acquire either common-area permission.
    await sqlClient`insert into support_grants(building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by)
      values(${f.a},${f.ids.support},'devices:read','common_area',${f.area},'Diagnóstico não concede configuração',now()+interval '1 hour',${f.ids.manager})`;
    assert.equal((await f.list(f.ids.support)).status,403);
    for (const target of [f.foreign,randomUUID(),"uuid-invalido"]) {
      await sqlClient`update role_bindings set resource_id=${target} where id=${f.exactBinding}`;
      assert.equal((await f.list(f.ids.exact)).status,403);
      const [row]=await as(f.ids.exact,tx=>tx.execute(sql`select app_common_area_has_capability(${f.a},${target},'common-areas:read') as allowed`));
      assert.equal(row!.allowed,false);
    }
    assert.equal((await f.request(f.ids.manager,"/common-areas/uuid-invalido","PATCH",{name:"Inválida"})).status,404);
    assert.equal((await f.request(f.ids.reader,`/common-areas/${f.area}`,"PATCH",{name:"Proibida"})).status,403);
    assert.equal((await f.request(f.ids.manager,`/common-areas/${f.foreign}`,"PATCH",{name:"Proibida"})).status,404);
  }));

  it("síndico no A e morador no B continua sem gestão no B", async()=>fixture(async f=>{
    assert.equal((await f.request(f.ids.mixed,`/common-areas/${f.area}`,"PATCH",{name:"Permitida"})).status,200);
    assert.deepEqual((await items(await f.list(f.ids.mixed,f.b))).map(row=>row.id),[f.foreign]);
    assert.equal((await f.request(f.ids.mixed,`/common-areas/${f.foreign}`,"PATCH",{name:"Negada"})).status,403);
    assert.equal((await f.request(f.ids.mixed,"/common-areas","POST",newArea(f.b))).status,403);
  }));

  it("schemas estritos e grants SQL protegem identidade, tenant e criação", async()=>fixture(async f=>{
    for (const extra of [{id:randomUUID()},{buildingId:f.b},{createdAt:new Date().toISOString()},{unknown:true}]) {
      assert.equal((await f.request(f.ids.manager,`/common-areas/${f.area}`,"PATCH",{name:"Alterada",...extra})).status,400);
    }
    assert.equal((await f.request(f.ids.manager,"/common-areas","POST",{...newArea(f.a),active:false})).status,400);
    for (const field of ["id","building_id","created_at"]) {
      await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql.raw(`update common_areas set ${field}=${field} where id='${f.area}'`))),error=>pgErrorCode(error)==="42501");
    }
    await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`delete from common_areas where id=${f.area}::uuid`)),error=>pgErrorCode(error)==="42501");
    await assert.rejects(as(f.ids.exact,tx=>tx.execute(sql`insert into common_areas(building_id,name) values(${f.a},'Unscoped insert')`)),error=>pgErrorCode(error)==="42501");
    assert.equal((await as(f.ids.reader,tx=>tx.execute(sql`update common_areas set name='Reader edit' where id=${f.area}::uuid returning id`))).length,0);
  }));

  it("estados locais desativados não viram default ligado para concessão restrita", async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'RESERVATIONS',false)`;
    await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${f.a},'RESERVATIONS',now())`;
    for (const user of [f.ids.manager,f.ids.exact,f.ids.worker]) {
      const states=await as(user,tx=>tx.execute(sql`select enabled from building_feature_settings where building_id=${f.a} and feature_key='RESERVATIONS'`));
      assert.deepEqual(states.map(row=>row.enabled),[false]);
      const response=await f.list(user); assert.equal(response.status,403); assert.equal((await response.json()).details.code,"FEATURE_DISABLED");
      assert.equal((await f.request(user,`/common-areas/${f.area}`,"PATCH",{name:"Disabled edit"})).status,403);
    }
  }));

  it("concessão vazia de escopo inteiro ainda lista zero áreas sem inventar permissão", async()=>fixture(async f=>{
    await sqlClient`delete from common_areas where building_id=${f.a}`;
    assert.deepEqual(await items(await f.list()),[]);
    assert.equal((await f.list(f.ids.exact)).status,403);
  }));

  it("revogação, datas e pais inativos retiram acesso do mesmo JWT", async()=>fixture(async f=>{
    await items(await f.list(f.ids.worker));
    for (const [table,key,value] of [["users","id",f.ids.worker],["buildings","id",f.a],["organizations","id",f.org],["teams","id",f.team],["roles","key",f.role],["permissions","key","common-areas:read"]]) {
      const [original]=await sqlClient`select active from ${sqlClient(table!)} where ${sqlClient(key!)}=${value!}`;
      try {
        await sqlClient`update ${sqlClient(table!)} set active=false where ${sqlClient(key!)}=${value!}`;
        assert.ok([401,403].includes((await f.list(f.ids.worker)).status),table);
        assert.equal((await raw(f.ids.worker)).length,0,table);
      } finally { await sqlClient`update ${sqlClient(table!)} set active=${original!.active} where ${sqlClient(key!)}=${value!}`; }
    }
    for (const change of ["binding","expiry","future","member","memberExpiry"]) {
      if(change==="binding")await sqlClient`update role_bindings set active=false where team_id=${f.team}`;
      if(change==="expiry")await sqlClient`update role_bindings set ends_at=statement_timestamp()-interval '1 second' where team_id=${f.team}`;
      if(change==="future")await sqlClient`update role_bindings set starts_at=statement_timestamp()+interval '1 hour' where team_id=${f.team}`;
      if(change==="member")await sqlClient`update team_members set active=false where team_id=${f.team}`;
      if(change==="memberExpiry")await sqlClient`update team_members set ends_at=statement_timestamp()-interval '1 second' where team_id=${f.team}`;
      assert.equal((await f.list(f.ids.worker)).status,403,change);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.team}`;
    }
  }));

  async function locked<T>(f: Fixture, start:()=>Promise<T>, during:()=>Promise<void>) {
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve("@predioon/db"))("postgres") as (url:string,options:object)=>typeof sqlClient;
    const blockerClient=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:2});
    let release!:()=>void, ready!:(pid:number)=>void, rejectReady!:(error:unknown)=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}), acquired=new Promise<number>((resolve,reject)=>{ready=resolve;rejectReady=reject;});
    let timeout:ReturnType<typeof setTimeout>|undefined, started=false;
    let pending:Promise<PromiseSettledResult<T>[]>|undefined;
    const blocker=Promise.allSettled([blockerClient.begin(async owner=>{
      await owner`set local lock_timeout='2s'`; await owner`set local statement_timeout='3s'`;
      await owner`select id from common_areas where id=${f.area} for update`;
      const [row]=await owner`select pg_backend_pid() as pid`; ready(row!.pid); await held;
    })]);
    void blocker.then(([result])=>{if(result!.status==="rejected")rejectReady(result.reason);});
    let response:T|undefined;
    try {
      const pid=await Promise.race([acquired,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error("Common area fixture lock timeout")),5000);})]);
      clearTimeout(timeout); started=true;
      pending=Promise.allSettled([Promise.resolve().then(start)]);
      let waiting=false;
      for(let i=0;i<250;i++) {
        const [row]=await sqlClient`select exists(select 1 from pg_stat_activity a where a.usename='predioon_app' and a.wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as waiting`;
        if(row!.waiting){waiting=true;break;} await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,true,"request must really wait on the common area row"); await during();
    } finally {
      clearTimeout(timeout); release();
      if(!started)await blockerClient.end({timeout:0});
      const [blockerResults,results]=await Promise.all([blocker,pending??Promise.resolve([])]);
      await blockerClient.end({timeout:1});
      for(const result of [...blockerResults,...results])if(result.status==="rejected")throw result.reason;
      if(results[0]?.status==="fulfilled")response=results[0].value;
    }
    return response as T;
  }
  async function waitPast(boundary: Date) {
    for(let i=0;i<100;i++) {
      const [row]=await sqlClient`select clock_timestamp()>${boundary}::timestamptz as expired`;
      if(row!.expired)return; await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.fail("database grant deadline did not pass within bounded wait");
  }
  for(const kind of ["person-revocation","person-expiry","team-revocation","team-expiry","management-revocation"] as const) {
    it(`revalida ${kind} depois de lock antes de configuração e auditoria`,async()=>fixture(async f=>{
      const before=await sqlClient`select to_jsonb(a) as row from common_areas a where id=${f.area}`;
      const response=await locked(f,()=>f.request(kind.startsWith("team")?f.ids.worker:f.ids.manager,`/common-areas/${f.area}`,"PATCH",{name:"Never persist"}),async()=>{
        if(kind==="person-revocation")await sqlClient`update role_bindings set active=false where id=${f.binding}`;
        else if(kind==="team-revocation")await sqlClient`update team_members set active=false where team_id=${f.team}`;
        else if(kind==="management-revocation")await sqlClient`delete from role_permissions where role_key=${f.role} and permission_key='common-areas:manage'`;
        else if(kind==="team-expiry"){const [row]=await sqlClient`update team_members set ends_at=clock_timestamp()+interval '0.1 seconds' where team_id=${f.team} returning ends_at`; await waitPast(row!.ends_at);}
        else {const [row]=await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 seconds' where id=${f.binding} returning ends_at`; await waitPast(row!.ends_at);}
      });
      assert.equal(response.status,kind==="management-revocation"?403:404,await response.clone().text());
      assert.deepEqual(await sqlClient`select to_jsonb(a) as row from common_areas a where id=${f.area}`,before);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    }));
  }

  it("falha de auditoria reverte criação e edição sem expor parâmetros",async t=>fixture(async f=>{
    const logger=t.mock.method(console,"error",()=>undefined);
    const name="area_audit_failure_"+randomUUID().replaceAll("-","");
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.user_id=TG_ARGV[0] then raise exception 'audit fixture rejected'; end if; return NEW; end $$`);
    await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.ids.manager}')`);
    try {
      const before=await sqlClient`select to_jsonb(a) as row from common_areas a where building_id=${f.a} order by id`;
      assert.equal((await f.request(f.ids.manager,"/common-areas","POST",{...newArea(f.a),name:"Confidential creation"})).status,500);
      assert.equal((await f.request(f.ids.manager,`/common-areas/${f.area}`,"PATCH",{name:"Confidential update"})).status,500);
      assert.deepEqual(await sqlClient`select to_jsonb(a) as row from common_areas a where building_id=${f.a} order by id`,before);
      assert.ok(!JSON.stringify(logger.mock.calls).includes("Confidential"));
    } finally {
      await sqlClient.unsafe(`drop trigger ${name} on audit_logs`);
      await sqlClient.unsafe(`drop function ${name}()`);
    }
  }));

  it("helpers são app-only, dono RBAC e descoberta continua sem oracle público",async()=>fixture(async f=>{
    for(const client of [identitySqlClient,brokerAuthSqlClient])await assert.rejects(client`select app_common_area_has_capability(${f.a},${f.area},'common-areas:read')`,{code:"42501"});
    for(const signature of ["app_common_area_has_capability(text,text,text)","app_common_area_can_read_scope(text)"]) {
      const [row]=await sqlClient`select p.prosecdef,p.proconfig,p.proowner=(select proowner from pg_proc where oid='app_has_capability(text,text,text,text)'::regprocedure) as same_owner,
        has_function_privilege('predioon_app',p.oid,'EXECUTE') as app_execute,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
        from pg_proc p where p.oid=${signature}::regprocedure`;
      assert.equal(row!.prosecdef,true);assert.equal(row!.same_owner,true);assert.equal(row!.app_execute,true);assert.equal(row!.public_execute,false);
      assert.ok(row!.proconfig.includes("search_path=public, pg_temp"));
    }
    await assert.rejects(as(f.ids.manager,tx=>tx.execute(sql`select app_discovery_resource_belongs(${f.a},'common_area',${f.area})`)),error=>pgErrorCode(error)==="42501");
    // With only two tenant rows either index is equally cheap. Representative
    // cardinality proves the real id+tenant predicate resolves through the PK.
    await sqlClient`insert into common_areas(building_id,name) select ${f.a},'Plan fixture '||n from generate_series(1,500) n`;
    await sqlClient`analyze common_areas`;
    await sqlClient.begin(async owner=>{
      await owner`set local enable_seqscan=off`;
      const plan=await owner`explain select 1 from common_areas where id=${f.area} and building_id=${f.a}`;
      assert.match(JSON.stringify(plan),/common_areas_pkey/);
    });
  }));

  it("reaplicar028 conserva catálogo alheio, grants suspensos e políticas de outros módulos",async()=>{
    const migration=await readFile(new URL("../../../infrastructure/028-common-areas-capabilities.sql",import.meta.url),"utf8");
    const snapshot=async()=>({
      permissions:await sqlClient`select to_jsonb(p) as row from permissions p order by key`,
      roles:await sqlClient`select to_jsonb(r) as row from role_permissions r order by role_key,permission_key`,
      windows:await sqlClient`select pg_get_functiondef('app_rbac_window(boolean,timestamptz,timestamptz)'::regprocedure) as definition`,
      policies:await sqlClient`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname`,
      acl:await sqlClient`select c.relname,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname`,
    });
    const [permission]=await sqlClient`select active from permissions where key='common-areas:read'`;
    try {
      await sqlClient`update permissions set active=false where key='common-areas:read'`;
      const before=await snapshot();
      await sqlClient.begin(tx=>tx.unsafe(migration));
      assert.deepEqual(await snapshot(),before);
    } finally { await sqlClient`update permissions set active=${permission!.active} where key='common-areas:read'`; }
    assert.deepEqual((await sqlClient`select key from permissions order by key`).map(row=>row.key),[...CAPABILITIES].sort());
    for(const [role,capabilities] of Object.entries(ROLE_CAPABILITIES))assert.deepEqual((await sqlClient`select permission_key from role_permissions where role_key=${role} order by permission_key`).map(row=>row.permission_key),[...capabilities].sort(),role);
  });
});
