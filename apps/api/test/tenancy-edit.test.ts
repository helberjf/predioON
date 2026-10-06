import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it, mock } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("tenancy edits and status of blocks, units and teams", () => {
  const suffix = randomUUID(), org = `tenancy-edit-org-${suffix}`;
  const building = `tenancy-edit-a-${suffix}`, other = `tenancy-edit-b-${suffix}`;
  const manager = `tenancy-edit-manager-${suffix}`, resident = `tenancy-edit-resident-${suffix}`, outsider = `tenancy-edit-outsider-${suffix}`;
  let server: TestServer, managerToken: string, residentToken: string, outsiderToken: string;
  let blockId: string, secondBlockId: string, unitId: string, neighborUnitId: string, teamId: string;
  let foreignBlockId: string, foreignUnitId: string, foreignTeamId: string;
  const request = (path: string, body: unknown, token = managerToken) => call(server.url, `/v1/tenancy${path}`, { method: "PATCH", body, token });
  async function ok(path: string, body: unknown) {
    const response = await request(path, body);
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data as Record<string, unknown>;
  }
  const audits = (resourceId: string, action: string) => sqlClient`select user_id,building_id,resource_type,metadata from audit_logs where resource_id=${resourceId} and action=${action} order by created_at`;
  const updates = async () => (await sqlClient`select count(*)::int as count from audit_logs where building_id in (${building},${other}) and action ~ '^(BLOCK|UNIT|TEAM)_(UPDATED|DEACTIVATED|REACTIVATED)$'`)[0]!.count as number;

  before(async () => {
    const password = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Test tenancy edit',${org})`;
    for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
    for (const id of [manager, resident, outsider]) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@test.local`},${password})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values (${manager},${building},'BUILDING_ADMIN'), (${resident},${building},'RESIDENT')`;
    [blockId, secondBlockId] = (await sqlClient`insert into blocks(building_id,code,name) values(${building},'A','Bloco A'),(${building},'B','Bloco B') returning id`).map(row => row.id as string);
    [unitId, neighborUnitId] = (await sqlClient`insert into units(building_id,block_id,code,floor) values(${building},${blockId!},'101',1),(${building},${blockId!},'102',1) returning id`).map(row => row.id as string);
    teamId = (await sqlClient`insert into teams(building_id,name) values(${building},'Manutenção') returning id`)[0]!.id;
    await sqlClient`insert into unit_memberships(building_id,unit_id,user_id,kind) values(${building},${unitId},${resident},'OCCUPANT')`;
    foreignBlockId = (await sqlClient`insert into blocks(building_id,code,name) values(${other},'F','Foreign') returning id`)[0]!.id;
    foreignUnitId = (await sqlClient`insert into units(building_id,code) values(${other},'901') returning id`)[0]!.id;
    foreignTeamId = (await sqlClient`insert into teams(building_id,name) values(${other},'Foreign') returning id`)[0]!.id;
    server = await startTestServer();
    [managerToken, residentToken, outsiderToken] = await Promise.all([manager, resident, outsider].map(async id => (await login(server.url, `${id}@test.local`)).accessToken));
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id in (${building},${other})`;
    await sqlClient`delete from buildings where id in (${building},${other})`;
    await sqlClient`delete from users where id in (${manager},${resident},${outsider})`;
    await sqlClient`delete from organizations where id=${org}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("edits each record, returns its public view and audits the actual actor", async () => {
    assert.deepEqual(await ok(`/blocks/${blockId}`, { code: "A1", name: "Torre A" }), { id: blockId, buildingId: building, code: "A1", name: "Torre A", active: true });
    assert.deepEqual(await ok(`/units/${unitId}`, { code: "101-A", floor: null, blockId: secondBlockId }), { id: unitId, buildingId: building, blockId: secondBlockId, code: "101-A", floor: null, active: true });
    assert.deepEqual(await ok(`/units/${unitId}`, { blockId: null }), { id: unitId, buildingId: building, blockId: null, code: "101-A", floor: null, active: true });
    assert.deepEqual(await ok(`/teams/${teamId}`, { name: "  Manutenção predial  " }), { id: teamId, buildingId: building, name: "Manutenção predial", kind: "MAINTENANCE", active: true });
    const [block] = await sqlClient`select code,name,active,updated_at>created_at as touched from blocks where id=${blockId}`;
    assert.deepEqual({ ...block }, { code: "A1", name: "Torre A", active: true, touched: true });
    for (const [resourceId, action, type, fields] of [
      [blockId, "BLOCK_UPDATED", "block", [["code", "name"]]],
      [unitId, "UNIT_UPDATED", "unit", [["blockId", "code", "floor"], ["blockId"]]],
      [teamId, "TEAM_UPDATED", "team", [["name"]]],
    ] as const) {
      const rows = await audits(resourceId, action);
      assert.deepEqual(rows.map(row => ({ ...row })), fields.map(list => ({ user_id: manager, building_id: building, resource_type: type, metadata: { fields: list } })));
    }
  });

  it("rejects readers, strangers, foreign tenants and malformed requests without any change or audit", async () => {
    const before = await updates();
    assert.equal((await request(`/units/${unitId}`, { code: "hijack" }, residentToken)).status, 403, "own visible unit is not editable");
    for (const path of [`/units/${neighborUnitId}`, `/blocks/${secondBlockId}`, `/teams/${teamId}`]) {
      // Records outside the caller's own projection are indistinguishable from missing ones.
      for (const token of [residentToken, outsiderToken]) assert.equal((await request(path, path.startsWith("/units") ? { code: "x" } : { name: "x" }, token)).status, 404, path);
    }
    assert.equal((await request(`/blocks/${foreignBlockId}`, { name: "x" })).status, 404);
    assert.equal((await request(`/units/${foreignUnitId}`, { code: "x" })).status, 404);
    assert.equal((await request(`/teams/${foreignTeamId}`, { name: "x" })).status, 404);
    assert.equal((await request(`/teams/${randomUUID()}`, { name: "x" })).status, 404);
    assert.equal((await request("/teams/not-a-uuid", { name: "x" })).status, 404);
    for (const [path, body] of [
      [`/blocks/${blockId}`, {}], [`/blocks/${blockId}`, { name: "" }], [`/blocks/${blockId}`, { active: false }],
      [`/blocks/${blockId}`, { name: "ok", buildingId: other }], [`/units/${unitId}`, { floor: 301 }], [`/units/${unitId}`, { code: null }],
      [`/units/${unitId}`, { blockId: "not-a-uuid" }], [`/teams/${teamId}`, { name: "ok", kind: "SUPPORT" }],
    ] as const) assert.equal((await request(path, body)).status, 400, `${path} ${JSON.stringify(body)}`);
    assert.equal((await request(`/units/${unitId}`, { blockId: foreignBlockId })).status, 400, "block of another condominium");
    assert.equal((await request(`/units/${unitId}`, { code: "102" })).status, 409);
    assert.equal((await request(`/blocks/${blockId}`, { code: "B" })).status, 409);
    assert.equal(await updates(), before);
    const [unit] = await sqlClient`select code,block_id from units where id=${unitId}`;
    assert.deepEqual({ ...unit }, { code: "101-A", block_id: null });
    assert.equal((await sqlClient`select name from blocks where id=${foreignBlockId}`)[0]!.name, "Foreign");
  });

  it("does not edit or reactivate an inactive record", async () => {
    await sqlClient`update teams set active=false where id=${teamId}`;
    try {
      assert.equal((await request(`/teams/${teamId}`, { name: "Reactivated" })).status, 404);
      const [team] = await sqlClient`select name,active from teams where id=${teamId}`;
      assert.deepEqual({ ...team }, { name: "Manutenção predial", active: false });
    } finally { await sqlClient`update teams set active=true where id=${teamId}`; }
  });

  it("loses the edit immediately when the manager's grant ends", async () => {
    await sqlClient`update memberships set active=false where user_id=${manager} and building_id=${building}`;
    try {
      assert.ok([403, 404].includes((await request(`/blocks/${blockId}`, { name: "Revoked" })).status));
      assert.equal((await sqlClient`select name from blocks where id=${blockId}`)[0]!.name, "Torre A");
    } finally { await sqlClient`update memberships set active=true where user_id=${manager} and building_id=${building}`; }
  });

  it("rolls the edit back when its mandatory audit fails", async () => {
    const name = `tenancy_edit_${randomUUID().replaceAll("-", "")}`;
    const logger = mock.method(console, "error", () => {});
    try {
      await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin
        if new.resource_id=TG_ARGV[0] and new.action='TEAM_UPDATED' then raise exception 'Fixture audit failure'; end if;
        return new; end $$`);
      await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${teamId}')`);
      assert.equal((await request(`/teams/${teamId}`, { name: "Not persisted" })).status, 500);
      assert.equal((await sqlClient`select name from teams where id=${teamId}`)[0]!.name, "Manutenção predial");
    } finally {
      await sqlClient.unsafe(`drop trigger if exists ${name} on audit_logs`);
      await sqlClient.unsafe(`drop function if exists ${name}()`);
      logger.mock.restore();
    }
  });

  const status = (path: string, active: unknown, token = managerToken) => request(`${path}/status`, typeof active === "boolean" ? { active } : active, token);
  const list = async (name: string, query = "", token = managerToken) => call(server.url, `/v1/tenancy/${name}?buildingId=${building}${query}`, { token });
  const ids = async (response: Response) => { assert.equal(response.status, 200); return ((await response.json()) as { items: Array<{ id: string }> }).items.map(row => row.id); };
  const authorization = async (token: string) => (await call(server.url, `/v1/authorization?buildingId=${building}`, { token })).status;

  it("deactivates and reactivates a team, ending and restoring the access derived from it", async () => {
    const post = (path: string, body: unknown) => call(server.url, `/v1/tenancy${path}`, { method: "POST", body, token: managerToken });
    assert.equal((await post("/team-members", { buildingId: building, teamId, userId: outsider })).status, 201);
    assert.equal((await post("/role-bindings", { buildingId: building, teamId, roleKey: "MAINTENANCE", reason: "Equipe contratada" })).status, 201);
    assert.equal(await authorization(outsiderToken), 200);
    const off = await status(`/teams/${teamId}`, false);
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { id: teamId, buildingId: building, name: "Manutenção predial", kind: "MAINTENANCE", active: false });
    assert.equal(await authorization(outsiderToken), 403);
    assert.equal((await status(`/teams/${teamId}`, false)).status, 200, "repeating the same state is not an error");
    assert.ok(!(await ids(await list("teams"))).includes(teamId));
    assert.ok((await ids(await list("teams", "&includeInactive=true"))).includes(teamId));
    assert.equal((await request(`/teams/${teamId}`, { name: "Edited while inactive" })).status, 404);
    const on = await status(`/teams/${teamId}`, true);
    assert.equal(((await on.json()) as { active: boolean }).active, true);
    assert.equal(await authorization(outsiderToken), 200);
    assert.deepEqual((await sqlClient`select action,user_id from audit_logs where resource_id=${teamId} and action in ('TEAM_DEACTIVATED','TEAM_REACTIVATED') order by created_at`).map(row => ({ ...row })),
      [{ action: "TEAM_DEACTIVATED", user_id: manager }, { action: "TEAM_REACTIVATED", user_id: manager }]);
  });

  it("hides a resident's unit while it or its block is inactive and shows it again afterwards", async () => {
    await sqlClient`update units set block_id=${blockId} where id=${unitId}`;
    assert.deepEqual(await ids(await list("units", "", residentToken)), [unitId]);
    for (const path of [`/units/${unitId}`, `/blocks/${blockId}`]) {
      assert.equal((await status(path, false)).status, 200);
      assert.deepEqual(await ids(await list("units", "", residentToken)), [], path);
      assert.equal((await status(path, true)).status, 200);
      assert.deepEqual(await ids(await list("units", "", residentToken)), [unitId], path);
    }
    assert.equal((await audits(unitId, "UNIT_DEACTIVATED")).length, 1);
    assert.equal((await audits(blockId, "BLOCK_REACTIVATED")).length, 1);
  });

  it("rejects status changes and inactive listings outside the management capability", async () => {
    const before = await updates();
    assert.equal((await status(`/units/${unitId}`, false, residentToken)).status, 403);
    assert.equal((await status(`/teams/${teamId}`, false, residentToken)).status, 404);
    assert.equal((await status(`/blocks/${foreignBlockId}`, false)).status, 404);
    assert.equal((await status("/units/not-a-uuid", false)).status, 404);
    for (const body of [{}, { active: "false" }, { active: null }, { active: false, name: "x" }]) assert.equal((await status(`/units/${unitId}`, body)).status, 400, JSON.stringify(body));
    assert.equal((await list("units", "&includeInactive=true", residentToken)).status, 403);
    assert.equal((await list("units", "&includeInactive=maybe")).status, 400);
    assert.equal(await updates(), before);
    assert.equal((await sqlClient`select active from units where id=${unitId}`)[0]!.active, true);
  });

  it("audits the actor who deactivates the team that grants their own management", async () => {
    const [team] = await sqlClient`insert into teams(building_id,name) values(${building},'Gestão terceirizada') returning id`;
    await sqlClient`insert into team_members(building_id,team_id,user_id) values(${building},${team!.id},${outsider})`;
    await sqlClient`update team_members set active=false where team_id=${teamId} and user_id=${outsider}`;
    await sqlClient`insert into role_bindings(building_id,team_id,role_key,reason,granted_by) values(${building},${team!.id},'BUILDING_ADMIN','Gestão temporária',${manager})`;
    assert.equal((await status(`/teams/${team!.id}`, false, outsiderToken)).status, 200);
    assert.deepEqual((await audits(team!.id, "TEAM_DEACTIVATED")).map(row => row.user_id), [outsider]);
    assert.equal((await status(`/teams/${team!.id}`, true, outsiderToken)).status, 404, "the lost grant cannot restore itself");
    assert.equal((await sqlClient`select active from teams where id=${team!.id}`)[0]!.active, false);
  });

  it("binds each audit action to the manager's own condominium and resource at the SQL boundary", async () => {
    const insert = (user: string, role: "BUILDING_ADMIN" | "RESIDENT", target: string, action: string, type: string, id: string) =>
      withUserContext({ userId: user, role }, tx => tx.execute(sql`insert into audit_logs(building_id,user_id,action,resource_type,resource_id) values(${target},${user},${action},${type},${id})`));
    const denied = (promise: Promise<unknown>) => assert.rejects(promise, error => pgErrorCode(error) === "42501");
    await denied(insert(resident, "RESIDENT", building, "UNIT_UPDATED", "unit", unitId));
    await denied(insert(manager, "BUILDING_ADMIN", other, "UNIT_UPDATED", "unit", foreignUnitId));
    await denied(insert(manager, "BUILDING_ADMIN", building, "UNIT_UPDATED", "unit", foreignUnitId));
    await denied(insert(manager, "BUILDING_ADMIN", building, "BLOCK_UPDATED", "unit", blockId));
    await denied(insert(manager, "BUILDING_ADMIN", building, "TEAM_UPDATED", "team", unitId));
    await denied(insert(manager, "BUILDING_ADMIN", building, "TEAM_DELETED", "team", teamId));
    await denied(insert(resident, "RESIDENT", building, "UNIT_DEACTIVATED", "unit", unitId));
    await denied(insert(manager, "BUILDING_ADMIN", other, "TEAM_DEACTIVATED", "team", foreignTeamId));
    await denied(insert(manager, "BUILDING_ADMIN", building, "BLOCK_REACTIVATED", "block", foreignBlockId));
  });

  it("reapplies 041 without changing any function, ACL or policy and fails closed on an unexpected branch", async () => {
    const migration = await readFile(new URL("../../../infrastructure/041-tenancy-edit-audit.sql", import.meta.url), "utf8");
    const rollback = new Error("041 reapplication rollback");
    await assert.rejects(sqlClient.begin(async owner => {
      const invariant = async () => ({
        functions: await owner`select p.oid::regprocedure::text as signature,p.prosrc,p.proacl::text,p.proowner,p.proconfig,p.prosecdef,p.provolatile
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by signature`,
        policies: await owner`select * from pg_policies where schemaname='public' order by tablename,policyname`,
      });
      const before = await invariant();
      const [proof] = before.functions.filter(row => row.signature === "app_audit_legacy_insert(text,text,text,text)");
      for (const kind of ["BLOCK", "UNIT", "TEAM"]) for (const event of ["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]) {
        assert.equal(proof!.prosrc.split(`'${kind}_${event}'`).length, 2, `${kind}_${event} appears once`);
      }
      await owner.unsafe(migration);
      assert.deepEqual(await invariant(), before);
      await owner.unsafe(`do $$ begin execute replace(pg_get_functiondef('app_audit_legacy_insert(text,text,text,text)'::regprocedure),
        '''TEAM_REACTIVATED''', '''TEAM_RESTORED'''); end $$`);
      await owner.unsafe("savepoint unexpected");
      await assert.rejects(owner.unsafe(migration), /Unexpected team audit branch/);
      await owner.unsafe("rollback to savepoint unexpected");
      throw rollback;
    }), error => error === rollback);
  });
});
