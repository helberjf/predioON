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

describe("reservas privadas, calendário mínimo e capacidades atuais",()=>{
  let server:TestServer,passwordHash:string;
  before(async()=>{passwordHash=await hashPassword("predioon123");server=await startTestServer();});
  after(async()=>{await server?.close();await closeAppDb();await sqlClient.end();});
  const as=<T>(userId:string,run:Parameters<typeof withUserContext<T>>[1])=>withUserContext({userId,role:"PLATFORM_ADMIN"},run);
  async function create(){
    const suffix=randomUUID(),org=`res-org-${suffix}`,a=`res-a-${suffix}`,b=`res-b-${suffix}`;
    const kinds=["manager","resident","neighbor","worker","exact","area","platform","flag","support","outsider"] as const;
    const ids=Object.fromEntries(kinds.map(kind=>[kind,`res-${kind}-${suffix}`])) as Record<typeof kinds[number],string>;
    const area=randomUUID(),second=randomUUID(),foreign=randomUUID(),team=randomUUID(),binding=randomUUID();
    const own=randomUUID(),other=randomUUID(),secondBooking=randomUUID(),foreignBooking=randomUUID();
    const cleanup=async()=>{await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;await sqlClient`delete from buildings where organization_id=${org}`;await sqlClient`delete from organizations where id=${org}`;await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;};
    try{
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Reservations capabilities',${org})`;
      await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${org},'Reservations A','A'),(${b},${org},'Reservations B','B')`;
      for(const [kind,id] of Object.entries(ids))await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${id+'@reservations.test'},${passwordHash},${kind==='flag'})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.manager},${a},'BUILDING_ADMIN')`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.resident},${a},'RESIDENT'),(${ids.neighbor},${a},'RESIDENT')`;
      await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.platform},'PLATFORM_ADMIN'),(${ids.support},'PLATFORM_SUPPORT')`;
      await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Reservation team')`;
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},'BUILDING_ADMIN')`;
      await sqlClient`insert into common_areas(id,building_id,name,requires_approval) values(${area},${a},'Approval area',true),(${second},${a},'Automatic area',false),(${foreign},${b},'Foreign area',true)`;
      for(const [id,tenant,parent,user,day] of [[own,a,area,ids.resident,2],[other,a,area,ids.neighbor,3],[secondBooking,a,second,ids.neighbor,4],[foreignBooking,b,foreign,ids.neighbor,5]] as const){
        await sqlClient`insert into reservations(id,building_id,area_id,user_id,starts_at,ends_at,unit,notes) values(${id},${tenant},${parent},${user},clock_timestamp()+${day}*interval '1 day',clock_timestamp()+${day}*interval '1 day'+interval '1 hour',${'unit-'+id},${'private-'+id})`;
      }
      const tokens=new Map<string,string>();
      const request=async(user:string,path:string,method="GET",body?:unknown)=>{if(!tokens.has(user))tokens.set(user,(await login(server.url,user+'@reservations.test')).accessToken);return call(server.url,path,{token:tokens.get(user),method,body});};
      const list=(user=ids.resident,building=a,query="")=>request(user,`/reservations?buildingId=${building}${query}`);
      return{org,a,b,ids,area,second,foreign,team,binding,own,other,secondBooking,foreignBooking,request,list,cleanup};
    }catch(error){await cleanup();throw error;}
  }
  type Fixture=Awaited<ReturnType<typeof create>>;
  async function fixture(run:(f:Fixture)=>Promise<void>){const f=await create();try{await run(f);}finally{await f.cleanup();}}
  async function items(response:Response){const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(response.headers.get("cache-control"),"no-store");return body.items as Array<Record<string,unknown>>;}
  const booking=(areaId:string,day=8)=>({areaId,startsAt:new Date(Date.now()+day*86_400_000).toISOString(),endsAt:new Date(Date.now()+day*86_400_000+3_600_000).toISOString(),unit:"101",notes:"Privado"});

  it("pessoa/equipe sem membership usa a API e RLS esconde as reservas dos vizinhos",async()=>fixture(async f=>{
    for(const query of ["","&mine=false","&mine=true"]){const rows=await items(await f.list(f.ids.resident,f.a,query));assert.deepEqual(rows.map(r=>r.id),[f.own]);assert.equal(rows[0]!.notes,'private-'+f.own);}
    assert.deepEqual((await as(f.ids.resident,tx=>tx.execute(sql`select id from reservations`))).map(r=>r.id),[f.own]);
    for(const user of [f.ids.manager,f.ids.worker])assert.deepEqual((await items(await f.list(user))).map(r=>r.id).sort(),[f.own,f.other,f.secondBooking].sort());
    const response=await f.request(f.ids.resident,"/reservations","POST",booking(f.area));assert.equal(response.status,201,await response.clone().text());
  }));

  async function status(response:Response,expected:number) {
    const text=await response.text();assert.equal(response.status,expected,text);
    return text?JSON.parse(text):undefined;
  }
  const availability=(f:Fixture,area=f.area,building=f.a,days=15)=>`/reservations/availability?buildingId=${building}&areaId=${area}&from=${new Date().toISOString()}&to=${new Date(Date.now()+days*86_400_000).toISOString()}`;
  it("calendário revela somente intervalos ocupados e exige janela limitada e vínculo real",async()=>fixture(async f=>{
    const rows=await items(await f.request(f.ids.resident,availability(f)));
    assert.equal(rows.length,2);
    for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['endsAt','startsAt']);
    for(const secret of [f.own,f.other,f.ids.neighbor,'private-','unit-'])assert.ok(!JSON.stringify(rows).includes(secret));
    await status(await f.request(f.ids.resident,availability(f,f.foreign)),403);
    await status(await f.request(f.ids.resident,availability(f,f.foreign,f.b)),403);
    await status(await f.request(f.ids.resident,availability(f,f.area,f.a,32)),400);
    await sqlClient`update reservations set status='REJECTED' where id=${f.other}`;
    assert.equal((await items(await f.request(f.ids.resident,availability(f)))).length,1);
  }));
  it("admin global, flag, suporte e estranho não acessam dados privados sem vínculo local",async()=>fixture(async f=>{
    for(const user of [f.ids.platform,f.ids.flag,f.ids.support,f.ids.outsider]){
      await status(await f.list(user),403);
      await status(await f.request(user,availability(f)),403);
      await status(await f.request(user,`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'}),404);
      await status(await f.request(user,`/reservations/${f.own}`,'DELETE'),404);
      assert.equal((await as(user,tx=>tx.execute(sql`select id from reservations`))).length,0);
    }
  }));
  it("escopos de reserva e área gerenciam apenas recursos concretos do condomínio",async()=>fixture(async f=>{
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values
      (${f.ids.exact},${f.a},'BUILDING_ADMIN','reservation',${f.own}),
      (${f.ids.area},${f.a},'BUILDING_ADMIN','common_area',${f.area})`;
    assert.deepEqual((await items(await f.list(f.ids.exact))).map(row=>row.id),[f.own]);
    assert.deepEqual((await items(await f.list(f.ids.area))).map(row=>row.id).sort(),[f.own,f.other].sort());
    await status(await f.request(f.ids.exact,`/reservations/${f.other}/decision`,'POST',{status:'CONFIRMED'}),404);
    await status(await f.request(f.ids.exact,`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'}),200);
    await status(await f.request(f.ids.area,`/reservations/${f.other}`,'DELETE'),204);
    await status(await f.request(f.ids.area,`/reservations/${f.secondBooking}`,'DELETE'),404);
    assert.equal((await items(await f.request(f.ids.area,availability(f)))).length,1);
  }));
  it("solicitação tem autor autenticado, estado da área e auditoria sem campos de decisão",async()=>fixture(async f=>{
    for(const [areaId,expected] of [[f.area,'PENDING'],[f.second,'CONFIRMED']] as const){
      const created=await status(await f.request(f.ids.resident,'/reservations','POST',booking(areaId)),201);
      assert.equal(created.userId,f.ids.resident);assert.equal(created.status,expected);
      assert.deepEqual(Object.keys(created).sort(),['areaId','buildingId','endsAt','id','notes','startsAt','status','unit','userId']);
      const [audit]=await sqlClient`select action,user_id from audit_logs where resource_id=${created.id}`;
      assert.deepEqual({...audit},{action:'RESERVATION_CREATED',user_id:f.ids.resident});
    }
    for(const extra of [{userId:f.ids.neighbor},{buildingId:f.b},{status:'CONFIRMED'},{decidedBy:f.ids.manager}])
      await status(await f.request(f.ids.resident,'/reservations','POST',{...booking(f.area),...extra}),400);
    await status(await f.request(f.ids.resident,'/reservations','POST',booking(f.foreign)),404);
    await status(await f.request(f.ids.resident,'/reservations','POST',booking(f.area,-1)),400);
    const long=booking(f.area);long.endsAt=new Date(Date.parse(long.startsAt)+25*3_600_000).toISOString();
    await status(await f.request(f.ids.resident,'/reservations','POST',long),400);
  }));
  it("banco resolve solicitações simultâneas de mesmo horário sem reserva ou auditoria parcial",async()=>fixture(async f=>{
    const input=booking(f.area);
    const responses=await Promise.all([f.request(f.ids.resident,'/reservations','POST',input),f.request(f.ids.neighbor,'/reservations','POST',input)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    assert.equal((await sqlClient`select id from reservations where building_id=${f.a} and starts_at=${input.startsAt}::timestamptz`).length,1);
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a} and action='RESERVATION_CREATED'`).length,1);
  }));
  it("cancelamento próprio é idempotente sem conceder UPDATE administrativo ou atingir vizinho",async()=>fixture(async f=>{
    await status(await f.request(f.ids.resident,`/reservations/${f.other}`,'DELETE'),404);
    await status(await f.request(f.ids.resident,`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'}),403);
    assert.equal((await as(f.ids.resident,tx=>tx.execute(sql`update reservations set status='CONFIRMED' where id=${f.own}::uuid returning id`))).length,0);
    for(let i=0;i<2;i++)await status(await f.request(f.ids.resident,`/reservations/${f.own}`,'DELETE'),204);
    assert.equal((await sqlClient`select status from reservations where id=${f.own}`)[0]!.status,'CANCELLED');
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.own} and action='RESERVATION_CANCELLED'`).length,1);
    await status(await f.request(f.ids.manager,`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'}),409);
  }));
  it("decisões concorrentes têm um único vencedor e estados finais não reabrem",async()=>fixture(async f=>{
    const responses=await Promise.all(['CONFIRMED','REJECTED'].map(decision=>f.request(f.ids.manager,`/reservations/${f.own}/decision`,'POST',{status:decision})));
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal((await sqlClient`select id from audit_logs where resource_id=${f.own}`).length,1);
    const decided=await status(await f.request(f.ids.manager,`/reservations/${f.other}/decision`,'POST',{status:'REJECTED'}),200);
    assert.equal(decided.status,'REJECTED');
    await status(await f.request(f.ids.manager,`/reservations/${f.other}`,'DELETE'),409);
    await status(await f.request(f.ids.neighbor,`/reservations/${f.other}`,'DELETE'),409);
  }));
  it("revogação e parentes inativos valem imediatamente para tokens já emitidos",async()=>fixture(async f=>{
    assert.equal((await items(await f.list(f.ids.worker))).length,3);
    await sqlClient`update team_members set active=false where team_id=${f.team}`;
    await status(await f.list(f.ids.worker),403);
    await sqlClient`update role_bindings set active=false where id=${f.binding}`;
    await status(await f.list(f.ids.manager),403);
    assert.equal((await items(await f.list())).length,1);
    await sqlClient`update buildings set active=false where id=${f.a}`;
    await status(await f.list(),403);
    await sqlClient`update buildings set active=true where id=${f.a}`;
    await sqlClient`update organizations set active=false where id=${f.org}`;
    await status(await f.list(),403);
  }));
  it("recurso desativado bloqueia listagem, calendário e todas as mutações",async()=>fixture(async f=>{
    await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'RESERVATIONS',false)`;
    for(const [path,method,body,user] of [
      [`/reservations?buildingId=${f.a}`,'GET',undefined,f.ids.resident],
      [availability(f),'GET',undefined,f.ids.resident],
      ['/reservations','POST',booking(f.area),f.ids.resident],
      [`/reservations/${f.own}`,'DELETE',undefined,f.ids.resident],
      [`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'},f.ids.manager],
    ] as const)await status(await f.request(user,path,method,body),403);
    assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
  }));
  it("runtime não altera identidade ou decisão livremente e helpers privados não são executáveis",async()=>fixture(async f=>{
    for(const statement of [sql`update reservations set user_id=${f.ids.manager} where id=${f.own}::uuid`,sql`update reservations set notes='tampered' where id=${f.own}::uuid`,sql`delete from reservations where id=${f.own}::uuid`,sql`update reservations set decided_by=${f.ids.manager} where id=${f.own}::uuid`])
      await assert.rejects(as(f.ids.manager,tx=>tx.execute(statement)),error=>pgErrorCode(error)==='42501');
    for(const runtime of ['predioon_app','predioon_identity','predioon_broker_auth']){
      assert.equal((await sqlClient`select has_function_privilege(${runtime},'app_reservation_has_capability_at(text,text,text,timestamptz)','EXECUTE') as allowed`)[0]!.allowed,false);
    }
    for(const signature of ['app_cancel_own_reservation(text)','app_reservation_availability(text,text,timestamptz,timestamptz)']){
      const [row]=await sqlClient`select p.prosecdef,p.proconfig,p.proowner=c.proowner as owned,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app,has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity,has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker from pg_proc p cross join pg_proc c where p.oid=${signature}::regprocedure and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
      assert.equal(row!.prosecdef,true);assert.equal(row!.owned,true);assert.ok(row!.proconfig.includes('search_path=public, pg_temp'));assert.equal(row!.app,true);assert.equal(row!.identity,false);assert.equal(row!.broker,false);
    }
    const [bad]=await as(f.ids.manager,tx=>tx.execute(sql`select app_reservation_has_capability(${f.a},'bad','reservations:manage') as malformed,app_reservation_has_capability(${f.a},${f.foreignBooking},'reservations:manage') as foreign_resource`));
    assert.deepEqual({...bad},{malformed:false,foreign_resource:false});
    await status(await f.request(f.ids.manager,'/reservations/not-a-uuid','DELETE'),404);
  }));

  async function locked<T>(f:Fixture,operation:()=>Promise<T>,during:()=>Promise<void>):Promise<T> {
    const require=createRequire(import.meta.url);
    const postgres=createRequire(require.resolve('@predioon/db'))('postgres') as (url:string,options:object)=>typeof sqlClient;
    const client=postgres(process.env.DATABASE_URL!,{max:1,onnotice:()=>{}});
    let release!:()=>void,acquired!:(pid:number)=>void,fail!:(error:unknown)=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;});
    const ready=new Promise<number>((resolve,reject)=>{acquired=resolve;fail=reject;});
    const blocker=Promise.allSettled([client.begin(async owner=>{
      await owner`set local lock_timeout='2s'`;await owner`set local statement_timeout='3s'`;
      await owner`select id from reservations where id=${f.own} for update`;
      const [row]=await owner`select pg_backend_pid() as pid`;acquired(Number(row!.pid));await hold;
    }).catch(error=>{fail(error);throw error;})]);
    const timer=setTimeout(()=>fail(new Error('reservation blocker timeout')),5000);
    let pending:Promise<PromiseSettledResult<T>[]>|undefined,value:T|undefined;
    try{
      const pid=await ready;clearTimeout(timer);pending=Promise.allSettled([operation()]);
      let blocked=false;
      for(let i=0;i<250;i++){
        const [row]=await sqlClient`select exists(select 1 from pg_stat_activity a where usename='predioon_app' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(a.pid))) as blocked`;
        if(row!.blocked){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'operation must actually wait for the fixture row lock');await during();
    }finally{
      clearTimeout(timer);release();const [first,second]=await Promise.all([blocker,pending??Promise.resolve([])]);
      await client.end({timeout:1});
      for(const result of [...first,...second])if(result.status==='rejected')throw result.reason;
      if(second[0]?.status==='fulfilled')value=second[0].value;
    }
    return value!;
  }
  for(const kind of ['manager-revoke','own-expire','own-revoke'] as const){
    it(`revalida ${kind} depois de bloqueio real sem alterações parciais`,async()=>fixture(async f=>{
      // Login before acquiring the lock so the observed wait is the operation itself.
      await f.list(kind==='manager-revoke'?f.ids.manager:f.ids.resident);
      const before=await sqlClient`select to_jsonb(r) as row from reservations r where id=${f.own}`;
      const result=await locked(f,()=>kind==='manager-revoke'
        ?f.request(f.ids.manager,`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'}).then(r=>r.status)
        :as(f.ids.resident,tx=>tx.execute(sql`select app_cancel_own_reservation(${f.own})`)).then(()=>200,error=>pgErrorCode(error)),async()=>{
          if(kind==='manager-revoke')await sqlClient`update role_bindings set active=false where id=${f.binding}`;
          else if(kind==='own-revoke')await sqlClient`update role_bindings set active=false where user_id=${f.ids.resident}`;
          else {await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '0.1 second' where user_id=${f.ids.resident}`;await sqlClient`select pg_sleep(0.15)`;}
        });
      assert.equal(result,kind==='manager-revoke'?404:'42501');
      assert.deepEqual(await sqlClient`select to_jsonb(r) as row from reservations r where id=${f.own}`,before);
      assert.equal((await sqlClient`select id from audit_logs where building_id=${f.a}`).length,0);
    }));
  }
  it("falha de auditoria desfaz criação, decisão e cancelamento sem registrar parâmetros privados",async t=>fixture(async f=>{
    const logger=t.mock.method(console,'error',()=>undefined),name='res_audit_failure_'+randomUUID().replaceAll('-','');
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.building_id=TG_ARGV[0] then raise exception 'audit rejected'; end if; return NEW; end $$`);
    await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.a}')`);
    try{
      const before=await sqlClient`select to_jsonb(r) as row from reservations r where building_id=${f.a} order by id`;
      for(const [user,path,method,body] of [[f.ids.resident,'/reservations','POST',booking(f.area)],[f.ids.manager,`/reservations/${f.own}/decision`,'POST',{status:'CONFIRMED'}],[f.ids.resident,`/reservations/${f.own}`,'DELETE',undefined]] as const){
        await status(await f.request(user,path,method,body),500);
        assert.deepEqual(await sqlClient`select to_jsonb(r) as row from reservations r where building_id=${f.a} order by id`,before);
      }
      assert.equal(logger.mock.callCount(),0);
    }finally{await sqlClient.unsafe(`drop trigger ${name} on audit_logs`);await sqlClient.unsafe(`drop function ${name}()`);}
  }));
});
