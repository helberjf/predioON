import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";
import {
  createRuntimeServicesFixture, parseRuntimeServicesEnvironment, runtimeServicesSkipReason,
  safeDatabaseOperation, verifyOwnerPositiveControl, type RuntimeServicesFixture,
} from "./fixtures/runtime-services.js";

const configuration = parseRuntimeServicesEnvironment(process.env);

// Catalogue metadata only. Never query Timescale job configuration or app data.
// Inventory actual extension members and objects in its private schemas; PUBLIC
// schema itself is shared, so unrelated public app relations are not swept in.
async function inventory(fixture: RuntimeServicesFixture) {
  const [row] = await safeDatabaseOperation("private Timescale ACL inventory", () => fixture.observer`
    with extension as (select oid,extversion from pg_extension where extname='timescaledb'),
    members as (select d.classid,d.objid from pg_depend d join extension e on e.oid=d.refobjid
      where d.refclassid='pg_extension'::regclass and d.deptype='e'),
    schemas as (select n.* from pg_namespace n where n.oid in
      (select objid from members where classid='pg_namespace'::regclass)),
    relations as (select c.* from pg_class c where c.oid in
      (select objid from members where classid='pg_class'::regclass)
      or c.relnamespace in (select oid from schemas where nspname<>'public')),
    functions as (select p.* from pg_proc p where p.oid in
      (select objid from members where classid='pg_proc'::regclass)
      or p.pronamespace in (select oid from schemas where nspname<>'public')),
    acls as (
      select 'schema'::text as kind,n.oid as object,0 as column_number,a.* from schemas n
      cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      union all select 'relation',c.oid,0,a.* from relations c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
      union all select 'column',c.oid,t.attnum,a.* from relations c join pg_attribute t on t.attrelid=c.oid
      cross join lateral aclexplode(t.attacl) a where t.attnum>0 and not t.attisdropped
      union all select 'function',p.oid,0,a.* from functions p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
    select jsonb_build_object(
      'version',(select extversion from extension),
      'schemas',coalesce((select jsonb_agg(jsonb_build_object('oid',oid,'name',nspname,'owner',nspowner,'acl',nspacl) order by oid) from schemas),'[]'::jsonb),
      'relations',coalesce((select jsonb_agg(jsonb_build_object('oid',oid,'schema',relnamespace,'name',relname,'owner',relowner,'acl',relacl) order by oid) from relations),'[]'::jsonb),
      'columns',coalesce((select jsonb_agg(jsonb_build_object('relation',t.attrelid,'column',t.attnum,'acl',t.attacl) order by t.attrelid,t.attnum)
        from pg_attribute t join relations c on c.oid=t.attrelid where t.attnum>0 and not t.attisdropped),'[]'::jsonb),
      'functions',coalesce((select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl) order by oid) from functions),'[]'::jsonb),
      'public',coalesce((select jsonb_agg(to_jsonb(a) order by kind,object,column_number,grantor,privilege_type,is_grantable) from acls a where grantee=0),'[]'::jsonb)
    ) as snapshot,
    exists(select 1 from acls a join pg_roles r on r.oid=a.grantee
      where r.rolname in ('predioon_ingest','predioon_access_service')) as own_service_grant`);
  assert.ok(row?.snapshot && typeof row.snapshot === "object", "extension catalogue inventory returned metadata");
  return { snapshot: row.snapshot as { version: string; schemas: unknown[]; relations: unknown[]; functions: unknown[]; public: unknown[] }, ownServiceGrant: row.own_service_grant };
}

describe("052 preserves actual Timescale extension ACLs", {
  concurrency: false, skip: configuration ? false : runtimeServicesSkipReason,
}, () => {
  let fixture: RuntimeServicesFixture | undefined;
  let baseline: Awaited<ReturnType<typeof inventory>> | undefined;
  before(async () => { fixture = await createRuntimeServicesFixture(configuration!, { baselineRelease: 51 }); });
  after(async () => { await fixture?.cleanup(); });

  it("owner and independent observer inventory real extension ACLs on 051 before checking candidate presence", async () => {
    await verifyOwnerPositiveControl(fixture!);
    const [owner] = await safeDatabaseOperation("extension owner connection control", () => fixture!.owner`select pg_backend_pid() as pid`);
    const [observer] = await safeDatabaseOperation("extension independent observer control", () => fixture!.observer`select pg_backend_pid() as pid`);
    assert.ok(owner?.pid && observer?.pid && owner.pid !== observer.pid, "owner and observer use independent backends");
    baseline = await inventory(fixture!);
    assert.ok(typeof baseline.snapshot.version === "string" && baseline.snapshot.schemas.length > 0 &&
      baseline.snapshot.relations.length > 0 && baseline.snapshot.functions.length > 0 && baseline.snapshot.public.length > 0,
    "actual Timescale version, object ownership, ACLs and PUBLIC inventory are populated; no universal count assumption");
    assert.equal(baseline.ownServiceGrant, false, "canonical 051 extension objects have no direct service-role grant");
  });

  it("052 preserves extension owners and PUBLIC ACL inventory without adding an own grant for either service", async context => {
    if (!baseline) { context.skip("requires successful real 051 extension owner control"); return; }
    assert.ok(fixture!.candidate052, "052 candidate is required after the successful 051 extension control");
    assert.deepEqual(await fixture!.applyCandidate052(), [fixture!.candidate052!.id]);
    const current = await inventory(fixture!);
    assert.ok(isDeepStrictEqual(current.snapshot, baseline.snapshot), "all observed extension owners/ACLs and PUBLIC privileges remain identical");
    assert.equal(current.ownServiceGrant, false, "neither service receives a direct extension object grant");
    assert.deepEqual(await fixture!.applyCandidate052(), [], "runner replay remains a ledger no-op");
    assert.ok(isDeepStrictEqual((await inventory(fixture!)).snapshot, current.snapshot), "replay preserves the actual extension inventory");
  });
});
