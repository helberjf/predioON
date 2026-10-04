import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import postgres from 'postgres';
import { applyInfrastructure, checkInfrastructure, loadInfrastructureMigrations } from '../src/infrastructure-migrations.js';

const execute=promisify(execFile);
const container=process.env.TEST_BACKUP_CONTAINER;
const administrativeUrl=process.env.TEST_MIGRATIONS_DATABASE_URL;
const recoveryContainer=process.env.TEST_BACKUP_RESTORE_CONTAINER;
const recoveryUrl=process.env.TEST_BACKUP_RESTORE_DATABASE_URL;
const cwd=fileURLToPath(new URL('../',import.meta.url));
const runtimeRoles=['predioon_app','predioon_identity','predioon_broker_auth','predioon_notifications'] as const;
type RuntimeRole=typeof runtimeRoles[number];
const notificationTables=['outbox_events','event_deliveries','delivery_witnesses','delivery_witness_features','notification_attempts'];

async function snapshot(client:postgres.Sql){
  const tables=await client`select tablename from pg_tables where schemaname='public' order by tablename`;
  const data=[];
  for(const {tablename}of tables){
    const [row]=await client`select count(*)::integer as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from ${client(tablename)} t`;
    data.push({table:tablename,...row});
  }
  // pg_dump can canonicalize an explicit default ACL to NULL. Compare its
  // effective privileges, retaining grantor/grantee/grant-option details.
  return {data,
    database:await client`select pg_get_userbyid(datdba) as owner,array(select acl::text from unnest(coalesce(datacl,acldefault('d',datdba))) acl order by 1) as privileges from pg_database where datname=current_database()`,
    columns:await client`select c.relname,a.attname,a.attacl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by c.relname,a.attname`,
    policies:await client`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname`,
    tables:await client`select c.relname,c.relrowsecurity,c.relforcerowsecurity,array(select acl::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) acl order by 1) as privileges,pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`,
    helpers:await client`select p.proname,pg_get_function_identity_arguments(p.oid) args,p.prosecdef,p.provolatile,p.proconfig,array(select acl::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) acl order by 1) as privileges,pg_get_userbyid(p.proowner) as owner,md5(pg_get_functiondef(p.oid)) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (left(p.proname,4)='app_' or left(p.proname,9)='identity_' or left(p.proname,13)='notification_') order by p.proname,args`,
  };
}

async function provisionRuntime(ownerUrl:URL):Promise<Record<RuntimeRole,string>>{
  const environment:Record<string,string|undefined>={...process.env,DATABASE_URL:ownerUrl.toString()};
  const connections={} as Record<RuntimeRole,string>;
  for(const [variable,role] of [['DATABASE_URL_APP','predioon_app'],['DATABASE_URL_IDENTITY','predioon_identity'],['DATABASE_URL_BROKER_AUTH','predioon_broker_auth'],['DATABASE_URL_NOTIFICATIONS','predioon_notifications']] as const){
    const url=new URL(ownerUrl);url.username=role;url.password=randomUUID();
    environment[variable]=url.toString();connections[role]=url.toString();
  }
  await execute(process.execPath,['--import','tsx','src/provision-runtime-roles.ts'],{cwd,env:environment,timeout:30_000,windowsHide:true});
  return connections;
}

async function restrictedRoles(client:postgres.Sql,login:boolean){
  const roles=await client`select rolname,rolcanlogin,rolsuper,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,
    exists(select 1 from pg_auth_members m where m.member=r.oid or m.roleid=r.oid) as membership,
    exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=r.oid and d.deptype='o') as owns_objects
    from pg_roles r where rolname=any(${[...runtimeRoles]}) order by rolname`;
  assert.equal(roles.length,4,'all four runtime roles must exist independently of the database archive');
  for(const role of roles)assert.deepEqual(role,{rolname:role.rolname,rolcanlogin:login,rolsuper:false,rolinherit:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,membership:false,owns_objects:false});
}

