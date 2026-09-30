import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer } from "./helpers.js";

type Resource = { type: string; a: string; b: string };

describe("building discovery validates existing tenant resources", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  // A forged legacy role must not influence the new discovery/capability helpers.
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);

  async function create() {
    const suffix = randomUUID(), orgA = `discovery-org-a-${suffix}`, orgB = `discovery-org-b-${suffix}`;
    const a = `discovery-a-${suffix}`, b = `discovery-b-${suffix}`;
    const person = `discovery-person-${suffix}`, worker = `discovery-worker-${suffix}`, support = `discovery-support-${suffix}`;
    const whole = `discovery-whole-${suffix}`, legacy = `discovery-legacy-${suffix}`, global = `discovery-global-${suffix}`;
    const outsider = `discovery-outsider-${suffix}`, holder = `discovery-holder-${suffix}`;
    const ids = [person, worker, support, whole, legacy, global, outsider, holder];
    const deviceA = `discovery-device-a-${suffix}`, deviceB = `discovery-device-b-${suffix}`;
    const gatewayA = `discovery-gateway-a-${suffix}`, gatewayB = `discovery-gateway-b-${suffix}`;
    const teamA = randomUUID(), teamB = randomUUID(), personalBinding = randomUUID(), teamBinding = randomUUID();
    const supportBinding = randomUUID(), globalBinding = randomUUID(), grant = randomUUID();
    const resources: Resource[] = [
      { type: "building", a, b }, { type: "device", a: deviceA, b: deviceB }, { type: "gateway", a: gatewayA, b: gatewayB },
      { type: "team", a: teamA, b: teamB },
      ...["block", "unit", "membership", "alert", "finance", "notice", "occurrence", "support_grant"].map(type => ({ type, a: randomUUID(), b: randomUUID() })),
    ];
    const unitMembershipA = randomUUID(), unitMembershipB = randomUUID();
    const resource = (type: string) => resources.find(r => r.type === type)!;
    const tokens = new Map<string, string>();
    const request = (user: string, path: string, method = "GET", body?: unknown) => call(server.url, path, { token: tokens.get(user), method, body });
    const f = { orgA, orgB, a, b, ids, person, worker, support, whole, legacy, global, outsider, holder, deviceA, deviceB, gatewayA, gatewayB,
      teamA, teamB, personalBinding, teamBinding, supportBinding, globalBinding, grant, resources, resource, unitMembershipA, unitMembershipB, request };
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${orgA},'Discovery A',${orgA}),(${orgB},'Discovery B',${orgB})`;
      await sqlClient`insert into buildings(id,organization_id,name,code) values(${a},${orgA},'A','A'),(${b},${orgB},'B','B')`;
      for (const id of ids) await sqlClient`insert into users(id,email,name,password_hash) values(${id},${id + '@discovery.test'},${id},${passwordHash})`;
      await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gatewayA},${a},'A',${gatewayA}),(${gatewayB},${b},'B',${gatewayB})`;
      await sqlClient`insert into devices(id,building_id,gateway_id,name,type) values(${deviceA},${a},${gatewayA},'A','WATER_LEVEL_SENSOR'),(${deviceB},${b},${gatewayB},'B','WATER_LEVEL_SENSOR')`;
      for (const side of ["a", "b"] as const) {
        const building = f[side];
        await sqlClient`insert into blocks(id,building_id,code,name) values(${resource('block')[side]},${building},'1','Block')`;
        await sqlClient`insert into units(id,building_id,block_id,code) values(${resource('unit')[side]},${building},${resource('block')[side]},'1')`;
        await sqlClient`insert into teams(id,building_id,name) values(${resource('team')[side]},${building},'Discovery team')`;
        // Membership resources belong to an unrelated account, so no whole-tenant grant masks these tests.
        await sqlClient`insert into memberships(id,user_id,building_id,role) values(${resource('membership')[side]},${holder},${building},'RESIDENT')`;
        await sqlClient`insert into unit_memberships(id,building_id,unit_id,user_id) values(${side === 'a' ? unitMembershipA : unitMembershipB},${building},${resource('unit')[side]},${holder})`;
        await sqlClient`insert into alerts(id,building_id,device_id,severity,type,message) values(${resource('alert')[side]},${building},${resource('device')[side]},'HIGH','GENERAL','Discovery')`;
        await sqlClient`insert into financial_reports(id,building_id,month,title,summary,opening_balance_cents) values(${resource('finance')[side]},${building},'2026-09','Report','Summary',0)`;
        await sqlClient`insert into notices(id,building_id,title,body) values(${resource('notice')[side]},${building},'Notice','Body')`;
        await sqlClient`insert into occurrences(id,building_id,protocol,category,title,description) values(${resource('occurrence')[side]},${building},${randomUUID()},'General','Occurrence','Description')`;
        await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${resource('support_grant')[side]},${building},${holder},'devices:read','device',${resource('device')[side]},'Resource fixture',now()+interval '1 hour',${whole})`;
        await sqlClient`insert into building_feature_settings(building_id,feature_key,enabled) values(${building},'GAS',true)`;
        await sqlClient`insert into feature_runtime(building_id,feature_key,resumed_at) values(${building},'GAS',now())`;
      }
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${teamA},${a},${worker})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${personalBinding},${person},${a},'MAINTENANCE','device',${deviceA})`;
      await sqlClient`insert into role_bindings(id,team_id,building_id,role_key,resource_type,resource_id) values(${teamBinding},${teamA},${a},'MAINTENANCE','gateway',${gatewayA})`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${whole},${a},'BUILDING_ADMIN')`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${legacy},${a},'RESIDENT')`;
      await sqlClient`insert into role_bindings(id,user_id,role_key) values(${supportBinding},${support},'PLATFORM_SUPPORT'),(${globalBinding},${global},'PLATFORM_ADMIN')`;
      await sqlClient`insert into support_grants(id,building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values(${grant},${a},${support},'devices:read','device',${deviceA},'Diagnosis',now()+interval '1 hour',${whole})`;
      for (const id of ids) tokens.set(id, (await login(server.url, id + '@discovery.test')).accessToken);
      return f;
    } catch (error) { await cleanup(f); throw error; }
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function cleanup(f: Pick<Fixture, "ids" | "orgA" | "orgB">) {
    await sqlClient`delete from audit_logs where user_id in ${sqlClient(f.ids)}`;
    await sqlClient`delete from buildings where organization_id in ${sqlClient([f.orgA, f.orgB])}`;
    await sqlClient`delete from organizations where id in ${sqlClient([f.orgA, f.orgB])}`;
    await sqlClient`delete from users where id in ${sqlClient(f.ids)}`;
  }
  async function fixture(run: (f: Fixture) => Promise<void>) { const f = await create(); try { await run(f); } finally { await cleanup(f); } }
  async function list(f: Fixture, user: string) {
    const response = await f.request(user, "/buildings"); assert.equal(response.status, 200);
    return (await response.json()).items.map((row: any) => row.id).sort() as string[];
  }
  async function raw(user: string) {
    return as(user, async tx => {
      const [role] = await tx.execute(sql`select current_user as role`); assert.equal(role.role, "predioon_app");
      return { buildings: [...await tx.execute(sql`select id from buildings`)].map(r => r.id).sort(),
        settings: [...await tx.execute(sql`select building_id from building_feature_settings`)].map(r => r.building_id).sort(),
        runtime: [...await tx.execute(sql`select building_id from feature_runtime`)].map(r => r.building_id).sort() };
    });
  }
  async function discovery(f: Fixture, user: string, allowed: string[] = [], featureStateAllowed = allowed) {
    const observed = [], expected = [];
    for (const building of [f.a, f.b]) {
      const status = allowed.includes(building) ? 200 : 403;
      const [scope] = await as(user, tx => tx.execute(sql`select app_can_discover_building(${building}) as allowed`));
      observed.push({ building, basic: (await f.request(user, `/buildings/${building}`)).status,
        features: (await f.request(user, `/features/buildings/${building}`)).status, scope: scope.allowed });
      expected.push({ building, basic: status, features: status, scope: allowed.includes(building) });
    }
    // Collect every surface before asserting so RED reports the actual HTTP and RLS leaks together.
    const visible = [...allowed].sort();
    assert.deepEqual({ http: observed, list: await list(f, user), rls: await raw(user) },
      { http: expected, list: visible, rls: { buildings: visible, settings: [...featureStateAllowed].sort(), runtime: [...featureStateAllowed].sort() } });
  }
  async function personalScope(f: Fixture, type: string, id: string, building = f.a) {
    await sqlClient`update role_bindings set building_id=${building},resource_type=${type},resource_id=${id} where id=${f.personalBinding}`;
  }

  for (const subject of ["person", "team", "support"] as const) {
    for (const invalid of ["foreign", "missing"] as const) {
      it(`rejects ${subject} discovery with a declared A scope referencing a ${invalid} resource`, async () => fixture(async f => {
        const type = subject === "team" ? "gateway" : "device";
        const id = invalid === "foreign" ? f.resource(type).b : `missing-${randomUUID()}`;
        if (subject === "person") await personalScope(f, type, id);
        if (subject === "team") await sqlClient`update role_bindings set resource_id=${id} where id=${f.teamBinding}`;
        if (subject === "support") await sqlClient`update support_grants set resource_id=${id} where id=${f.grant}`;
        const user = subject === "person" ? f.person : subject === "team" ? f.worker : f.support;
        const [declared] = await as(user, tx => tx.execute(sql`select app_has_capability(${f.a},${subject === 'support' ? 'devices:read' : 'buildings:read'},${type},${id}) as allowed`));
        assert.equal(declared.allowed, true, "the declared grant is live; belonging alone must deny discovery");
        await discovery(f, user);
        // Correct the resource without issuing another JWT.
        if (subject === "person") await personalScope(f, type, f.resource(type).a);
        if (subject === "team") await sqlClient`update role_bindings set resource_id=${f.gatewayA} where id=${f.teamBinding}`;
        if (subject === "support") await sqlClient`update support_grants set resource_id=${f.deviceA} where id=${f.grant}`;
        await discovery(f, user, [f.a]);
      }));
    }
  }

  it("maps every existing resource by primary key and tenant, including both membership tables", async () => fixture(async f => {
    const maps = [...f.resources, { type: "membership", a: f.unitMembershipA, b: f.unitMembershipB }];
    for (const resource of maps) {
      for (const [building, id, expected] of [[f.a, resource.a, true], [f.a, resource.b, false], [f.b, resource.a, false], [f.a, randomUUID(), false]] as const) {
        const [row] = await sqlClient`select app_discovery_resource_belongs(${building},${resource.type},${id}) as allowed`;
        assert.equal(row.allowed, expected, `${resource.type} ${building} ${id}`);
      }
      if (!["building", "device", "gateway"].includes(resource.type)) {
        for (const invalid of ["not-a-uuid", "00000000-0000-0000-0000-00000000000z", " ", ""]) {
          const [row] = await sqlClient`select app_discovery_resource_belongs(${f.a},${resource.type},${invalid}) as allowed`;
          assert.equal(row.allowed, false, `${resource.type} malformed input must not raise 22P02`);
        }
      }
    }
    for (const [type, id, expected] of [[null, null, true], [null, f.deviceA, false], ["device", null, false], ["", "", false], ["device", " ", false],
      ["unknown", f.deviceA, false], ["work_order", randomUUID(), false], ["automation", randomUUID(), false], ["telemetry", randomUUID(), false]] as const) {
      const [row] = await sqlClient`select app_discovery_resource_belongs(${f.a},${type},${id}) as allowed`;
      assert.equal(row.allowed, expected, `${type}/${id}`);
    }
  }));

  it("proves HTTP and unfiltered restricted RLS for every mapped resource", async () => fixture(async f => {
    for (const resource of [...f.resources, { type: "membership", a: f.unitMembershipA, b: f.unitMembershipB }]) {
      await personalScope(f, resource.type, resource.a); await discovery(f, f.person, [f.a]);
      await personalScope(f, resource.type, resource.b); await discovery(f, f.person);
      await personalScope(f, resource.type, randomUUID()); await discovery(f, f.person);
      if (!["building", "device", "gateway"].includes(resource.type)) {
        await personalScope(f, resource.type, "invalid-uuid"); await discovery(f, f.person);
      }
    }
  }));

  it("denies unmapped future resources without scanning telemetry history", async () => fixture(async f => {
    const telemetryId = randomUUID();
    await sqlClient`insert into telemetry(id,time,event_id,building_id,device_id,metric,value) values(${telemetryId},now(),${randomUUID()},${f.a},${f.deviceA},'water_level_percent','50')`;
    for (const type of ["work_order", "automation", "telemetry"]) {
      await personalScope(f, type, type === "telemetry" ? telemetryId : randomUUID()); await discovery(f, f.person);
    }
  }));

  it("combines two invalid scopes and one valid scope without promoting either tenant", async () => fixture(async f => {
    await personalScope(f, "device", f.deviceB);
    await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values
      (${f.person},${f.a},'MAINTENANCE','gateway',${'missing-'+randomUUID()}),(${f.person},${f.b},'MAINTENANCE','device',${f.deviceB})`;
    await discovery(f, f.person, [f.b]);
    await sqlClient`delete from role_bindings where user_id=${f.person} and building_id=${f.b}`;
    await discovery(f, f.person);
  }));

  it("preserves whole-tenant bindings, legacy memberships and null/null support grants", async () => fixture(async f => {
    for (const user of [f.whole, f.legacy]) await discovery(f, user, [f.a]);
    await sqlClient`update support_grants set resource_type=null,resource_id=null where id=${f.grant}`;
    await discovery(f, f.support, [f.a]);
    await sqlClient`update support_grants set revoked_at=now() where id=${f.grant}`; await discovery(f, f.support);
  }));

  it("keeps disabled devices discoverable and removes deleted resources on the same JWT", async () => fixture(async f => {
    await sqlClient`update devices set enabled=false where id=${f.deviceA}`;
    await discovery(f, f.person, [f.a]); await discovery(f, f.support, [f.a]);
    await sqlClient`delete from devices where id=${f.deviceA}`;
    await discovery(f, f.person); await discovery(f, f.support);
    await discovery(f, f.worker, [f.a]);
    await sqlClient`delete from gateways where id=${f.gatewayA}`; await discovery(f, f.worker);
  }));

  it("rechecks person binding revocation, expiry, future start, role and permission on the same JWT", async () => fixture(async f => {
    for (const change of ["revoked", "expired", "future"]) {
      await discovery(f, f.person, [f.a]);
      if (change === "revoked") await sqlClient`update role_bindings set active=false where id=${f.personalBinding}`;
      if (change === "expired") await sqlClient`update role_bindings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=${f.personalBinding}`;
      if (change === "future") await sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.personalBinding}`;
      await discovery(f, f.person);
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.personalBinding}`;
    }
    const [role] = await sqlClient`select active from roles where key='MAINTENANCE'`;
    const [permission] = await sqlClient`select active from permissions where key='buildings:read'`;
    try {
      await sqlClient`update roles set active=false where key='MAINTENANCE'`; await discovery(f, f.person);
      await sqlClient`update roles set active=${role.active} where key='MAINTENANCE'`;
      await sqlClient`update permissions set active=false where key='buildings:read'`;
      // 017/018 intentionally read effective feature state through independent
      // operational capabilities, even when basic building discovery is denied.
      await discovery(f, f.person, [], [f.a]);
      const [independent] = await as(f.person, tx => tx.execute(sql`select app_telemetry_can_read_feature_state(${f.a}) as telemetry,app_alert_can_read_feature_state(${f.a}) as alerts`));
      assert.deepEqual({ ...independent }, { telemetry: true, alerts: true });
      assert.equal((await f.request(f.person, `/telemetry/latest?buildingId=${f.a}`)).status, 200);
      assert.equal((await f.request(f.person, `/alerts?buildingId=${f.a}`)).status, 200);
    } finally {
      await sqlClient`update roles set active=${role.active} where key='MAINTENANCE'`;
      await sqlClient`update permissions set active=${permission.active} where key='buildings:read'`;
    }
    await discovery(f, f.person, [f.a]);
  }));

  it("rechecks team and member activity and windows on the same JWT", async () => fixture(async f => {
    for (const change of ["binding", "team", "member", "memberExpired", "memberFuture"]) {
      await discovery(f, f.worker, [f.a]);
      if (change === "binding") await sqlClient`update role_bindings set active=false where id=${f.teamBinding}`;
      if (change === "team") await sqlClient`update teams set active=false where id=${f.teamA}`;
      if (change === "member") await sqlClient`update team_members set active=false where team_id=${f.teamA}`;
      if (change === "memberExpired") await sqlClient`update team_members set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where team_id=${f.teamA}`;
      if (change === "memberFuture") await sqlClient`update team_members set starts_at=now()+interval '1 hour' where team_id=${f.teamA}`;
      await discovery(f, f.worker);
      await sqlClient`update role_bindings set active=true where id=${f.teamBinding}`;
      await sqlClient`update teams set active=true where id=${f.teamA}`;
      await sqlClient`update team_members set active=true,starts_at=null,ends_at=null where team_id=${f.teamA}`;
    }
  }));

  it("rechecks support grants and its global role on the same JWT", async () => fixture(async f => {
    for (const change of ["revoked", "expired", "future", "role"]) {
      await discovery(f, f.support, [f.a]);
      if (change === "revoked") await sqlClient`update support_grants set revoked_at=now() where id=${f.grant}`;
      if (change === "expired") await sqlClient`update support_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${f.grant}`;
      if (change === "future") await sqlClient`update support_grants set created_at=now()+interval '1 hour',expires_at=now()+interval '2 hours' where id=${f.grant}`;
      if (change === "role") await sqlClient`update role_bindings set active=false where id=${f.supportBinding}`;
      await discovery(f, f.support);
      await sqlClient`update support_grants set revoked_at=null,created_at=now(),expires_at=now()+interval '1 hour' where id=${f.grant}`;
      await sqlClient`update role_bindings set active=true where id=${f.supportBinding}`;
    }
  }));

  it("denies inactive local tenants and accounts while preserving the global inactive directory", async () => fixture(async f => {
    for (const change of ["organization", "building"]) {
      if (change === "organization") await sqlClient`update organizations set active=false where id=${f.orgA}`;
      if (change === "building") await sqlClient`update buildings set active=false where id=${f.a}`;
      for (const user of [f.person, f.worker, f.support, f.whole, f.legacy]) await discovery(f, user);
      const directory = await list(f, f.global); assert.ok(directory.includes(f.a)); assert.ok(directory.includes(f.b));
      assert.equal((await f.request(f.global, `/buildings/${f.a}`)).status, 200);
      await sqlClient`update organizations set active=true where id=${f.orgA}`;
      await sqlClient`update buildings set active=true where id=${f.a}`;
    }
    await sqlClient`update users set active=false where id=${f.person}`;
    for (const path of ["/buildings", `/buildings/${f.a}`, `/features/buildings/${f.a}`]) assert.equal((await f.request(f.person, path)).status, 401);
    const rows = await raw(f.person); assert.deepEqual(rows.buildings, []); assert.deepEqual(rows.settings, []); assert.deepEqual(rows.runtime, []);
    await sqlClient`update role_bindings set active=false where id=${f.globalBinding}`; await discovery(f, f.global);
    await discovery(f, f.outsider);
  }));

  it("grants basic building resource discovery without whole operations or basic/feature writes", async () => fixture(async f => {
    await personalScope(f, "building", f.a); await discovery(f, f.person, [f.a]);
    for (const type of ["building", "device"]) {
      await personalScope(f, type, f.resource(type).a);
      const [caps] = await as(f.person, tx => tx.execute(sql`select app_has_capability(${f.a},'devices:read') as devices,
        app_has_capability(${f.a},'telemetry:read') as telemetry,app_has_capability(${f.a},'alerts:read') as alerts,
        app_has_capability(${f.a},'buildings:read') as buildings`));
      assert.deepEqual({ ...caps }, { devices: false, telemetry: false, alerts: false, buildings: false });
      assert.equal((await f.request(f.person, `/buildings/${f.a}`, "PATCH", { name: "Forbidden" })).status, 403);
      assert.equal((await f.request(f.person, `/features/buildings/${f.a}/GAS`, "PUT", { enabled: false, version: 1, reason: "Forbidden scope" })).status, 403);
      const inventory = await f.request(f.person, `/devices?buildingId=${f.a}`);
      assert.equal(inventory.status, type === "building" ? 403 : 200);
      if (type === "device") assert.deepEqual((await inventory.json()).items.map((row: {id:string})=>row.id),[f.deviceA]);
      assert.deepEqual([...await as(f.person, tx => tx.execute(sql`update buildings set name='Forbidden' where id=${f.a} returning id`))], []);
      await assert.rejects(as(f.person, tx => tx.execute(sql`insert into building_feature_settings(building_id,feature_key,enabled) values(${f.a},'SMOKE',false)`)));
    }
    await personalScope(f, "building", f.a);
    assert.equal((await f.request(f.person, `/telemetry/latest?buildingId=${f.a}`)).status, 403);
    assert.equal((await f.request(f.person, `/alerts?buildingId=${f.a}`)).status, 403);
    assert.deepEqual([...await as(f.person, tx => tx.execute(sql`select id from telemetry`))], []);
    assert.deepEqual([...await as(f.person, tx => tx.execute(sql`select id from alerts`))], []);
  }));

  it("keeps the belonging helper owner-only and denies direct calls from all runtime roles", async () => fixture(async f => {
    const [row] = await sqlClient`select p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) as owner,
      pg_get_userbyid(c.proowner) as capability_owner,
      has_function_privilege('predioon_app',p.oid,'EXECUTE') as app_execute,
      has_function_privilege('predioon_identity',p.oid,'EXECUTE') as identity_execute,
      has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') as broker_execute,
      exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,
      exists(select 1 from aclexplode(p.proacl) acl where acl.grantee<>p.proowner and acl.privilege_type='EXECUTE') as nonowner_execute
      from pg_proc p cross join pg_proc c where p.oid='app_discovery_resource_belongs(text,text,text)'::regprocedure
        and c.oid='app_has_capability(text,text,text,text)'::regprocedure`;
    assert.equal(row.prosecdef, true); assert.equal(row.provolatile, "s"); assert.equal(row.owner, row.capability_owner);
    assert.ok(row.proconfig.includes("search_path=public, pg_temp"));
    for (const field of ["app_execute", "identity_execute", "broker_execute", "public_execute", "nonowner_execute"]) assert.equal(row[field], false, field);
    const denied = (error: unknown) => pgErrorCode(error) === "42501";
    await assert.rejects(appSqlClient`select app_discovery_resource_belongs(${f.a},'device',${f.deviceA})`, denied);
    await assert.rejects(identitySqlClient`select app_discovery_resource_belongs(${f.a},'device',${f.deviceA})`, denied);
    await assert.rejects(brokerAuthSqlClient`select app_discovery_resource_belongs(${f.a},'device',${f.deviceA})`, denied);
    assert.equal((await identitySqlClient`select id from buildings where id=${f.a}`).length, 1);
    assert.equal((await brokerAuthSqlClient`select id from buildings where id=${f.b}`).length, 1);
    await discovery(f, f.person, [f.a]);
  }));
});
