import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

type Person = { id: string; name: string; email: string };
type PeoplePage = { items: Person[]; nextCursor: string | null };

describe("tenant people directory without broadening users RLS", () => {
  let server: TestServer, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  // The legacy app.role setting must never grant directory authority.
  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);

  async function create() {
    const suffix = randomUUID(), org = `people-org-${suffix}`;
    const building = `people-a-${suffix}`, other = `people-b-${suffix}`;
    const names = ["manager", "legacy", "personal", "team", "unit", "foreign", "unlinked", "inactive", "expired", "future", "revoked", "platform", "restricted", "teamManager"] as const;
    const ids = Object.fromEntries(names.map(name => [name, `people-${name}-${suffix}`])) as Record<typeof names[number], string>;
    const teamId = randomUUID(), unitId = randomUUID(), managerBinding = randomUUID();
    const teamRole = `PEOPLE_TEAM_MANAGER_${suffix}`;
    const tokens = new Map<string, string>();
    const email = (id: string) => `${id.toLowerCase()}@directory.test`;
    const cleanup = async () => {
      await sqlClient`delete from buildings where organization_id=${org}`;
      await sqlClient`delete from organizations where id=${org}`;
      await sqlClient`delete from users where id in ${sqlClient(Object.values(ids))}`;
      await sqlClient`delete from roles where key=${teamRole}`;
    };
    try {
      await sqlClient`insert into organizations(id,name,slug) values(${org},'Directory test',${org})`;
      for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
      for (const [key, id] of Object.entries(ids)) await sqlClient`insert into users(id,name,email,password_hash,active,is_platform_admin) values(${id},${key},${email(id)},${passwordHash},${key !== "inactive"},${key === "platform"})`;
      await sqlClient`insert into roles(key,scope,label) values(${teamRole},'BUILDING','Team directory manager')`;
      await sqlClient`insert into role_permissions(role_key,permission_key) values(${teamRole},'teams:manage')`;
      await sqlClient`insert into teams(id,building_id,name) values(${teamId},${building},'Directory team')`;
      await sqlClient`insert into units(id,building_id,code) values(${unitId},${building},'101')`;
      await sqlClient`insert into role_bindings(id,user_id,building_id,role_key) values(${managerBinding},${ids.manager},${building},'BUILDING_ADMIN')`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${ids.personal},${building},'MAINTENANCE'),(${ids.teamManager},${building},${teamRole})`;
      await sqlClient`insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id) values(${ids.restricted},${building},'BUILDING_ADMIN','unit',${unitId})`;
      await sqlClient`insert into memberships(user_id,building_id,role) values(${ids.legacy},${building},'RESIDENT'),(${ids.foreign},${other},'RESIDENT'),(${ids.inactive},${building},'RESIDENT')`;
      await sqlClient`insert into memberships(user_id,building_id,role,ends_at) values(${ids.expired},${building},'RESIDENT',now()-interval '1 minute')`;
      await sqlClient`insert into memberships(user_id,building_id,role,starts_at) values(${ids.future},${building},'RESIDENT',now()+interval '1 day')`;
      await sqlClient`insert into memberships(user_id,building_id,role,active) values(${ids.revoked},${building},'RESIDENT',false)`;
      await sqlClient`insert into team_members(team_id,building_id,user_id) values(${teamId},${building},${ids.team})`;
      await sqlClient`insert into role_bindings(team_id,building_id,role_key) values(${teamId},${building},'MAINTENANCE')`;
      await sqlClient`insert into unit_memberships(unit_id,building_id,user_id) values(${unitId},${building},${ids.unit})`;
      for (const id of [ids.manager, ids.legacy, ids.platform, ids.restricted, ids.teamManager, ids.unlinked]) tokens.set(id, (await login(server.url, email(id))).accessToken);
      const request = (user = ids.manager, query = `buildingId=${building}`) => call(server.url, `/v1/tenancy/people?${query}`, { token: tokens.get(user) });
      const expected = [ids.manager, ids.legacy, ids.personal, ids.team, ids.unit, ids.restricted, ids.teamManager].sort();
      return { org, building, other, ids, teamId, unitId, managerBinding, teamRole, request, expected, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
  type Fixture = Awaited<ReturnType<typeof create>>;
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const f = await create();
    try { await run(f); }
    finally { await f.cleanup(); }
  }
  async function ok(f: Fixture, user = f.ids.manager, query?: string) {
    const response = await f.request(user, query);
    const body = await response.json() as PeoplePage;
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return body;
  }

  it("supports RBAC-only managers and every current tenant link with minimal fields", async () => fixture(async f => {
    const body = await ok(f);
    assert.deepEqual(body.items.map(row => row.id).sort(), f.expected);
    for (const row of body.items) assert.deepEqual(Object.keys(row).sort(), ["email", "id", "name"]);
    const direct = await as(f.ids.manager, tx => tx.execute(sql`select id,name,email from app_tenancy_people(${f.building},null,100)`));
    assert.deepEqual(direct.map(row => row.id).sort(), f.expected);
    // Directory authority does not make raw users rows visible across RBAC-only links.
    const raw = await withUserContext({ userId: f.ids.manager, role: "RESIDENT" }, tx => tx.execute(sql`select id from users where id=${f.ids.unit}`));
    assert.equal(raw.length, 0);
  }));

  it("accepts teams:manage alone and refuses ordinary resident, global admin and resource-only admin", async () => fixture(async f => {
    assert.deepEqual((await ok(f, f.ids.teamManager)).items.map(row => row.id).sort(), f.expected);
    for (const actor of [f.ids.legacy, f.ids.platform, f.ids.restricted, f.ids.unlinked]) {
      assert.equal((await f.request(actor)).status, 403, actor);
      await assert.rejects(as(actor, tx => tx.execute(sql`select * from app_tenancy_people(${f.building},null,100)`)), error => pgErrorCode(error) === "42501");
    }
    assert.equal((await call(server.url, `/v1/tenancy/people?buildingId=${f.building}`)).status, 401);
  }));

  it("never enumerates another tenant and ignores foreign/unlinked cursors as selectors", async () => fixture(async f => {
    assert.equal((await f.request(f.ids.manager, `buildingId=${f.other}`)).status, 403);
    await assert.rejects(as(f.ids.manager, tx => tx.execute(sql`select * from app_tenancy_people(${f.other},null,100)`)), error => pgErrorCode(error) === "42501");
    const body = await ok(f, f.ids.manager, `buildingId=${f.building}&after=${encodeURIComponent(f.ids.foreign)}`);
    assert.ok(body.items.every(row => f.expected.includes(row.id)));
    assert.ok(!JSON.stringify(body).includes(f.ids.foreign));
  }));

  it("pages by text user ID with no duplicates and validates bounded inputs", async () => fixture(async f => {
    let cursor: string | null = null;
    const found: string[] = [];
    const cursors = new Set<string>();
    do {
      const body = await ok(f, f.ids.manager, `buildingId=${f.building}&limit=2${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`);
      assert.ok(body.items.length <= 2);
      found.push(...body.items.map(row => row.id));
      cursor = body.nextCursor;
      if (cursor) { assert.ok(!cursors.has(cursor), "directory cursor must advance"); cursors.add(cursor); }
    } while (cursor);
    assert.equal(new Set(found).size, found.length);
    assert.deepEqual(found.sort(), f.expected);
    for (const query of ["", `buildingId=${f.building}&limit=101`, `buildingId=${f.building}&limit=0`, `buildingId=${f.building}&after=${"x".repeat(129)}`]) assert.equal((await f.request(f.ids.manager, query)).status, 400);
    for (const size of [0, 101]) await assert.rejects(as(f.ids.manager, tx => tx.execute(sql`select * from app_tenancy_people(${f.building},null,${size})`)), error => pgErrorCode(error) === "22023");
  }));

  it("drops revoked/future links and inactive unit/team parents immediately", async () => fixture(async f => {
    await sqlClient`update role_bindings set ends_at=now()-interval '1 second' where user_id=${f.ids.personal}`;
    await sqlClient`update teams set active=false where id=${f.teamId}`;
    await sqlClient`update units set active=false where id=${f.unitId}`;
    const rows = (await ok(f)).items.map(row => row.id);
    for (const id of [f.ids.personal, f.ids.team, f.ids.unit]) assert.ok(!rows.includes(id));
    await sqlClient`update role_bindings set active=false where id=${f.managerBinding}`;
    assert.equal((await f.request()).status, 403);
    await assert.rejects(as(f.ids.manager, tx => tx.execute(sql`select * from app_tenancy_people(${f.building},null,100)`)), error => pgErrorCode(error) === "42501");
  }));

  it("denies helper execution to identity/broker roles and preserves hardened ownership", async () => fixture(async f => {
    await assert.rejects(identitySqlClient`select * from app_tenancy_people(${f.building},null,100)`, { code: "42501" });
    await assert.rejects(brokerAuthSqlClient`select * from app_tenancy_people(${f.building},null,100)`, { code: "42501" });
    const [metadata] = await sqlClient`select p.prosecdef,p.proconfig,r.rolname as owner,has_function_privilege('predioon_app',p.oid,'EXECUTE') as app_execute,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
      from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='app_tenancy_people(text,text,integer)'::regprocedure`;
    assert.equal(metadata!.prosecdef, true); assert.equal(metadata!.app_execute, true); assert.equal(metadata!.public_execute, false);
    assert.ok(!["predioon_app", "predioon_identity", "predioon_broker_auth"].includes(metadata!.owner));
    assert.ok(metadata!.proconfig.includes("search_path=public, pg_temp"));
  }));
});