async function notificationFixture(source:postgres.Sql,connections:Record<RuntimeRole,string>){
  await source`insert into organizations(id,name,slug) values('restore-notify-org','Notification recovery','restore-notify-org')`;
  await source`insert into buildings(id,organization_id,name,code) values('restore-notify-a','restore-notify-org','Notification A','NA'),('restore-notify-b','restore-notify-org','Notification B','NB')`;
  await source`insert into users(id,email,name,is_platform_admin) values('restore-notify-admin','restore-notify-admin@example.invalid','Notification admin',true)`;
  await source`insert into devices(id,building_id,name,type) values('restore-notify-any','restore-notify-a','ANY meter','ENERGY_METER'),('restore-notify-water','restore-notify-a','Water sensor','WATER_LEVEL_SENSOR')`;
  const transition=async(feature:string,enabled:boolean)=>source.begin(async tx=>{
    await tx`select set_config('app.user_id','restore-notify-admin',true)`;
    await tx`insert into building_feature_settings(building_id,feature_key,enabled) values('restore-notify-a',${feature},${enabled}) on conflict(building_id,feature_key) do update set enabled=excluded.enabled`;
    await tx`select app_apply_feature_transition('restore-notify-a',${feature},${enabled})`;
  });
  await transition('ELECTRICAL',false);await transition('ELECTRICAL',true);
  const enqueued=async(options:{water?:boolean;future?:boolean;low?:boolean;all?:boolean}={})=>source.begin(async tx=>{
    const id=randomUUID();let rule:string|null=null;
    if(options.all){rule=randomUUID();await tx`insert into alert_rules(id,building_id,device_id,name,metric,operator,threshold,alert_type,message_template) values(${rule},'restore-notify-a','restore-notify-any',${rule},'unknown_metric','GT',1,'RESTORE_RULE','private restored rule')`;}
    await tx`insert into alerts(id,building_id,device_id,rule_id,severity,type,message,triggered_at) values(${id},'restore-notify-a',${options.water?'restore-notify-water':'restore-notify-any'},${rule},${options.low?'LOW':'HIGH'}::alert_severity,'COMMUNICATION_LOST','private restored alert',clock_timestamp()+${options.future?'60 seconds':'0 seconds'}::interval)`;
    const [event]=await tx`select notification_enqueue_alert(${id}::uuid) as id`;
    const [delivery]=await tx`select id from event_deliveries where event_id=${event!.id}::uuid`;
    return {alertId:id,eventId:String(event!.id),deliveryId:delivery?String(delivery.id):null};
  });
  const reserved=async(expectedId:string)=>{
    const client=postgres(connections.predioon_notifications,{max:1,idle_timeout:0,onnotice:()=>{}});
    try{
      assert.equal((await client`select current_user as role`)[0]!.role,'predioon_notifications');
      await client`select notification_begin_attempt()`;
      const claims=await client`select * from notification_claim(1)`;
      assert.equal(claims.length,1);assert.equal(claims[0]!.delivery_id,expectedId);
      return {client,claim:claims[0]!};
    }catch(error){await client.end({timeout:0});throw error;}
  };
  const states={} as Record<string,Awaited<ReturnType<typeof enqueued>>>;
  for(const [status,outcome,http] of [['delivered','http',204],['failed','http',400],['no_destination','no_destination',null],['retry','http',503]] as const){
    states[status]=await enqueued();const {client,claim}=await reserved(states[status]!.deliveryId!);
    try{
      const [completed]=await client`select notification_complete(${claim.delivery_id}::uuid,${claim.claim_token}::uuid,${outcome},${http},${status==='retry'?300:null}) as status`;
      assert.equal(completed!.status,status);assert.equal((await client`select notification_end_attempt() as closed`)[0]!.closed,true);
    }finally{await client.end({timeout:0});}
  }
  states.cancelled=await enqueued({water:true,future:true});
  await transition('WATER_TANK',false);await transition('WATER_TANK',true);
  states.inflight=await enqueued();
  const {client,claim}=await reserved(states.inflight.deliveryId!);
  let idempotencyKey:string;
  try{
    const payload=await client`select * from notification_revalidate(${claim.delivery_id}::uuid,${claim.claim_token}::uuid)`;
    assert.equal(payload.length,1);idempotencyKey=String(payload[0]!.idempotency_key);
    // Close the actual backend without end_attempt: the archive keeps its
    // inflight lease/token and stale registration, never a synthetic PID.
  }finally{await client.end({timeout:0});}
  states.pending=await enqueued({all:true});
  const low=await enqueued({low:true});assert.equal(low.deliveryId,null);
  const rows=await source`select status,count(*)::int n from event_deliveries group by status order by status`;
  assert.deepEqual(rows.map(row=>[row.status,row.n]),['cancelled','delivered','failed','inflight','no_destination','pending','retry'].map(status=>[status,1]));
  assert.equal((await source`select count(*)::int n from notification_attempts`)[0]!.n,1);
  return {states,claim,idempotencyKey,low};
}

