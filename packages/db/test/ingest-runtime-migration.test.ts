import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, type TestContext } from "node:test";
import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import {
  assertServiceCatalogue, codeIs, createRuntimeServicesFixture, parseRuntimeServicesEnvironment,
  runtimeServicesSkipReason, safeDatabaseOperation, verifyOwnerPositiveControl, type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";

// Bounded Task4b: catalogue compatibility, contaminated installations and migration
// transactions. Operational service writes/races/trigger proofs remain later tasks.
const configuration = parseRuntimeServicesEnvironment(process.env);
const services = ["predioon_ingest", "predioon_access_service"] as const;
const oldRoles = ["predioon_app", "predioon_identity", "predioon_broker_auth", "predioon_notifications"];
const oldRoleList = oldRoles.map(role => `'${role}'`).join(",");
const operationalTables = new Set(["devices", "gateways", "buildings", "ingest_events", "ingest_rejections",
  "telemetry", "monitoring_profiles", "usage_cursors", "daily_usage", "alert_rules", "alerts", "parking_lots",
  "gates", "global_feature_settings", "building_feature_settings", "feature_runtime"]);
const query = <T>(label: string, operation: () => PromiseLike<T>) => safeDatabaseOperation(label, operation);
const privateEqual = (actual: unknown, expected: unknown, label: string) =>
  assert.ok(isDeepStrictEqual(actual, expected), label); // Never print private catalogue values or credential fingerprints.

type Policy = { oid: number; schema: string; table: string; name: string; roles: string[];
  command: string; permissive: boolean; qual: string | null; check: string | null };

async function policies(client: postgres.Sql): Promise<Policy[]> {
  return [...await query("private policy snapshot", () => client<Policy[]>`
    select p.oid::int, n.nspname as schema, c.relname as table, p.polname as name,
      array(select case when r=0 then 'public' else pg_get_userbyid(r)::text end
        from unnest(p.polroles) r order by 1) as roles,
      p.polcmd::text as command, p.polpermissive as permissive,
      pg_get_expr(p.polqual,p.polrelid) as qual, pg_get_expr(p.polwithcheck,p.polrelid) as check
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by n.nspname,c.relname,p.polname`)];
}

async function privateCatalogue(client: postgres.Sql): Promise<unknown> {
  // One statement gives a coherent committed view on the independent connection.
  // Credentials are fingerprinted inside PostgreSQL, retained only in memory and
  // compared as a boolean. No assertion ever receives this object as a diff.
  const [snapshot] = await query("full private committed catalogue snapshot", () => client`
    select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(r) order by oid) from (
        select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
          rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,
          case when rolpassword is null then null else encode(sha256(convert_to(rolpassword,'UTF8')),'hex') end as credential_fingerprint
        from pg_authid) r),
      'role_settings',(select jsonb_agg(to_jsonb(s) order by setrole,setdatabase) from pg_db_role_setting s),
      'memberships',(select jsonb_agg(to_jsonb(m) order by oid) from pg_auth_members m),
      'database',(select to_jsonb(d) - 'datfrozenxid' - 'datminmxid' from pg_database d where datname=current_database()),
      'schemas',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n
        where nspname='public' or nspname like 'ingest_runtime_%'),
      'relations',(select jsonb_agg(to_jsonb(r) order by oid) from (
        select c.oid,c.relnamespace,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
          c.relpersistence,c.relreplident,c.reloptions,pg_get_expr(c.relpartbound,c.oid) as partition_bound,
          case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) end as view_definition
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' or n.nspname like 'ingest_runtime_%') r),
      'columns',(select jsonb_agg(to_jsonb(a) order by attrelid,attnum) from pg_attribute a
        join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
        where a.attnum>0 and (n.nspname='public' or n.nspname like 'ingest_runtime_%')),
      'column_defaults',(select jsonb_agg(jsonb_build_object('oid',d.oid,'relation',d.adrelid,'column',d.adnum,
        'expression',pg_get_expr(d.adbin,d.adrelid)) order by d.oid) from pg_attrdef d
        join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'),
      'constraints',(select jsonb_agg(jsonb_build_object('row',to_jsonb(c),'definition',pg_get_constraintdef(c.oid)) order by c.oid)
        from pg_constraint c join pg_namespace n on n.oid=c.connamespace
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'),
      'indexes',(select jsonb_agg(jsonb_build_object('row',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid)) order by i.indexrelid)
        from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'),
      'triggers',(select jsonb_agg(jsonb_build_object('row',to_jsonb(t),'definition',pg_get_triggerdef(t.oid)) order by t.oid)
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'),
      'policies',(select jsonb_agg(jsonb_build_object('row',to_jsonb(p),'qual',pg_get_expr(p.polqual,p.polrelid),
        'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.oid) from pg_policy p
        join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'),
      'functions',(select jsonb_agg(jsonb_build_object('row',to_jsonb(p),'definition',pg_get_functiondef(p.oid)) order by p.oid)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.prokind in ('f','p') and (n.nspname='public' or n.nspname like 'ingest_runtime_%')),
      'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
      'shared_dependencies',(select jsonb_agg(to_jsonb(d) order by classid,objid,objsubid,refobjid,deptype)
        from pg_shdepend d where dbid=0 or dbid=(select oid from pg_database where datname=current_database())),
      'ledger',(select jsonb_agg(to_jsonb(m) order by id) from public.schema_migrations m),
      'data',(select jsonb_agg(to_jsonb(t) order by id) from public.runtime_services_fixture_control t)
    ) as private_snapshot`);
  return snapshot?.private_snapshot;
}

async function oldRoleState(client: postgres.Sql): Promise<unknown> {
  return [...await query("private old consumer identity snapshot", () => client.unsafe(`
    select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,
      rolbypassrls,rolconnlimit,rolvaliduntil,
      case when rolpassword is null then null else encode(sha256(convert_to(rolpassword,'UTF8')),'hex') end as credential_fingerprint
    from pg_authid where rolname in (${oldRoleList}) order by rolname`))];
}

async function existingFunctions(client: postgres.Sql): Promise<Array<{ oid: number; definition: unknown }>> {
  return [...await query("private existing human function definitions and ACL", () => client<Array<{ oid: number; definition: unknown }>>`
    select p.oid::int, jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,
      'definition',pg_get_functiondef(p.oid)) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p') order by p.oid`)];
}

async function oldConsumerGrants(client: postgres.Sql): Promise<unknown> {
  // Compare effective ACL entries belonging to the four old consumers and PUBLIC.
  // Global PUBLIC function default is the one separately tested intentional change.
  return [...await query("private old consumer ACL and default grants", () => client.unsafe(`
    with entries as (
      select 'relation' as kind,c.oid as object,0 as column_number,a.* from pg_class c
        join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,
          acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'
      union all select 'column',c.oid,t.attnum,a.* from pg_attribute t join pg_class c on c.oid=t.attrelid
        join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(t.attacl) a
        where t.attnum>0 and (n.nspname='public' or n.nspname like 'ingest_runtime_%')
      union all select 'schema',n.oid,0,a.* from pg_namespace n
        cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
        where n.nspname='public' or n.nspname like 'ingest_runtime_%'
      union all select 'database',d.oid,0,a.* from pg_database d
        cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a where d.datname=current_database()
      union all select 'default',d.oid,0,a.* from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
        where not (d.defaclnamespace=0 and d.defaclobjtype='f' and a.grantee=0)
    ) select * from entries where grantee=0 or grantee in (select oid from pg_roles where rolname in (${oldRoleList}))
      order by kind,object,column_number,grantor,grantee,privilege_type,is_grantable`))];
}

async function ledgerIs(fixture: RuntimeServicesFixture, length: 51 | 52): Promise<void> {
  const rows = [...await query("independent committed migration ledger", () => fixture.observer<Array<{ id: string; checksum: string }>[]>`
    select id,checksum from public.schema_migrations order by id`)];
  const expected = length === 51 ? fixture.canonicalHistory : [...fixture.canonicalHistory, fixture.candidate052!];
  assert.equal(rows.length, length);
  privateEqual(rows, expected, "committed ledger preserves every canonical source checksum");
}

async function serviceRolesAreRestricted(fixture: RuntimeServicesFixture): Promise<void> {
  const rows = await query("independent service identity and scope", () => fixture.observer.unsafe(`
    select r.rolname,not(r.rolsuper or r.rolinherit or r.rolcreaterole or r.rolcreatedb or r.rolcanlogin
      or r.rolreplication or r.rolbypassrls) as restricted,
      exists(select 1 from pg_auth_members m where m.roleid=r.oid or m.member=r.oid) as membership,
      exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=r.oid and d.deptype='o') as ownership
    from pg_roles r where r.rolname in ('predioon_ingest','predioon_access_service') order by rolname`));
  assert.equal(rows.length, 2, "052 creates both service roles");
  assert.ok(rows.every(row => row.restricted && !row.membership && !row.ownership),
    "both service roles are NOLOGIN, restricted, ownerless and without incoming/outgoing memberships");
}

async function baselineCase(operation: (fixture: RuntimeServicesFixture) => Promise<void>): Promise<void> {
  const fixture = await createRuntimeServicesFixture(configuration!, { baselineRelease: 51 });
  try {
    await verifyOwnerPositiveControl(fixture);
    await ledgerIs(fixture, 51);
    assert.ok(fixture.candidate052, "052 feature contract: the canonical candidate must exist after the real 051 owner control");
    await operation(fixture);
  } finally { await fixture.cleanup(); }
}

async function seedProbe(fixture: RuntimeServicesFixture): Promise<void> {
  await query("create only fixture-local contamination probes", () => fixture.owner.unsafe(`
    CREATE TABLE public.runtime_migration_probe(id uuid PRIMARY KEY, metadata jsonb, password_hash text);
    CREATE SEQUENCE public.runtime_migration_probe_seq;
    CREATE FUNCTION public.runtime_migration_probe_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';
  `));
}

async function assertAtomicGuard(fixture: RuntimeServicesFixture): Promise<void> {
  const before = await privateCatalogue(fixture.observer);
  // 42501 is the deliberate guard contract; syntax/setup and 25P02 never qualify.
  await assert.rejects(fixture.applyCandidate052(), codeIs("42501"));
  privateEqual(await privateCatalogue(fixture.observer), before,
    "guard abort preserves all committed roles, credentials, ACL/columns/defaults, RLS, definitions, ledger and synthetic data");
  await ledgerIs(fixture, 51);
}

// PostgreSQL forbids cycles: two UUID NOLOGIN probes exercise each new role as
// both grantor-role and member without granting membership to an old consumer.
// They own no objects and receive no ACL/default grants or cross-database rights.
async function withMembershipContamination(fixture: RuntimeServicesFixture, operation: () => Promise<void>): Promise<void> {
  const upstream = `ingest_runtime_up_${randomUUID().replaceAll("-", "")}`;
  const downstream = `ingest_runtime_down_${randomUUID().replaceAll("-", "")}`;
  const tracked = new Map<string, number>();
  try {
    for (const name of [upstream, downstream]) {
      assert.match(name, /^ingest_runtime_(up|down)_[a-f0-9]{32}$/);
      const oid = await query("create exact UUID membership probe", () => fixture.owner.begin(async transaction => {
        const [absent] = await transaction`select not exists(select 1 from pg_roles where rolname=${name}) as absent`;
        assert.ok(absent?.absent, "UUID membership role must be absent initially");
        await transaction.unsafe(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
        const [created] = await transaction`select oid::int from pg_roles where rolname=${name}`;
        assert.ok(created?.oid, "record UUID membership role immediately after creation");
        return created.oid as number;
      }));
      tracked.set(name, oid);
    }
    await query("grant only scoped membership contamination", () => fixture.owner.unsafe(`
      GRANT "${upstream}" TO predioon_ingest,predioon_access_service;
      GRANT predioon_ingest,predioon_access_service TO "${downstream}";
    `));
    await operation();
  } finally {
    // Restore the exact two intentionally contaminated role flags even when an
    // assertion/candidate fails, so normal UUID/OID cleanup can remove new roles.
    await fixture.ensureServiceRoles();
    // Check every recorded identity before any cleanup mutation. Revoke only the
    // four exact edges this helper created; never DROP OWNED or broad membership.
    for (const [name, oid] of tracked) {
      await query("verify exact UUID membership probe identity", async () => {
        const [role] = await fixture.owner`select oid::int,not rolcanlogin as no_login,
          not exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass
            and d.refobjid=r.oid and d.deptype='o') as no_ownership from pg_roles r where rolname=${name}`;
        assert.ok(role?.oid === oid && role.no_login && role.no_ownership, "UUID role identity and ownerless scope must remain intact");
      });
    }
    for (const name of tracked.keys()) await query("remove only exact UUID probe edges and role", async () => {
      await fixture.owner.unsafe(name === upstream
        ? `REVOKE "${name}" FROM predioon_ingest,predioon_access_service`
        : `REVOKE predioon_ingest,predioon_access_service FROM "${name}"`);
      const [scope] = await fixture.owner`select not exists(select 1 from pg_auth_members m
        join pg_roles r on r.oid=m.roleid or r.oid=m.member where r.rolname=${name}) as clean`;
      assert.ok(scope?.clean, "no unexpected UUID role memberships may be removed");
      await fixture.owner.unsafe(`DROP ROLE "${name}"`);
    });
  }
}

describe("052 ingest/access catalogue migration on real PostgreSQL", { concurrency: false,
  skip: configuration ? false : runtimeServicesSkipReason }, () => {
  let initial: RuntimeServicesFixture | undefined;
  let ownerReady = false;
  let candidateAvailable = false;
  const needsCandidate = (context: TestContext): boolean => {
    if (candidateAvailable) return true;
    context.skip("requires the preceding explicit canonical 052 feature contract");
    return false;
  };
  before(async () => { initial = await createRuntimeServicesFixture(configuration!, { baselineRelease: 51 }); });
  after(async () => { await initial?.cleanup(); });

  it("051 owner positive control sees the real canonical schema, 51 checksums and committed synthetic UUID", async () => {
    await verifyOwnerPositiveControl(initial!);
    await ledgerIs(initial!, 51);
    const [owner] = await query("owner backend identity control", () => initial!.owner`select pg_backend_pid() as pid`);
    const [observer] = await query("independent backend positive control", () => initial!.observer`
      select pg_backend_pid() as pid,(select count(*)::int from public.runtime_services_fixture_control) as total`);
    assert.ok(owner?.pid !== observer?.pid && observer?.total === 1, "second owner connection sees committed control data");
    const catalogue = await privateCatalogue(initial!.observer);
    assert.ok(catalogue !== null && typeof catalogue === "object" && !Array.isArray(catalogue),
      "the full private catalogue snapshot runs on canonical 051 before any candidate assertion");
    assert.ok((await policies(initial!.observer)).length > 0, "the real baseline policy snapshot is populated");
    assert.ok((await existingFunctions(initial!.observer)).length > 0, "the real baseline function snapshot is populated");
    const grants = await oldConsumerGrants(initial!.observer);
    const identities = await oldRoleState(initial!.observer);
    assert.ok(Array.isArray(grants) && grants.length > 0, "the baseline old-consumer ACL/default query runs");
    assert.ok(Array.isArray(identities) && identities.length === 4, "the baseline private identity query sees the old four consumers");
    ownerReady = true;
  });

  it("052 feature contract requires a canonical candidate after the successful real 051 owner control", async context => {
    try {
      if (!ownerReady) { context.skip("requires the preceding successful real 051 owner control"); return; }
      assert.ok(initial!.candidate052, "052 feature contract: canonical migration 052 is missing; real 051 owner setup succeeded");
      assert.match(initial!.candidate052.id, /^052-[a-z0-9-]+$/);
      candidateAvailable = true;
    } finally { await initial!.cleanup(); initial = undefined; }
  });

  it("applies only 052, preserves old consumers/data and replays with an unchanged committed catalogue", async context => {
    if (!needsCandidate(context)) return;
    await baselineCase(async fixture => {
      const identities = await oldRoleState(fixture.observer);
      const grants = await oldConsumerGrants(fixture.observer);
      const functions = await existingFunctions(fixture.observer);
      const data = await query("synthetic data before candidate", () => fixture.observer`select id from public.runtime_services_fixture_control`);
      assert.deepEqual(await fixture.applyCandidate052(), [fixture.candidate052!.id]);
      await ledgerIs(fixture, 52);
      await serviceRolesAreRestricted(fixture);
      privateEqual(await oldRoleState(fixture.observer), identities, "old four flags and credentials are preserved");
      privateEqual(await oldConsumerGrants(fixture.observer), grants, "old consumer ACL and defaults are preserved");
      const afterFunctions = await existingFunctions(fixture.observer);
      privateEqual(afterFunctions.filter(row => functions.some(before => before.oid === row.oid)), functions,
        "all existing human/helper function bodies, owners and ACL remain unchanged");
      privateEqual(await query("synthetic data after candidate", () => fixture.observer`select id from public.runtime_services_fixture_control`), data,
        "preexisting synthetic data survives the release");
      const committed = await privateCatalogue(fixture.observer);
      assert.deepEqual(await fixture.applyCandidate052(), []);
      privateEqual(await privateCatalogue(fixture.observer), committed, "replay changes no committed SQL catalogue or data");
    });
  });

  it("rolls back a deliberate exception appended after canonical 052 and then passes the clean positive control", async context => {
    if (!needsCandidate(context)) return;
    await baselineCase(async fixture => {
      const before = await privateCatalogue(fixture.observer);
      await assert.rejects(fixture.applyCandidate052({ failAtEnd: true }), codeIs("PZ052"));
      privateEqual(await privateCatalogue(fixture.observer), before,
        "late failure leaves the entire independent catalogue, credentials and synthetic data unchanged");
      await ledgerIs(fixture, 51);
      const [helpers] = await query("no partial helper after rollback", () => fixture.observer`
        select to_regprocedure('public.service_runtime_guard(name)') is null as absent`);
      assert.ok(helpers?.absent, "no private helper can escape the failed migration transaction");
      assert.deepEqual(await fixture.applyCandidate052(), [fixture.candidate052!.id], "the same canonical candidate succeeds without the appended fault");
      await ledgerIs(fixture, 52);
      await serviceRolesAreRestricted(fixture);
    });
  });

  it("removes only the new roles' unsafe direct grants, column ACLs, defaults, flags and both membership directions", async context => {
    if (!needsCandidate(context)) return;
    await baselineCase(async fixture => {
      await fixture.ensureServiceRoles();
      await seedProbe(fixture);
      await query("preserve old consumer probe ACL/default positive controls", () => fixture.owner.unsafe(`
        GRANT SELECT ON public.runtime_migration_probe TO predioon_app;
        GRANT USAGE ON SEQUENCE public.runtime_migration_probe_seq TO predioon_identity;
        GRANT EXECUTE ON FUNCTION public.runtime_migration_probe_fn() TO predioon_broker_auth;
        ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO predioon_app;
        ALTER DEFAULT PRIVILEGES GRANT USAGE ON SEQUENCES TO predioon_identity;
        ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO predioon_broker_auth;
      `));
      const oldGrants = await oldConsumerGrants(fixture.observer);
      const oldIdentities = await oldRoleState(fixture.observer);
      await withMembershipContamination(fixture, async () => {
        await query("grant only new-service unsafe pre-052 contamination", () => fixture.owner.unsafe(`
          GRANT SELECT ON public.users,public.gateways,public.runtime_migration_probe TO predioon_ingest,predioon_access_service;
          GRANT SELECT(password_hash) ON public.users TO predioon_ingest,predioon_access_service;
          GRANT SELECT(metadata) ON public.gateways TO predioon_ingest,predioon_access_service;
          GRANT SELECT(metadata,password_hash) ON public.runtime_migration_probe TO predioon_ingest,predioon_access_service;
          GRANT ALL ON SEQUENCE public.runtime_migration_probe_seq TO predioon_ingest,predioon_access_service;
          GRANT EXECUTE ON FUNCTION public.runtime_migration_probe_fn(),public.app_mark_access_sent(uuid) TO predioon_ingest,predioon_access_service;
          GRANT CREATE,TEMP ON DATABASE "${fixture.databaseName}" TO predioon_ingest,predioon_access_service;
          GRANT CREATE ON SCHEMA public TO predioon_ingest,predioon_access_service;
          ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO predioon_ingest,predioon_access_service;
          ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO predioon_ingest,predioon_access_service;
          ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO predioon_ingest,predioon_access_service;
          ALTER ROLE predioon_ingest LOGIN SUPERUSER INHERIT BYPASSRLS CREATEDB CREATEROLE REPLICATION;
          ALTER ROLE predioon_access_service LOGIN SUPERUSER INHERIT BYPASSRLS CREATEDB CREATEROLE REPLICATION;
        `));
        for (const role of services) {
          const [dirty] = await query("unsafe own grant and membership positive control", () => fixture.observer`
            select r.rolsuper and r.rolcanlogin and r.rolinherit and r.rolbypassrls and r.rolcreatedb
                and r.rolcreaterole and r.rolreplication as flags,
              exists(select 1 from pg_auth_members where roleid=r.oid) as outgoing,
              exists(select 1 from pg_auth_members where member=r.oid) as incoming,
              exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
                where a.attrelid='public.users'::regclass and a.attname='password_hash' and x.grantee=r.oid) as column_grant,
              exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) x
                where x.grantee=r.oid) as default_grant
            from pg_roles r where r.rolname=${role}`);
          assert.ok(dirty && Object.values(dirty).every(value => value === true),
            "each known service really has unsafe flags, a column/default grant and both membership directions before 052");
        }
        assert.deepEqual(await fixture.applyCandidate052(), [fixture.candidate052!.id]);
        await serviceRolesAreRestricted(fixture);
        for (const role of services) {
          const [rights] = await query("effective private and DDL privilege removal", () => fixture.observer`
            select has_table_privilege(${role},'public.users','SELECT') as users,
              has_column_privilege(${role},'public.users','password_hash','SELECT') as password,
              has_column_privilege(${role},'public.gateways','metadata','SELECT') as metadata,
              has_table_privilege(${role},'public.runtime_migration_probe','SELECT') as probe,
              has_column_privilege(${role},'public.runtime_migration_probe','metadata','SELECT') as probe_column,
              has_sequence_privilege(${role},'public.runtime_migration_probe_seq','USAGE,SELECT,UPDATE') as sequence,
              has_function_privilege(${role},'public.app_mark_access_sent(uuid)','EXECUTE') as human_function,
              has_database_privilege(${role},current_database(),'CREATE,TEMP') as database_ddl,
              has_schema_privilege(${role},'public','CREATE') as schema_ddl,
              exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
                where a.attrelid in ('public.users'::regclass,'public.gateways'::regclass,'public.runtime_migration_probe'::regclass)
                  and x.grantee=(select oid from pg_roles where rolname=${role})
                  and a.attname in ('metadata','password_hash')) as unsafe_column_acl,
              exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
                where a.grantee=(select oid from pg_roles where rolname=${role})) as default_grant`);
          assert.ok(rights && Object.values(rights).every(value => value === false), "new service has no residual private, column, sequence, human, DDL or default privilege");
          const [directFunction] = await query("remove service's own function ACL despite old PUBLIC execute", () => fixture.observer`
            select not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
              where p.oid='public.runtime_migration_probe_fn()'::regprocedure
                and a.grantee=(select oid from pg_roles where rolname=${role})) as removed`);
          assert.ok(directFunction?.removed, "service's explicit function grant is removed while preexisting PUBLIC ACL is preserved");
        }
        privateEqual(await oldConsumerGrants(fixture.observer), oldGrants, "cleanup of new roles preserves all old consumers' grants and defaults");
        privateEqual(await oldRoleState(fixture.observer), oldIdentities, "cleanup of new roles preserves old flags and credentials");
      });
    });
  });

  const publicContamination = [
    ["database TEMP", (fixture: RuntimeServicesFixture) => `GRANT TEMP ON DATABASE "${fixture.databaseName}" TO PUBLIC`],
    ["database CREATE", (fixture: RuntimeServicesFixture) => `GRANT CREATE ON DATABASE "${fixture.databaseName}" TO PUBLIC`],
    ["schema CREATE", () => "GRANT CREATE ON SCHEMA public TO PUBLIC"],
    ["private table SELECT", () => "GRANT SELECT ON public.users TO PUBLIC"],
    ["private password column", () => "GRANT SELECT(password_hash) ON public.users TO PUBLIC"],
    ["private gateway metadata column", () => "GRANT SELECT(metadata) ON public.gateways TO PUBLIC"],
    ["sensitive human EXECUTE", () => "GRANT EXECUTE ON FUNCTION public.app_mark_access_sent(uuid) TO PUBLIC"],
    ["sensitive helper EXECUTE", () => "GRANT EXECUTE ON FUNCTION public.notification_enqueue_alert(uuid) TO PUBLIC"],
  ] as const;
  for (const [label, statement] of publicContamination) {
    it(`aborts atomically and preserves reintroduced PUBLIC ${label} in a fresh 051 database`, async context => {
      if (!needsCandidate(context)) return;
      await baselineCase(async fixture => {
        await query("controlled PUBLIC contamination", () => fixture.owner.unsafe(statement(fixture)));
        await assertAtomicGuard(fixture);
      });
    });
  }

  for (const role of services) {
    it(`aborts without transferring or dropping an existing object owned by ${role}`, async context => {
      if (!needsCandidate(context)) return;
      await baselineCase(async fixture => {
        await fixture.ensureServiceRoles();
        await query("create only fixture-local service-owned object", () => fixture.owner.unsafe(`
          CREATE TABLE public.runtime_migration_owned(id uuid);
          ALTER TABLE public.runtime_migration_owned OWNER TO ${role};
        `));
        const [before] = await query("owned object positive control", () => fixture.observer`
          select c.oid::int,c.relowner::int,pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid='public.runtime_migration_owned'::regclass`);
        assert.ok(before?.oid && before.owner === role, "fixture object is actually owned by the known service before the guard");
        await assertAtomicGuard(fixture);
        const [after] = await query("owned object persistence", () => fixture.observer`
          select c.oid::int,c.relowner::int,pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid='public.runtime_migration_owned'::regclass`);
        privateEqual(after, before, "guard preserves the same object OID and owner");
      });
    });
  }

  it("changes the owner's global future-function default while preserving old function ACLs and other defaults", async context => {
    if (!needsCandidate(context)) return;
    await baselineCase(async fixture => {
      await seedProbe(fixture);
      const schema = `ingest_runtime_schema_${randomUUID().replaceAll("-", "")}`;
      await query("create independent UUID schema and old consumer defaults", () => fixture.owner.unsafe(`
        CREATE SCHEMA "${schema}";
        ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO predioon_app;
        ALTER DEFAULT PRIVILEGES GRANT USAGE ON SEQUENCES TO predioon_identity;
        ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO predioon_notifications;
      `));
      const functions = await existingFunctions(fixture.observer);
      const grants = await oldConsumerGrants(fixture.observer);
      const [old] = await query("old implicit PUBLIC function execute positive control", () => fixture.observer`
        select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where p.oid='public.runtime_migration_probe_fn()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as public_execute`);
      assert.ok(old?.public_execute, "function created before 052 has the existing PUBLIC EXECUTE default");
      assert.deepEqual(await fixture.applyCandidate052(), [fixture.candidate052!.id]);
      await query("create actual future owner objects in two schemas", () => fixture.owner.unsafe(`
        CREATE FUNCTION public.runtime_migration_future_fn() RETURNS integer LANGUAGE sql AS 'SELECT 2';
        CREATE FUNCTION "${schema}".runtime_migration_future_fn() RETURNS integer LANGUAGE sql AS 'SELECT 3';
        CREATE TABLE public.runtime_migration_future_table(id integer);
        CREATE SEQUENCE public.runtime_migration_future_seq;
      `));
      const [defaults] = await query("global function default catalogue contract", () => fixture.observer`
        select exists(select 1 from pg_default_acl d where d.defaclrole=(select oid from pg_roles where rolname=current_user)
          and d.defaclnamespace=0 and d.defaclobjtype='f' and not exists(select 1 from aclexplode(d.defaclacl) a
            where a.grantee=0 and a.privilege_type='EXECUTE')) as global_no_public`);
      assert.ok(defaults?.global_no_public, "052 removes the owner's global PUBLIC function default without IN SCHEMA");
      for (const signature of ["public.runtime_migration_future_fn()", `"${schema}".runtime_migration_future_fn()`]) {
        const [future] = await query("actual future function PUBLIC ACL", () => fixture.observer`
          select not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            where p.oid=to_regprocedure(${signature}) and a.grantee=0 and a.privilege_type='EXECUTE') as no_public,
            to_regprocedure(${signature}) is not null as present`);
        assert.ok(future?.present && future.no_public, "actual future functions in both schemas have no PUBLIC EXECUTE");
        for (const role of services) {
          const [right] = await query("future function service isolation", () => fixture.observer`
            select has_function_privilege(${role},to_regprocedure(${signature}),'EXECUTE') as allowed`);
          assert.equal(right?.allowed, false);
        }
      }
      for (const role of services) {
        const [rights] = await query("future table and sequence service isolation", () => fixture.observer`
          select has_table_privilege(${role},'public.runtime_migration_future_table','SELECT,INSERT,UPDATE,DELETE') as table_access,
            has_sequence_privilege(${role},'public.runtime_migration_future_seq','USAGE,SELECT,UPDATE') as sequence_access`);
        assert.ok(rights && !rights.table_access && !rights.sequence_access, "new services receive no implicit privileges on future objects");
      }
      const afterFunctions = await existingFunctions(fixture.observer);
      privateEqual(afterFunctions.filter(row => functions.some(before => before.oid === row.oid)), functions, "old functions retain their exact ACL and body including PUBLIC EXECUTE");
      // Future objects inherit deliberate old consumer defaults; compare only ACL
      // entries on objects/default rows that existed in the pre-migration snapshot.
      const afterGrants = await oldConsumerGrants(fixture.observer) as Array<{ kind: string; object: number }>;
      const oldGrants = grants as Array<{ kind: string; object: number }>;
      privateEqual(afterGrants.filter(row => oldGrants.some(old => old.kind === row.kind && old.object === row.object)), oldGrants,
        "all old consumer and non-function defaults remain unchanged");
    });
  });

  it("retargets only operational legacy PUBLIC policies and preserves explicit consumers and human helper bodies", async context => {
    if (!needsCandidate(context)) return;
    await baselineCase(async fixture => {
      const before = await policies(fixture.observer);
      const functions = await existingFunctions(fixture.observer);
      assert.ok(before.some(policy => operationalTables.has(policy.table) && isDeepStrictEqual(policy.roles, ["public"])),
        "051 contains an actual legacy operational PUBLIC policy");
      assert.ok(functions.length > 0);
      const [human] = await query("existing human helpers positive control", () => fixture.observer`
        select to_regprocedure('public.app_mark_access_sent(uuid)') is not null
          and to_regprocedure('public.app_parking_target_guard()') is not null as present`);
      assert.ok(human?.present, "both sensitive existing human helper bodies are included in the full snapshot");
      assert.deepEqual(await fixture.applyCandidate052(), [fixture.candidate052!.id]);
      const after = await policies(fixture.observer);
      for (const policy of before) {
        const expected = operationalTables.has(policy.table) && isDeepStrictEqual(policy.roles, ["public"])
          ? { ...policy, roles: ["predioon_app"] } : policy;
        privateEqual(after.find(candidate => candidate.schema === policy.schema && candidate.table === policy.table && candidate.name === policy.name), expected,
          "existing policy keeps its OID/name, command, permissiveness, qual and check; only eligible PUBLIC role lists change");
      }
      const added = after.filter(policy => !before.some(original => original.oid === policy.oid));
      assert.ok(added.length > 0 && services.every(role => added.some(policy => policy.roles.includes(role))), "052 adds fixed PostgreSQL service policies");
      assert.ok(added.every(policy => policy.roles.length > 0 && policy.roles.every(role => services.includes(role as typeof services[number])) &&
        !/current_setting|app\.(?:role|user_id)/i.test(`${policy.qual ?? ""} ${policy.check ?? ""}`)),
      "new machine policy authority comes from fixed PostgreSQL roles, without mutable human GUCs");
      const afterFunctions = await existingFunctions(fixture.observer);
      privateEqual(afterFunctions.filter(row => functions.some(original => original.oid === row.oid)), functions,
        "all existing helper bodies, owners, ACL and search paths remain unchanged");
      // Task4a already checks the two complete helper families and their six-role
      // EXECUTE isolation; reuse the actual catalogue assertion as a positive control.
      for (const role of services) await assertServiceCatalogue(fixture, role);
    });
  });
});
