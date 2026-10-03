import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("audit capabilities isolate local history from platform history", () => {
  let server: TestServer, passwordHash: string;
  before(async () => {
    passwordHash = await hashPassword("predioon123");
    server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    await closeAppDb(); await sqlClient.end();
  });

  type Kind = "reader" | "exact" | "worker" | "legacy" | "platform" | "support" | "outsider";
  async function fixture(run: (f: {
    a: string; b: string; org: string; device: string; foreignDevice: string;
    team: string; binding: string; role: string; ids: Record<Kind, string>;
    logs: Record<"local" | "other" | "foreign" | "global" | "provisioned" | "feature" | "unknown", string>;
    request: (user: string, path?: string, options?: { method?: string; body?: unknown }) => Promise<Response>;
  }) => Promise<void>) {
    const suffix = randomUUID(), org = `audit-org-${suffix}`, a = `audit-a-${suffix}`, b = `audit-b-${suffix}`;
    const device = `audit-device-${suffix}`, foreignDevice = `audit-foreign-${suffix}`;
    const team = randomUUID(), binding = randomUUID(), role = `AUDIT_READER_${suffix}`;
    const ids = Object.fromEntries((["reader", "exact", "worker", "legacy", "platform", "support", "outsider"] as Kind[]).map(kind => [kind, `audit-${kind}-${suffix}`])) as Record<Kind, string>;
    const logs = Object.fromEntries(["local", "other", "foreign", "global", "provisioned", "feature", "unknown"].map(kind => [kind, randomUUID()])) as Parameters<typeof run>[0]["logs"];
    const tokens = new Map<string, string>();
    const request = async (user: string, path = "/audit", options: { method?: string; body?: unknown } = {}) => {
      if (!tokens.has(user)) tokens.set(user, (await login(server.url, `${user}@audit.test`)).accessToken);
      return call(server.url, path, { ...options, token: tokens.get(user) });
    };
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Audit fixtures',${org})`;
      for (const building of [a, b]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},${building},${building})`;
      for (const [kind,id] of Object.entries(ids)) await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin) values(${id},${kind},${`${id}@audit.test`},${passwordHash},${kind === 'platform'})`;
      await sqlClient`insert into roles(key,scope,label) values(${role},'BUILDING','Audit reader fixture')`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${role},'audit:read')`;
      await sqlClient`insert into teams(id,building_id,name) values(${team},${a},'Audit team')`;
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${team},${a},${ids.worker})`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${binding},${ids.reader},${a},${role})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${team},${a},${role})`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${ids.exact},${a},${role},'device',${device})`;
      await sqlClient`insert into role_bindings(user_id,role_key) values(${ids.support},'PLATFORM_SUPPORT')`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.legacy},${a},'BUILDING_ADMIN'),(${ids.legacy},${b},'RESIDENT')`;
      await sqlClient`insert into devices(id,building_id,name,type) values(${device},${a},'Audit target','WATER_LEVEL_SENSOR'),(${foreignDevice},${b},'Foreign target','WATER_LEVEL_SENSOR')`;
      const entries = [
        [logs.local, a, "DEVICE_UPDATED", "device", device],
        [logs.other, a, "MEMBERSHIP_UPSERTED", "membership", randomUUID()],
        [logs.foreign, b, "DEVICE_UPDATED", "device", foreignDevice],
        [logs.global, null, "ORGANIZATION_CREATED", "organization", org],
        [logs.provisioned, a, "BUILDING_CREATED", "building", a],
        [logs.feature, a, "FEATURE_CONFIGURATION_CHANGED", "feature", "TICKETS"],
        [logs.unknown, null, "DEVICE_UPDATED", "device", "removed-device"],
      ];
      for (const [id, building, action, type, resource] of entries) await sqlClient`insert into audit_logs(id,building_id,user_id,action,resource_type,resource_id,metadata,ip_address,user_agent,created_at) values(${id!},${building},${ids.platform},${action!},${type!},${resource},'{"private":"never expose raw payload"}','192.0.2.9','Private fixture agent','2026-01-01T00:00:00Z')`;
      await run({ a,b,org,device,foreignDevice,team,binding,role,ids,logs,request });
    } finally {
      await sqlClient`delete from audit_logs where id in ${sqlClient(Object.values(logs))}`;
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from buildings where organization_id=${org}`;
      await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from roles where key=${role}`;
    }
  }
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
  async function items(response: Response) {
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).items as { id: string; buildingId: string | null; [key: string]: unknown }[];
  }
  const sorted = (ids: string[]) => [...ids].sort();

  it("reapplication preserves removed default grants and inactive audit permissions", async () => {
    const migration = await readFile(new URL("../../../infrastructure/036-audit-capabilities.sql", import.meta.url), "utf8");
    const rollback = new Error("audit reapplication rollback");
    await assert.rejects(sqlClient.begin(async tx => {
      await tx`delete from role_permissions where (role_key='BUILDING_ADMIN' and permission_key='audit:read')
        or (role_key='PLATFORM_ADMIN' and permission_key='audit:read-platform')`;
      await tx`update permissions set active=false where key in ('audit:read','audit:read-platform')`;
      const before = await tx`select role_key,permission_key from role_permissions order by role_key,permission_key`;
      for (let application = 0; application < 2; application++) {
        await tx.unsafe(migration);
        assert.deepEqual(await tx`select role_key,permission_key from role_permissions order by role_key,permission_key`, before);
        const permissions = await tx`select key,active from permissions where key in ('audit:read','audit:read-platform') order by key`;
        assert.deepEqual([...permissions], [{ key: 'audit:read', active: false }, { key: 'audit:read-platform', active: false }]);
      }
      await tx`delete from permissions where key in ('audit:read','audit:read-platform')`;
      await tx.unsafe(migration);
      assert.equal((await tx`select key from permissions where key in ('audit:read','audit:read-platform')`).length, 0,
        'a removed catalog definition is not permission to recreate its default grant');
      throw rollback;
    }), error => error === rollback);
  });

  it("direct and team grants work without a legacy membership, with and without building filter", async () => fixture(async f => {
    for (const user of [f.ids.reader, f.ids.worker]) for (const path of ["/audit", `/audit?buildingId=${f.a}`]) {
      assert.deepEqual(sorted((await items(await f.request(user,path))).map(row => row.id)), sorted([f.logs.local,f.logs.other,f.logs.provisioned,f.logs.feature]));
    }
  }));
  it("platform reading does not include local or unclassified events, even if their actor is a platform admin", async () => fixture(async f => {
    assert.deepEqual(sorted((await items(await f.request(f.ids.platform))).map(row => row.id)), sorted([f.logs.global,f.logs.provisioned]));
  }));
  it("an explicit local grant combines with global reading without exposing any other tenant", async () => fixture(async f => {
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${f.ids.platform},${f.a},${f.role})`;
    assert.deepEqual(sorted((await items(await f.request(f.ids.platform))).map(row=>row.id)),sorted([f.logs.global,f.logs.provisioned,f.logs.local,f.logs.other,f.logs.feature]));
    assert.deepEqual(sorted((await items(await f.request(f.ids.platform,`/audit?buildingId=${f.a}`))).map(row=>row.id)),sorted([f.logs.provisioned,f.logs.local,f.logs.other,f.logs.feature]));
    await sqlClient`update role_bindings set active=false where user_id=${f.ids.platform} and building_id=${f.a}`;
    assert.deepEqual(sorted((await items(await f.request(f.ids.platform))).map(row=>row.id)),sorted([f.logs.global,f.logs.provisioned]));
  }));
  it("building admin A/resident B reads only A, and direct SQL enforces the same scope", async () => fixture(async f => {
    assert.deepEqual(sorted((await items(await f.request(f.ids.legacy))).map(row => row.id)), sorted([f.logs.local,f.logs.other,f.logs.provisioned,f.logs.feature]));
    assert.equal((await f.request(f.ids.legacy,`/audit?buildingId=${f.b}`)).status,403);
    const rows = await as(f.ids.reader,tx => tx.execute(sql`select id from audit_logs`));
    assert.deepEqual(sorted(rows.map(row => String(row.id))), sorted([f.logs.local,f.logs.other,f.logs.provisioned,f.logs.feature]));
  }));
  it("exact resource grants expose no neighbor, do not cross tenant and stop after resource removal", async () => fixture(async f => {
    assert.deepEqual((await items(await f.request(f.ids.exact))).map(row => row.id),[f.logs.local]);
    await sqlClient`update role_bindings set resource_id=${f.foreignDevice} where user_id=${f.ids.exact}`;
    assert.equal((await f.request(f.ids.exact)).status,403);
    await sqlClient`update role_bindings set resource_id=${f.device} where user_id=${f.ids.exact}`;
    await sqlClient`delete from devices where id=${f.device}`;
    assert.equal((await f.request(f.ids.exact)).status,403);
    assert.ok((await items(await f.request(f.ids.reader))).some(row => row.id===f.logs.local));
  }));
  it("unit membership audit aliases resolve to the actual membership resource and tenant", async () => fixture(async f => {
    const unit=randomUUID(), membership=randomUUID(), created=randomUUID(), revoked=randomUUID();
    await sqlClient`insert into units(id,building_id,code) values(${unit},${f.a},'101')`;
    await sqlClient`insert into unit_memberships(id,building_id,unit_id,user_id) values(${membership},${f.a},${unit},${f.ids.outsider})`;
    await sqlClient`update role_bindings set resource_type='membership',resource_id=${membership} where user_id=${f.ids.exact}`;
    await sqlClient`insert into audit_logs(id,building_id,user_id,action,resource_type,resource_id) values
      (${created},${f.a},${f.ids.platform},'UNIT_MEMBERSHIP_CREATED','unit_membership',${membership}),
      (${revoked},${f.a},${f.ids.platform},'UNIT_MEMBERSHIP_REVOKED','unit-memberships',${membership})`;
    assert.deepEqual(sorted((await items(await f.request(f.ids.exact))).map(row=>row.id)),sorted([created,revoked]));
    await sqlClient`delete from unit_memberships where id=${membership}`;
    assert.equal((await f.request(f.ids.exact)).status,403);
    assert.ok((await items(await f.request(f.ids.reader))).some(row=>row.id===revoked));
  }));
  it("HTTP projection and runtime columns omit raw metadata, IP and user-agent", async () => fixture(async f => {
    const rows = await items(await f.request(f.ids.legacy));
    for (const row of rows) for (const key of ["metadata","ipAddress","userAgent"]) assert.equal(Object.hasOwn(row,key),false,key);
    for (const column of ["metadata","ip_address","user_agent"]) await assert.rejects(as(f.ids.legacy,tx => tx.execute(sql.raw(`select ${column} from audit_logs`))), error => pgErrorCode(error)==='42501');
  }));
  it("revocation and team expiration take effect on the same access token", async () => fixture(async f => {
    assert.equal((await f.request(f.ids.reader)).status,200);
    await sqlClient`update role_bindings set active=false where id=${f.binding}`;
    assert.equal((await f.request(f.ids.reader)).status,403);
    assert.equal((await f.request(f.ids.worker)).status,200);
    await sqlClient`update team_members set ends_at=clock_timestamp()-interval '1 second' where team_id=${f.team}`;
    assert.equal((await f.request(f.ids.worker)).status,403);
  }));
  it("deleted building FK never promotes local audit to platform history", async () => fixture(async f => {
    await sqlClient`delete from buildings where id=${f.a}`;
    const rows = await items(await f.request(f.ids.platform));
    assert.ok(rows.some(row => row.id===f.logs.provisioned));
    for (const id of [f.logs.local,f.logs.other,f.logs.feature,f.logs.unknown]) assert.equal(rows.some(row => row.id===id),false,id);
  }));
  it("unauthorized users and support do not inherit audit; forged context is not authority", async () => fixture(async f => {
    for (const user of [f.ids.outsider,f.ids.support]) {
      assert.equal((await f.request(user)).status,403);
      assert.equal((await as(user,tx => tx.execute(sql`select id from audit_logs`))).length,0);
    }
  }));
  it("same-time pagination is stable and authorized empty history stays distinct from rejection", async () => fixture(async f => {
    const expected = sorted([f.logs.local,f.logs.other,f.logs.provisioned,f.logs.feature]).reverse();
    const found: string[] = [];
    for (let offset=0;offset<4;offset+=2) found.push(...(await items(await f.request(f.ids.reader,`/audit?limit=2&offset=${offset}`))).map(row => row.id));
    assert.deepEqual(found,expected);
    await sqlClient`delete from audit_logs where building_id=${f.a}`;
    assert.deepEqual(await items(await f.request(f.ids.reader)),[]);
    assert.equal((await f.request(f.ids.outsider)).status,403);
  }));
  it("inactive tenant, organization and role withdraw local visibility without changing the token", async () => fixture(async f => {
    assert.equal((await f.request(f.ids.reader)).status,200);
    for (const [table,id] of [["buildings",f.a],["organizations",f.org],["roles",f.role]] as const) {
      const key = table==='roles' ? 'key' : 'id';
      await sqlClient.unsafe(`update ${table} set active=false where ${key}=$1`,[id]);
      try { assert.equal((await f.request(f.ids.reader)).status,403); }
      finally { await sqlClient.unsafe(`update ${table} set active=true where ${key}=$1`,[id]); }
      assert.equal((await f.request(f.ids.reader)).status,200);
    }
    await sqlClient`update users set active=false where id=${f.ids.reader}`;
    assert.equal((await f.request(f.ids.reader)).status,401);
  }));
  it("team inactivity and future/expired membership windows do not retain audit access", async () => fixture(async f => {
    assert.equal((await f.request(f.ids.worker)).status,200);
    await sqlClient`update teams set active=false where id=${f.team}`;
    assert.equal((await f.request(f.ids.worker)).status,403);
    await sqlClient`update teams set active=true where id=${f.team}`;
    await sqlClient`update team_members set starts_at=clock_timestamp()+interval '1 hour' where team_id=${f.team}`;
    assert.equal((await f.request(f.ids.worker)).status,403);
    await sqlClient`update team_members set starts_at=null,ends_at=clock_timestamp()-interval '1 second' where team_id=${f.team}`;
    assert.equal((await f.request(f.ids.worker)).status,403);
  }));
  it("permission deactivation denies both runtime reading and query availability", async () => fixture(async f => {
    assert.equal((await f.request(f.ids.reader)).status,200);
    const [prior] = await sqlClient`select active from permissions where key='audit:read'`;
    await sqlClient`update permissions set active=false where key='audit:read'`;
    try {
      assert.equal((await f.request(f.ids.reader)).status,403);
      assert.equal((await as(f.ids.reader,tx => tx.execute(sql`select id from audit_logs`))).length,0);
    } finally { await sqlClient`update permissions set active=${prior!.active} where key='audit:read'`; }
  }));
  it("expiry is re-evaluated in a later statement of the same SQL transaction", async () => fixture(async f => {
    await sqlClient`update role_bindings set ends_at=clock_timestamp()+interval '300 milliseconds' where id=${f.binding}`;
    await as(f.ids.reader,async tx => {
      assert.ok((await tx.execute(sql`select id from audit_logs`)).length>0);
      await tx.execute(sql`select pg_sleep(0.4)`);
      assert.equal((await tx.execute(sql`select id from audit_logs`)).length,0);
    });
  }));
  it("global audit requires its own active permission and current platform role", async () => fixture(async f => {
    assert.equal((await f.request(f.ids.platform)).status,200);
    const [prior] = await sqlClient`select active from permissions where key='audit:read-platform'`;
    await sqlClient`update permissions set active=false where key='audit:read-platform'`;
    try { assert.equal((await f.request(f.ids.platform)).status,403); }
    finally { await sqlClient`update permissions set active=${prior!.active} where key='audit:read-platform'`; }
    await sqlClient`update users set is_platform_admin=false where id=${f.ids.platform}`;
    assert.equal((await f.request(f.ids.platform)).status,403);
  }));
  it("tenant snapshot remains immutable when the foreign key is cleared", async () => fixture(async f => {
    const [before] = await sqlClient`select scope_kind,scope_building_id from audit_logs where id=${f.logs.local}`;
    assert.deepEqual(before,{scope_kind:'BUILDING',scope_building_id:f.a});
    await assert.rejects(sqlClient`update audit_logs set scope_kind='PLATFORM' where id=${f.logs.local}`,e=>pgErrorCode(e)==='42501');
    await assert.rejects(sqlClient`update audit_logs set scope_building_id=${f.b} where id=${f.logs.local}`,e=>pgErrorCode(e)==='42501');
    await sqlClient`delete from buildings where id=${f.a}`;
    const [after] = await sqlClient`select building_id,scope_kind,scope_building_id from audit_logs where id=${f.logs.local}`;
    assert.deepEqual(after,{building_id:null,...before});
  }));
  it("application cannot update, delete or read private audit fields", async () => fixture(async f => {
    for (const user of [f.ids.reader,f.ids.legacy,f.ids.platform]) {
      await assert.rejects(as(user,tx=>tx.execute(sql`update audit_logs set action='REWRITTEN' where id=${f.logs.local}`)),e=>pgErrorCode(e)==='42501');
      await assert.rejects(as(user,tx=>tx.execute(sql`delete from audit_logs where id=${f.logs.local}`)),e=>pgErrorCode(e)==='42501');
      await assert.rejects(as(user,tx=>tx.execute(sql`select metadata from audit_logs`)),e=>pgErrorCode(e)==='42501');
    }
  }));
  it("unknown actions cannot use a legacy context or a real platform role to append audit", async () => fixture(async f => {
    for (const user of [f.ids.outsider,f.ids.reader,f.ids.legacy,f.ids.platform]) {
      for (const building of [f.a,null]) {
        await assert.rejects(as(user,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${building},${user},'UNREGISTERED_ACTION','device',${f.device})`)),e=>pgErrorCode(e)==='42501');
      }
    }
  }));
  it("legacy producer pairs require their real capability and a resource in the same tenant", async () => fixture(async f => {
    for (const user of [f.ids.outsider,f.ids.reader]) {
      await assert.rejects(as(user,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${user},'TEAM_CREATED','team',${f.team})`)),e=>pgErrorCode(e)==='42501');
    }
    for (const [building,type,id] of [[f.b,'team',f.team],[f.a,'device',f.device],[f.a,'team',randomUUID()]] as const) {
      await assert.rejects(as(f.ids.legacy,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${building},${f.ids.legacy},'TEAM_CREATED',${type},${id})`)),e=>pgErrorCode(e)==='42501');
    }
    await as(f.ids.legacy,tx=>tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${f.a},${f.ids.legacy},'TEAM_CREATED','team',${f.team})`));
  }));
  it("unscoped rejection stays stored but never becomes a platform event", async () => fixture(async f => {
    const id=randomUUID();
    await as(f.ids.outsider,tx=>tx.execute(sql`insert into audit_logs(id,user_id,action,resource_type,resource_id,scope_kind,scope_building_id) values(${id},${f.ids.outsider},'ACCESS_REQUEST_REJECTED','gate','invalid-target','PLATFORM',${f.a})`));
    const [row]=await sqlClient`select scope_kind,scope_building_id from audit_logs where id=${id}`;
    assert.deepEqual(row,{scope_kind:'LEGACY_UNKNOWN',scope_building_id:null});
    assert.equal((await items(await f.request(f.ids.platform))).some(row=>row.id===id),false);
  }));
  it("legacy administrator can revoke their sole local membership atomically", async () => fixture(async f => {
    const [membership]=await sqlClient`select id from memberships where building_id=${f.a} and user_id=${f.ids.legacy}`;
    const response=await f.request(f.ids.legacy,`/users/memberships/${membership!.id}`,{method:'DELETE'});
    assert.equal(response.status,204,await response.text());
    const [row]=await sqlClient`select active from memberships where id=${membership!.id}`;
    assert.equal(row!.active,false);
    const rows=await sqlClient`select user_id,resource_id,scope_kind,scope_building_id from audit_logs where user_id=${f.ids.legacy} and action='MEMBERSHIP_REVOKED'`;
    assert.deepEqual([...rows],[{user_id:f.ids.legacy,resource_id:membership!.id,scope_kind:'BUILDING',scope_building_id:f.a}]);
    assert.equal((await f.request(f.ids.legacy,`/audit?buildingId=${f.a}`)).status,403);
  }));
  it("a failed membership revocation rolls back its earlier audit as well", async () => fixture(async f => {
    const [membership]=await sqlClient`select id from memberships where building_id=${f.a} and user_id=${f.ids.legacy}`;
    const name=`audit_reject_${randomUUID().replaceAll('-','')}`;
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.id='${membership!.id}'::uuid then raise exception 'Fixture rejects mutation' using errcode='23514'; end if; return NEW; end $$`);
    try {
      await sqlClient.unsafe(`create trigger ${name} before update on memberships for each row execute function ${name}()`);
      const response=await f.request(f.ids.legacy,`/users/memberships/${membership!.id}`,{method:'DELETE'});
      assert.ok(response.status>=400,await response.text());
      const [row]=await sqlClient`select active from memberships where id=${membership!.id}`;
      assert.equal(row!.active,true);
      assert.equal((await sqlClient`select id from audit_logs where user_id=${f.ids.legacy} and action='MEMBERSHIP_REVOKED'`).length,0);
      assert.equal((await f.request(f.ids.legacy,`/audit?buildingId=${f.a}`)).status,200);
    } finally {
      await sqlClient.unsafe(`drop trigger if exists ${name} on memberships`);
      await sqlClient.unsafe(`drop function if exists ${name}()`);
    }
  }));
  it("a silently refused membership mutation cannot commit an audit or claim revocation", async () => fixture(async f => {
    const [membership]=await sqlClient`select id from memberships where building_id=${f.a} and user_id=${f.ids.legacy}`;
    const name=`audit_ignore_${randomUUID().replaceAll('-','')}`;
    await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin if NEW.id='${membership!.id}'::uuid then return null; end if; return NEW; end $$`);
    try {
      await sqlClient.unsafe(`create trigger ${name} before update on memberships for each row execute function ${name}()`);
      const response=await f.request(f.ids.legacy,`/users/memberships/${membership!.id}`,{method:'DELETE'});
      assert.equal(response.status,409);
      assert.equal((await sqlClient`select active from memberships where id=${membership!.id}`)[0]!.active,true);
      assert.equal((await sqlClient`select id from audit_logs where user_id=${f.ids.legacy} and action='MEMBERSHIP_REVOKED'`).length,0);
    } finally {
      await sqlClient.unsafe(`drop trigger if exists ${name} on memberships`);
      await sqlClient.unsafe(`drop function if exists ${name}()`);
    }
  }));
});