async function verifyNotificationRecovery(source:postgres.Sql,target:postgres.Sql,connections:Record<RuntimeRole,string>,fixture:Awaited<ReturnType<typeof notificationFixture>>){
  const immutable=async(client:postgres.Sql)=>({events:await client`select * from outbox_events order by id`,clauses:await client`select * from delivery_witnesses order by delivery_id,clause_id`,features:await client`select * from delivery_witness_features order by delivery_id,clause_id,feature_key`});
  const origins=await immutable(target);
  assert.deepEqual(origins,await immutable(source));
  assert.deepEqual((await target`select clause_id,feature_key,generation from delivery_witness_features where delivery_id=${fixture.states.inflight!.deliveryId}::uuid order by clause_id,feature_key`).map(row=>[row.clause_id,row.feature_key,row.generation]),[[1,'ENERGY_CONSUMPTION',0],[2,'ELECTRICAL',2]]);
  assert.deepEqual((await target`select clause_id,feature_key from delivery_witness_features where delivery_id=${fixture.states.pending!.deliveryId}::uuid order by clause_id,feature_key`).map(row=>[row.clause_id,row.feature_key]),[[1,'ELECTRICAL'],[1,'ENERGY_CONSUMPTION']]);
  for(const role of runtimeRoles){
    const restricted=postgres(connections[role],{max:1,onnotice:()=>{}});
    try{
      for(const table of notificationTables)await assert.rejects(restricted.unsafe(`select * from ${table}`),error=>(error as {code?:string}).code==='42501');
      await assert.rejects(restricted`select * from schema_migrations`,error=>(error as {code?:string}).code==='42501');
      if(role!=='predioon_notifications')await assert.rejects(restricted`select notification_begin_attempt()`,error=>(error as {code?:string}).code==='42501');
      else{
        await assert.rejects(restricted`select password_hash from users`,error=>(error as {code?:string}).code==='42501');
        await assert.rejects(restricted`select notification_enqueue_alert(${fixture.states.pending!.alertId}::uuid)`,error=>(error as {code?:string}).code==='42501');
        await assert.rejects(restricted`update event_deliveries set status='delivered'`,error=>(error as {code?:string}).code==='42501');
        await assert.rejects(restricted`insert into notification_attempts(backend_pid,backend_start,opened_at) values(pg_backend_pid(),clock_timestamp(),clock_timestamp())`,error=>(error as {code?:string}).code==='42501');
      }
      await assert.rejects(restricted`create temp table restore_runtime_escape(id int)`,error=>(error as {code?:string}).code==='42501');
    }finally{await restricted.end({timeout:0});}
  }
  const worker=postgres(connections.predioon_notifications,{max:1,idle_timeout:0,onnotice:()=>{}});
  try{
    await worker`select notification_begin_attempt()`;
    assert.equal((await worker`select * from notification_revalidate(${fixture.claim.delivery_id}::uuid,${fixture.claim.claim_token}::uuid)`).length,0,'a restored token never authorizes a new backend');
    assert.equal((await worker`select notification_complete(${fixture.claim.delivery_id}::uuid,${fixture.claim.claim_token}::uuid,'http',204) as status`)[0]!.status,'stale');
    assert.equal((await worker`select notification_end_attempt() as closed`)[0]!.closed,true);
    const [remaining]=await target`select greatest(0,extract(epoch from (${fixture.claim.lease_until}::timestamptz-clock_timestamp())))*1000 as milliseconds`;
    const milliseconds=Number(remaining!.milliseconds);assert.ok(Number.isFinite(milliseconds)&&milliseconds<=20_000);
    await delay(milliseconds+30);
    await worker`select notification_begin_attempt()`;
    const claims=await worker`select * from notification_claim(1)`;assert.equal(claims.length,1);
    const reclaimed=claims[0]!;assert.equal(reclaimed.delivery_id,fixture.claim.delivery_id);assert.notEqual(reclaimed.claim_token,fixture.claim.claim_token);
    const payload=await worker`select * from notification_revalidate(${reclaimed.delivery_id}::uuid,${reclaimed.claim_token}::uuid)`;
    assert.equal(payload.length,1);assert.equal(payload[0]!.idempotency_key,fixture.idempotencyKey,'lease recovery reuses the external idempotency identity');
    assert.equal((await worker`select notification_complete(${reclaimed.delivery_id}::uuid,${reclaimed.claim_token}::uuid,'http',204) as status`)[0]!.status,'delivered');
    assert.equal((await worker`select notification_end_attempt() as closed`)[0]!.closed,true);
  }finally{await worker.end({timeout:0});}
  assert.equal((await target`select attempts from event_deliveries where id=${fixture.claim.delivery_id}::uuid`)[0]!.attempts,2);
  assert.equal((await source`select claim_token from event_deliveries where id=${fixture.claim.delivery_id}::uuid`)[0]!.claim_token,fixture.claim.claim_token,'recovery cannot alter the backup origin');
  assert.equal((await target`select count(*)::int n from notification_attempts`)[0]!.n,0,'stale restored backend registrations are cleaned by the protocol');
  const transition=async(enabled:boolean)=>target.begin(async tx=>{
    await tx`select set_config('app.user_id','restore-notify-admin',true)`;
    await tx`insert into building_feature_settings(building_id,feature_key,enabled) values('restore-notify-a','ENERGY_CONSUMPTION',${enabled}) on conflict(building_id,feature_key) do update set enabled=excluded.enabled`;
    await tx`select app_apply_feature_transition('restore-notify-a','ENERGY_CONSUMPTION',${enabled})`;
  });
  await transition(false);
  assert.equal((await target`select status from event_deliveries where id=${fixture.states.pending!.deliveryId}::uuid`)[0]!.status,'cancelled','restored ALL origin loses either required feature');
  assert.equal((await target`select status from event_deliveries where id=${fixture.states.retry!.deliveryId}::uuid`)[0]!.status,'retry','restored ANY origin retains its captured electrical alternative');
  await transition(true);
  for(const status of ['cancelled','pending'])assert.equal((await target`select status from event_deliveries where id=${fixture.states[status]!.deliveryId}::uuid`)[0]!.status,'cancelled','resume does not resurrect a restored tombstone');
  for(const table of ['outbox_events','delivery_witnesses','delivery_witness_features'])await assert.rejects(target.unsafe(`update ${table} set ${table==='outbox_events'?'event_version=event_version':table==='delivery_witnesses'?'clause_id=clause_id':'generation=generation'}`),error=>(error as {code?:string}).code==='42501');
  assert.deepEqual(await immutable(target),origins,'source witnesses stay immutable across restore, reclaim and feature transitions');
  assert.equal((await target`select notification_enqueue_alert(${fixture.states.delivered!.alertId}::uuid) as id`)[0]!.id,fixture.states.delivered!.eventId,'terminal replay keeps the original event identity');
  assert.equal((await target`select count(*)::int n from outbox_events`)[0]!.n,8);
  assert.equal((await target`select count(*)::int n from event_deliveries`)[0]!.n,7);
}

