import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import postgres from 'postgres';
import { applyInfrastructure, checkInfrastructure, loadInfrastructureMigrations } from '../src/infrastructure-migrations.js';

const execute=promisify(execFile);
const container=process.env.TEST_BACKUP_CONTAINER;
const administrativeUrl=process.env.TEST_MIGRATIONS_DATABASE_URL;
const cwd=fileURLToPath(new URL('../',import.meta.url));

/** Both databases are created by this test; the configured database is never
 * dumped, restored, seeded or dropped. No DSN is passed in process arguments. */
it('restores a real Timescale archive with data, migration history and restricted authority intact',{
  skip:!container||!administrativeUrl,timeout:120_000,
},async t=>{
  assert.match(container!,/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
  const admin=postgres(administrativeUrl!,{max:1,onnotice:()=>{}});
  const url=new URL(administrativeUrl!),user=decodeURIComponent(url.username);
  const suffix=randomUUID().replaceAll('-',''),sourceName=`backup_src_${suffix}`,targetName=`backup_dst_${suffix}`;
  const dump=`/tmp/predioon_${suffix}.dump`;
  const connection=(name:string)=>{const dbUrl=new URL(url);dbUrl.pathname=`/${name}`;return postgres(dbUrl.toString(),{max:1,onnotice:()=>{}});};
  const source=connection(sourceName),target=connection(targetName);let sourceCreated=false,targetCreated=false,failed=false;
  const docker=(args:string[])=>execute('docker',['exec',container!,...args],{timeout:45_000,maxBuffer:2*1024*1024,windowsHide:true});
  try{
    // Refuse a container/DSN mismatch before creating anything.
    const [identity]=await admin`select system_identifier::text as id from pg_control_system()`;
    const physical=await docker(['psql','-X','-U',user,'-d',decodeURIComponent(url.pathname.slice(1)),'-At','-v','ON_ERROR_STOP=1','-c','select system_identifier::text from pg_control_system()']);
    assert.equal(physical.stdout.trim(),identity!.id,'Docker and SQL must identify the same isolated test cluster');
    await admin.unsafe(`create database "${sourceName}"`);sourceCreated=true;
    const sourceUrl=new URL(url);sourceUrl.pathname=`/${sourceName}`;
    await execute(process.execPath,['--import','tsx','src/bootstrap.ts'],{cwd,env:{...process.env,DATABASE_URL:sourceUrl.toString()},timeout:30_000,windowsHide:true});
    const migrations=await loadInfrastructureMigrations();
    await applyInfrastructure(source,migrations);
    await source`insert into organizations(id,name,slug) values('restore-org','Recovery fixture','restore-org')`;
    await source`insert into buildings(id,organization_id,name,code) values('restore-a','restore-org','Restore A','A'),('restore-b','restore-org','Restore B','B')`;
    await source`insert into users(id,email,name) values('restore-reader','restore-reader@example.invalid','Recovery reader'),('restore-neighbor','restore-neighbor@example.invalid','Recovery neighbor')`;
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
        columns:await client`select c.relname,a.attname,a.attacl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by c.relname,a.attname`,
        policies:await client`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname`,
        tables:await client`select c.relname,c.relrowsecurity,c.relforcerowsecurity,array(select acl::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) acl order by 1) as privileges,pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`,
        helpers:await client`select p.proname,pg_get_function_identity_arguments(p.oid) args,p.prosecdef,p.provolatile,p.proconfig,array(select acl::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) acl order by 1) as privileges,pg_get_userbyid(p.proowner) as owner,md5(pg_get_functiondef(p.oid)) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,4)='app_' order by p.proname,args`,
      };
    }
    const expected=await snapshot(source);
    const started=Date.now();
    await docker(['pg_dump','-U',user,'-d',sourceName,'--format=custom',`--file=${dump}`]);
    await admin.unsafe(`create database "${targetName}"`);targetCreated=true;
    await target`create extension if not exists timescaledb`;
    await target`select timescaledb_pre_restore()`;
    // Timescale catalogs require a serial restore, not pg_restore -j.
    await docker(['pg_restore','-U',user,'-d',targetName,'--exit-on-error',dump]);
    await target`select timescaledb_post_restore()`;
    assert.deepEqual(await snapshot(target),expected);
    const history=await checkInfrastructure(target,migrations);
    assert.deepEqual(history,[]);
    assert.deepEqual(await applyInfrastructure(target,migrations),[],'restored ledger is valid without replaying privileges');
    const [chunks]=await target`select count(*)::integer n from timescaledb_information.chunks where hypertable_name='telemetry'`;
    assert.ok(chunks!.n>=2,'historical and recent telemetry chunks both survive');
    await target.begin(async tx=>{
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id','restore-reader',true),set_config('app.role','PLATFORM_ADMIN',true)`;
      assert.deepEqual((await tx`select protocol from occurrences`).map(row=>row.protocol),['RESTORE-OWN']);
      assert.deepEqual((await tx`select opening_balance_cents::text cents from financial_reports`).map(row=>row.cents),['12345']);
      assert.equal((await tx`select * from telemetry`).length,0,'resident cannot read raw telemetry after restoration');
      assert.deepEqual((await tx`select numeric_value from app_published_water_levels('restore-a')`).map(row=>row.numeric_value),[73]);
    });
    await assert.rejects(target.begin(async tx=>{await tx`set local role predioon_app`;await tx`delete from financial_reports`;}),error=>(error as {code?:string}).code==='42501');
    await target`update role_bindings set active=false where user_id='restore-reader'`;
    await target.begin(async tx=>{
      await tx`set local role predioon_app`;
      await tx`select set_config('app.user_id','restore-reader',true),set_config('app.role','PLATFORM_ADMIN',true)`;
      assert.equal((await tx`select id from occurrences`).length,0);
      assert.equal((await tx`select id from financial_reports`).length,0);
      assert.equal((await tx`select * from app_published_water_levels('restore-a')`).length,0);
    });
    await target`insert into telemetry(event_id,building_id,device_id,metric,value,numeric_value,time) values('restore-after','restore-a','restore-sensor','water_level_percent','74'::jsonb,74,clock_timestamp()+interval '1 second')`;
    assert.equal(Number((await source`select count(*) as n from telemetry`)[0]!.n),2,'restored writes never touch the source');
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
    if(targetCreated)await cleanup('drop isolated target',()=>admin.unsafe(`drop database "${targetName}"`));
    if(sourceCreated)await cleanup('drop isolated source',()=>admin.unsafe(`drop database "${sourceName}"`));
    await cleanup('close administrative connection',()=>admin.end({timeout:5}));
    await cleanup('remove isolated archive',()=>docker(['rm','-f','--',dump]));
    if(cleanupFailures.length){
      const message=`Backup test cleanup failed: ${cleanupFailures.join(', ')}`;
      if(failed)t.diagnostic(message);else throw new Error(message);
    }
  }
});
