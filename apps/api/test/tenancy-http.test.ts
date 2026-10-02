import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("tenancy HTTP with scoped capabilities", () => {
  const suffix = randomUUID(), org = `tenancy-org-${suffix}`;
  const building = `tenancy-a-${suffix}`, other = `tenancy-b-${suffix}`;
  const manager = `tenancy-manager-${suffix}`, resident = `tenancy-resident-${suffix}`, worker = `tenancy-worker-${suffix}`;
  let server: TestServer, managerToken: string, residentToken: string, workerToken: string;
  let blockId: string, unitId: string, teamId: string;
  async function request(path: string, method = "GET", body?: unknown, token = managerToken) {
    return call(server.url, `/v1/tenancy${path}`, { method, body, token });
  }
  async function ok(path: string, method = "GET", body?: unknown, token = managerToken, status = 200) {
    const response = await request(path, method, body, token);
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  before(async () => {
    const password = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Test tenancy',${org})`;
    for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${id},${id})`;
    for (const id of [manager, resident, worker]) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@test.local`},${password})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values (${manager},${building},'BUILDING_ADMIN'), (${resident},${building},'RESIDENT')`;
    server = await startTestServer();
    [managerToken, residentToken, workerToken] = await Promise.all([manager, resident, worker].map(async id => (await login(server.url, `${id}@test.local`)).accessToken));
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id in (${building},${other})`;
    await sqlClient`delete from buildings where id in (${building},${other})`;
    await sqlClient`delete from users where id in (${manager},${resident},${worker})`;
    await sqlClient`delete from organizations where id=${org}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("creates hierarchy and records each change with the actual actor", async () => {
    blockId = (await ok("/blocks", "POST", { buildingId: building, code: "A", name: "Bloco A" }, managerToken, 201)).id;
    unitId = (await ok("/units", "POST", { buildingId: building, blockId, code: "101", floor: 1 }, managerToken, 201)).id;
    teamId = (await ok("/teams", "POST", { buildingId: building, name: "Manutenção" }, managerToken, 201)).id;
    const audit = await sqlClient`select user_id from audit_logs where resource_id=${unitId} and action='UNIT_CREATED'`;
    assert.equal(audit.length, 1); assert.equal(audit[0]!.user_id, manager);
  });
  it("rejects cross-tenant parents, unauthorized creation and invalid bodies", async () => {
    const [foreign] = await sqlClient`insert into blocks(building_id,code,name) values(${other},'B','Foreign') returning id`;
    assert.equal((await request("/units", "POST", { buildingId: building, blockId: foreign!.id, code: "102" })).status, 400);
    assert.equal((await request("/units", "POST", { buildingId: other, code: "201" })).status, 403);
    assert.equal((await request("/teams", "POST", { buildingId: building, name: "Escalation" }, residentToken)).status, 403);
    assert.equal((await request("/units", "POST", { buildingId: building, code: "" })).status, 400);
  });
  it("resident sees only their units and cannot enumerate neighbors' memberships", async () => {
    await ok("/unit-memberships", "POST", { buildingId: building, unitId, userId: resident, kind: "OCCUPANT" }, managerToken, 201);
    await ok("/units", "POST", { buildingId: building, blockId, code: "103" }, managerToken, 201);
    const own = await ok(`/units?buildingId=${building}`, "GET", undefined, residentToken);
    assert.deepEqual(own.items.map((unit: { id: string }) => unit.id), [unitId]);
    assert.equal((await request(`/unit-memberships?buildingId=${building}`, "GET", undefined, residentToken)).status, 403);
    assert.equal((await request(`/units?buildingId=${other}`, "GET", undefined, residentToken)).status, 403);
  });
  it("grants maintenance capabilities by team without turning a worker into a building admin", async () => {
    const member = await ok("/team-members", "POST", { buildingId: building, teamId, userId: worker }, managerToken, 201);
    await ok("/role-bindings", "POST", { buildingId: building, teamId, roleKey: "MAINTENANCE", reason: "Equipe contratada" }, managerToken, 201);
    const response = await call(server.url, `/v1/authorization?buildingId=${building}`, { token: workerToken });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.capabilities.includes("telemetry:read"));
    assert.ok(!body.capabilities.includes("memberships:manage"));
    assert.ok(!body.capabilities.includes("finance:read"));
    assert.equal((await request("/teams", "POST", { buildingId: building, name: "Escalation" }, workerToken)).status, 403);
    assert.equal((await request(`/team-members/${member.id}`, "DELETE")).status, 204);
    assert.equal((await call(server.url, `/v1/authorization?buildingId=${building}`, { token: workerToken })).status, 403);
  });
  it("rejects platform delegation and loses permissions immediately when membership ends", async () => {
    assert.equal((await request("/role-bindings", "POST", { buildingId: building, userId: worker, roleKey: "PLATFORM_ADMIN", reason: "Escalation" })).status, 400);
    await sqlClient`update memberships set active=false where user_id=${manager} and building_id=${building}`;
    try {
      assert.equal((await request(`/role-bindings?buildingId=${building}`)).status, 403);
      assert.equal((await request("/teams", "POST", { buildingId: building, name: "Revoked" })).status, 403);
    } finally { await sqlClient`update memberships set active=true where user_id=${manager} and building_id=${building}`; }
  });
  it("can add revoked and expired team members again without duplicating a live grant", async () => {
    const input = { buildingId: building, teamId, userId: worker };
    const responses = await Promise.all([request("/team-members", "POST", input), request("/team-members", "POST", input)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const renewed = await responses.find(response => response.status === 201)!.json();
    assert.equal((await call(server.url, `/v1/authorization?buildingId=${building}`, { token: workerToken })).status, 200);
    await sqlClient`update team_members set ends_at=now()-interval '1 minute' where id=${renewed.id}`;
    assert.equal((await call(server.url, `/v1/authorization?buildingId=${building}`, { token: workerToken })).status, 403);
    const active = await ok("/team-members", "POST", input, managerToken, 201);
    assert.equal(active.id, renewed.id);
    assert.equal(active.endsAt, null);
    assert.equal((await call(server.url, `/v1/authorization?buildingId=${building}`, { token: workerToken })).status, 200);
    const audit = await sqlClient`select user_id from audit_logs where resource_id=${active.id} and action='TEAM_MEMBER_ADDED'`;
    assert.equal(audit.length, 3);
    assert.ok(audit.every(row => row.user_id === manager));
  });
  it("can revoke the actor's sole administrative binding and keeps the audit atomic", async () => {
    const binding = await ok("/role-bindings", "POST", { buildingId: building, userId: worker, roleKey: "BUILDING_ADMIN", reason: "Gestão temporária" }, managerToken, 201);
    assert.equal((await request(`/role-bindings/${binding.id}`, "DELETE", undefined, workerToken)).status, 204);
    const [revoked] = await sqlClient`select active from role_bindings where id=${binding.id}`;
    assert.equal(revoked!.active, false);
    const audit = await sqlClient`select user_id from audit_logs where resource_id=${binding.id} and action='ROLE_BINDING_REVOKED'`;
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.user_id, worker);
    assert.equal((await request("/teams", "POST", { buildingId: building, name: "Revoked manager" }, workerToken)).status, 403);
  });
});