/** Both databases are created by this test; the configured database is never
 * dumped, restored, seeded or dropped. No DSN is passed in process arguments. */
for(const separateCluster of [false,true])it(`restores a real Timescale archive with data, migration history and restricted authority intact (${separateCluster?'independent cluster':'same cluster'})`,{
  skip:!container||!administrativeUrl||(separateCluster&&(!recoveryContainer||!recoveryUrl)),timeout:180_000,
},async t=>{
  assert.match(container!,/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  const admin=postgres(administrativeUrl!,{max:1,onnotice:()=>{}});
  const url=new URL(administrativeUrl!),user=decodeURIComponent(url.username);
  const destinationContainer=separateCluster?recoveryContainer!:container!;
  const destinationUrl=new URL(separateCluster?recoveryUrl!:administrativeUrl!);
  assert.match(destinationContainer,/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  assert.match(url.hostname,/^(localhost|127\.0\.0\.1)$/);assert.match(destinationUrl.hostname,/^(localhost|127\.0\.0\.1)$/);
  assert.equal(decodeURIComponent(destinationUrl.username),user,'restore preserves the original owner name');
  const destinationAdmin=separateCluster?postgres(destinationUrl.toString(),{max:1,onnotice:()=>{}}):admin;
  const suffix=randomUUID().replaceAll('-',''),sourceName=`backup_src_${suffix}`,targetName=`backup_dst_${suffix}`;
  const dump=`/tmp/predioon_${suffix}.dump`;
  const connection=(name:string,base:URL=url)=>{const dbUrl=new URL(base);dbUrl.pathname=`/${name}`;return postgres(dbUrl.toString(),{max:1,onnotice:()=>{}});};
  const source=connection(sourceName),target=connection(targetName,destinationUrl);let sourceCreated=false,targetCreated=false,failed=false;
  let transferDirectory:string|undefined;const createdRoles:RuntimeRole[]=[];
  const docker=(args:string[],cluster=container!)=>execute('docker',['exec',cluster,...args],{timeout:45_000,maxBuffer:2*1024*1024,windowsHide:true});
  try{
    // Refuse a container/DSN mismatch before creating anything.
    const [identity]=await admin`select system_identifier::text as id from pg_control_system()`;
    const physical=await docker(['psql','-X','-U',user,'-d',decodeURIComponent(url.pathname.slice(1)),'-At','-v','ON_ERROR_STOP=1','-c','select system_identifier::text from pg_control_system()']);
    assert.equal(physical.stdout.trim(),identity!.id,'Docker and SQL must identify the same isolated test cluster');
    if(separateCluster){
      const [destinationIdentity]=await destinationAdmin`select system_identifier::text as id from pg_control_system()`;
      const destinationPhysical=await docker(['psql','-X','-U',user,'-d',decodeURIComponent(destinationUrl.pathname.slice(1)),'-At','-v','ON_ERROR_STOP=1','-c','select system_identifier::text from pg_control_system()'],destinationContainer);
      assert.equal(destinationPhysical.stdout.trim(),destinationIdentity!.id);
      assert.notEqual(destinationIdentity!.id,identity!.id,'independent restore needs a genuinely different physical cluster');
      assert.equal((await destinationAdmin`select count(*)::int n from pg_roles where rolname=any(${[...runtimeRoles]})`)[0]!.n,0,'destination must have no inherited runtime role state');
      for(const role of runtimeRoles){await destinationAdmin.unsafe(`create role ${role} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);createdRoles.push(role);}
      await restrictedRoles(destinationAdmin,false);
    }
    await admin.unsafe(`create database "${sourceName}"`);sourceCreated=true;
    const sourceUrl=new URL(url);sourceUrl.pathname=`/${sourceName}`;
    await execute(process.execPath,['--import','tsx','src/bootstrap.ts'],{cwd,env:{...process.env,DATABASE_URL:sourceUrl.toString()},timeout:30_000,windowsHide:true});
    const migrations=await loadInfrastructureMigrations();
    await applyInfrastructure(source,migrations);
    assert.equal(migrations.length,38,'recovery fixture includes the complete immutable SQL038 ledger');
    const sourceConnections=await provisionRuntime(sourceUrl);
    await restrictedRoles(source,true);
    await source`insert into organizations(id,name,slug) values('restore-org','Recovery fixture','restore-org')`;
    await source`insert into buildings(id,organization_id,name,code) values('restore-a','restore-org','Restore A','A'),('restore-b','restore-org','Restore B','B')`;
    await source`insert into users(id,email,name) values('restore-reader','restore-reader@example.invalid','Recovery reader'),('restore-neighbor','restore-neighbor@example.invalid','Recovery neighbor')`;
    // This fixture exercises the SQL transition after restore, not Argon2.
    // The trusted identity service supplies the encoded hash in production.
    const previousHash='$argon2id$recovery-observed-fixture',replacementHash='$argon2id$recovery-replacement-fixture';
    const ownSession=randomUUID(),otherSession=randomUUID(),peerSession=randomUUID();
    await source`insert into users(id,email,name,password_hash) values('restore-password','restore-password@example.invalid','Recovery password owner',${previousHash})`;
    await source`insert into sessions(id,user_id,expires_at) values(${ownSession},'restore-password',clock_timestamp()+interval '2 hours'),(${otherSession},'restore-password',clock_timestamp()+interval '2 hours'),(${peerSession},'restore-neighbor',clock_timestamp()+interval '2 hours')`;
    await source`insert into role_bindings(user_id,building_id,role_key) values('restore-reader','restore-a','RESIDENT')`;
    await source`insert into devices(id,building_id,name,type) values('restore-sensor','restore-a','Recovery sensor','WATER_LEVEL_SENSOR')`;
    await source`insert into telemetry(event_id,building_id,device_id,metric,value,numeric_value,time)
      values('restore-event-old','restore-a','restore-sensor','water_level_percent','42'::jsonb,42,clock_timestamp()-interval '15 days'),
            ('restore-event-now','restore-a','restore-sensor','water_level_percent','73'::jsonb,73,clock_timestamp())`;
    await source`insert into occurrences(building_id,protocol,title,description,category,opened_by)
      values('restore-a','RESTORE-OWN','Own fixture','Private own text','GENERAL','restore-reader'),
            ('restore-a','RESTORE-NEIGHBOR','Neighbor fixture','Private neighbor text','GENERAL','restore-neighbor')`;
    await source`insert into financial_reports(building_id,month,title,summary,opening_balance_cents,created_by,published_by,published_at)
      values('restore-a','2026-10','Published fixture','Financial fixture',12345,'restore-reader','restore-reader',clock_timestamp()-interval '1 minute'),
            ('restore-b','2026-10','Foreign fixture','Private foreign finance',99999,'restore-neighbor','restore-neighbor',clock_timestamp()-interval '1 minute')`;
    await source`insert into users(id,email,name) values('restore-global-auditor','restore-global@example.invalid','Global audit reader')`;
    await source`insert into roles(key,scope,label) values('RESTORE_AUDIT_LOCAL','BUILDING','Recovery local audit')`;
    await source`insert into role_permissions(role_key,permission_key) values('RESTORE_AUDIT_LOCAL','audit:read')`;
    await source`insert into role_bindings(user_id,building_id,role_key) values('restore-reader','restore-a','RESTORE_AUDIT_LOCAL')`;
    await source`insert into role_bindings(user_id,role_key) values('restore-global-auditor','PLATFORM_ADMIN')`;
    await source`insert into audit_logs(building_id,user_id,action,resource_type,resource_id,metadata,ip_address,user_agent)
      values('restore-a','restore-reader','DEVICE_UPDATED','device','restore-sensor','{"private":"recovery fixture"}','192.0.2.1','Private fixture'),
            ('restore-b','restore-neighbor','DEVICE_UPDATED','device','restore-foreign','{}','192.0.2.2','Foreign fixture'),
            (null,'restore-reader','ORGANIZATION_CREATED','organization','restore-org','{}',null,null),
            (null,'restore-reader','DEVICE_UPDATED','device','restore-unclassified','{}',null,null)`;
    const notifications=await notificationFixture(source,sourceConnections);
    const expected=await snapshot(source);
    const started=Date.now();
    await docker(['pg_dump','-U',user,'-d',sourceName,'--format=custom',`--file=${dump}`]);
    const originalDigest=(await docker(['sha256sum',dump])).stdout.split(/\s+/)[0]!;assert.match(originalDigest,/^[a-f0-9]{64}$/);
    if(separateCluster){
      transferDirectory=await mkdtemp(join(tmpdir(),'predioon-backup-'));await chmod(transferDirectory,0o700);
      const archive=join(transferDirectory,'recovery.dump');
      await execute('docker',['cp',`${container}:${dump}`,archive],{timeout:45_000,windowsHide:true});await chmod(archive,0o600);
      assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),originalDigest);
      await execute('docker',['cp',archive,`${destinationContainer}:${dump}`],{timeout:45_000,windowsHide:true});
      assert.equal((await docker(['sha256sum',dump],destinationContainer)).stdout.split(/\s+/)[0],originalDigest,'archive bytes are unchanged between independent clusters');
    }
    await destinationAdmin.unsafe(`create database "${targetName}"`);targetCreated=true;
    // Restoring into a newly named database (without --create) restores object
    // ACLs, but not the database's own ACL. Prepare this reviewed boundary
    // explicitly; never replay an old migration or weaken the comparison.
    const [databaseAcl]=await target`select format('REVOKE CREATE,TEMP ON DATABASE %I FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth,predioon_notifications; GRANT CONNECT ON DATABASE %I TO predioon_app,predioon_identity,predioon_broker_auth,predioon_notifications',current_database(),current_database()) as ddl`;
    await target.unsafe(databaseAcl!.ddl);
    await target`create extension if not exists timescaledb`;
    await target`select timescaledb_pre_restore()`;
    // Timescale catalogs require a serial restore, not pg_restore -j.
    await docker(['pg_restore','-U',user,'-d',targetName,'--exit-on-error',dump],destinationContainer);
    await target`select timescaledb_post_restore()`;
    const restored=await snapshot(target);
    assert.ok(restored.helpers.some(row=>row.proname==='notification_begin_attempt'),'restored inventory must include notification_* authority');
    assert.deepEqual(restored,expected);
    const history=await checkInfrastructure(target,migrations);
    assert.deepEqual(history,[]);
    assert.deepEqual(await applyInfrastructure(target,migrations),[],'restored ledger is valid without replaying privileges');
    const targetOwnerUrl=new URL(destinationUrl);targetOwnerUrl.pathname=`/${targetName}`;
    const targetConnections=await provisionRuntime(targetOwnerUrl);
    await restrictedRoles(target,true);
    await verifyNotificationRecovery(source,target,targetConnections,notifications);
    for(const role of ['predioon_app','predioon_broker_auth','predioon_notifications']){
      await assert.rejects(target.begin(async tx=>{
        await tx.unsafe(`set local role ${role}`);
        await tx`select identity_replace_password('restore-password',${ownSession}::uuid,${previousHash},${replacementHash})`;
      }),error=>(error as {code?:string}).code==='42501','non-identity runtime cannot replace a credential after recovery');
    }
    await assert.rejects(target.begin(async tx=>{
      await tx`set local role predioon_identity`;
      await tx`update users set password_hash=${replacementHash} where id='restore-password'`;
    }),error=>(error as {code?:string}).code==='42501','identity runtime retains no direct credential UPDATE');
    await target.begin(async tx=>{
      await tx`set local role predioon_identity`;
      const [result]=await tx`select identity_replace_password('restore-password',${ownSession}::uuid,${previousHash},${replacementHash}) as replaced`;
      assert.equal(result!.replaced,true,'restored private helper can change its own active credential');
    });
    assert.equal((await target`select password_hash from users where id='restore-password'`)[0]!.password_hash,replacementHash);
    const changedFamilies=await target`select revoked_at,revoked_reason from sessions where user_id='restore-password'`;
    assert.equal(changedFamilies.length,2);
    assert.ok(changedFamilies.every(row=>row.revoked_at!==null&&row.revoked_reason==='PASSWORD_CHANGED'),'every restored family is revoked atomically');
    assert.equal((await target`select revoked_at from sessions where id=${peerSession}`)[0]!.revoked_at,null,'foreign restored account stays active');
    assert.equal((await source`select password_hash from users where id='restore-password'`)[0]!.password_hash,previousHash,'replacement never writes into the backup source');
    assert.ok((await source`select revoked_at from sessions where user_id='restore-password'`).every(row=>row.revoked_at===null),'source sessions stay active');
    await target.begin(async tx=>{
      await tx`set local role predioon_identity`;
      const [result]=await tx`select identity_replace_password('restore-password',${ownSession}::uuid,${previousHash},${replacementHash}) as replaced`;
      assert.equal(result!.replaced,false,'recovered helper cannot reuse a replaced hash and revoked family');
    });
    const [chunks]=await target`select count(*)::integer n from timescaledb_information.chunks where hypertable_name='telemetry'`;
    assert.ok(chunks!.n>=2,'historical and recent telemetry chunks both survive');
    await target.begin(async tx=>{
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id','restore-reader',true),set_config('app.role','PLATFORM_ADMIN',true)`;
      assert.deepEqual((await tx`select protocol from occurrences`).map(row=>row.protocol),['RESTORE-OWN']);
      assert.deepEqual((await tx`select opening_balance_cents::text cents from financial_reports`).map(row=>row.cents),['12345']);
      assert.equal((await tx`select * from telemetry`).length,0,'resident cannot read raw telemetry after restoration');
      assert.deepEqual((await tx`select numeric_value from app_published_water_levels('restore-a')`).map(row=>row.numeric_value),[73]);
      assert.deepEqual((await tx`select resource_id from audit_logs`).map(row=>row.resource_id),['restore-sensor'],'only the explicitly granted local audit survives recovery');
    });
    await target.begin(async tx=>{
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id','restore-global-auditor',true),set_config('app.role','RESIDENT',true)`;
      assert.deepEqual((await tx`select resource_id from audit_logs`).map(row=>row.resource_id),['restore-org'],'global audit grant does not expose local or unclassified history');
    });
    for(const column of ['metadata','ip_address','user_agent']){
      await assert.rejects(target.begin(async tx=>{await tx`set local role predioon_app`;await tx.unsafe(`select ${column} from audit_logs`);}),error=>(error as {code?:string}).code==='42501');
    }
    await assert.rejects(target.begin(async tx=>{await tx`set local role predioon_app`;await tx`delete from audit_logs`;}),error=>(error as {code?:string}).code==='42501');
    await assert.rejects(target.begin(async tx=>{await tx`set local role predioon_app`;await tx`delete from financial_reports`;}),error=>(error as {code?:string}).code==='42501');
    await target`update role_bindings set active=false where user_id='restore-reader'`;
    await target.begin(async tx=>{
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id','restore-reader',true),set_config('app.role','PLATFORM_ADMIN',true)`;
      assert.equal((await tx`select id from occurrences`).length,0);
      assert.equal((await tx`select id from financial_reports`).length,0);
      assert.equal((await tx`select * from app_published_water_levels('restore-a')`).length,0);
      assert.equal((await tx`select id from audit_logs`).length,0,'revocation is effective without rewriting the restored history');
    });
    await target`insert into telemetry(event_id,building_id,device_id,metric,value,numeric_value,time) values('restore-after','restore-a','restore-sensor','water_level_percent','74'::jsonb,74,clock_timestamp()+interval '1 second')`;
    assert.equal(Number((await source`select count(*) as n from telemetry`)[0]!.n),2,'restored writes never touch the source');
    await assert.rejects(target`update audit_logs set scope_kind='PLATFORM' where resource_id='restore-sensor'`,error=>(error as {code?:string}).code==='42501');
    await target`delete from buildings where id='restore-a'`;
    const [retained]=await target`select building_id,scope_kind,scope_building_id from audit_logs where resource_id='restore-sensor'`;
    assert.deepEqual(retained,{building_id:null,scope_kind:'BUILDING',scope_building_id:'restore-a'});
    await target.begin(async tx=>{
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id','restore-global-auditor',true),set_config('app.role','PLATFORM_ADMIN',true)`;
      assert.deepEqual((await tx`select resource_id from audit_logs`).map(row=>row.resource_id),['restore-org'],'deleting a tenant after restore does not promote its audit to global');
    });
    t.diagnostic(`Custom archive and serial restore verified in ${Date.now()-started}ms: ${expected.data.length} public tables, ${migrations.length} migrations, multiple telemetry chunks, policies, ACLs, helpers and real RLS.`);
  }catch(error){
    failed=true;throw error;
  }finally{
    // Attempt every cleanup independently, without hiding the original failure
    // or leaking connection details through cleanup diagnostics.
    const cleanupFailures:string[]=[];
    const cleanup=async(label:string,action:()=>Promise<unknown>)=>{try{await action();}catch{cleanupFailures.push(label);}};
    await cleanup('close source connections',()=>source.end({timeout:5}));
    await cleanup('close target connections',()=>target.end({timeout:5}));
    // Only the two random names successfully created by this test are dropped.
    if(targetCreated)await cleanup('drop isolated target',()=>destinationAdmin.unsafe(`drop database "${targetName}"`));
    if(sourceCreated)await cleanup('drop isolated source',()=>admin.unsafe(`drop database "${sourceName}"`));
    for(const role of createdRoles.reverse())await cleanup('drop newly created recovery runtime role',()=>destinationAdmin.unsafe(`drop role ${role}`));
    if(separateCluster)await cleanup('close recovery administrative connection',()=>destinationAdmin.end({timeout:5}));
    await cleanup('close administrative connection',()=>admin.end({timeout:5}));
    await cleanup('remove isolated archive',()=>docker(['rm','-f','--',dump]));
    if(separateCluster)await cleanup('remove transferred isolated archive',()=>docker(['rm','-f','--',dump],destinationContainer));
    if(transferDirectory)await cleanup('remove private archive transfer directory',async()=>{
      const ownedTransfer=resolve(transferDirectory!);
      assert.equal(dirname(ownedTransfer),resolve(tmpdir()));assert.match(basename(ownedTransfer),/^predioon-backup-[A-Za-z0-9]{6}$/);
      await rm(ownedTransfer,{recursive:true,force:true});
    });
    if(cleanupFailures.length){
      const message=`Backup test cleanup failed: ${cleanupFailures.join(', ')}`;
      if(failed)t.diagnostic(message);else throw new Error(message);
    }
  }
});
