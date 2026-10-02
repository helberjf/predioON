import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, json, login, startTestServer, type Session, type TestServer } from "./helpers.js";

describe("legacy membership readmission against PostgreSQL", () => {
  const suffix = randomUUID();
  const organizationId = `member_org_${suffix}`, buildingId = `member_building_${suffix}`;
  const managerId = `member_manager_${suffix}`, residentId = `member_resident_${suffix}`;
  const membershipId = randomUUID();
  let server: TestServer, manager: Session, resident: Session;

  before(async () => {
    const passwordHash = await hashPassword("predioon123");
    await sqlClient`insert into organizations (id,name,slug) values (${organizationId},'Membership lifecycle',${organizationId})`;
    await sqlClient`insert into buildings (id,organization_id,name,code) values (${buildingId},${organizationId},'Membership lifecycle',${buildingId})`;
    for (const userId of [managerId, residentId]) {
      await sqlClient`insert into users (id,name,email,password_hash) values (${userId},${userId},${`${userId}@test.local`},${passwordHash})`;
    }
    await sqlClient`insert into memberships (user_id,building_id,role) values (${managerId},${buildingId},'BUILDING_ADMIN')`;
    await sqlClient`insert into memberships (id,user_id,building_id,role) values (${membershipId},${residentId},${buildingId},'RESIDENT')`;
    server = await startTestServer();
    manager = await login(server.url, `${managerId}@test.local`);
    resident = await login(server.url, `${residentId}@test.local`);
  });

  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id=${buildingId}`;
    await sqlClient`delete from buildings where id=${buildingId}`;
    await sqlClient`delete from users where id in (${managerId},${residentId})`;
    await sqlClient`delete from organizations where id=${organizationId}`;
    await closeAppDb();
    await sqlClient.end();
  });

  const readmit = (token = manager.accessToken) => call(server.url, "/users/memberships", {
    method: "POST", token, body: { userId: residentId, buildingId, role: "RESIDENT", unit: "101" },
  });
  async function visibleMemberships() {
    const response = await call(server.url, "/auth/me", { token: resident.accessToken });
    assert.equal(response.status, 200);
    return (await json<{ memberships: Array<{ buildingId: string }> }>(response)).memberships;
  }

  it("restores access using the same JWT after revoke and readmit", async () => {
    assert.equal((await call(server.url, `/users/memberships/${membershipId}`, {
      method: "DELETE", token: manager.accessToken,
    })).status, 204);
    assert.ok(!(await visibleMemberships()).some(link => link.buildingId === buildingId));
    const response = await readmit();
    assert.equal(response.status, 201);
    const membership = await json<{ id: string; active: boolean; startsAt: string | null; endsAt: string | null }>(response);
    assert.equal(membership.id, membershipId, "readmission retains the auditable membership identity");
    assert.equal(membership.active, true);
    assert.equal(membership.startsAt, null);
    assert.equal(membership.endsAt, null, "the previous revocation must not keep the new admission expired");
    assert.ok((await visibleMemberships()).some(link => link.buildingId === buildingId));
  });

  it("renews an expired membership that still has active=true", async () => {
    await sqlClient`update memberships set active=true, starts_at=now()-interval '2 days', ends_at=now()-interval '1 day' where id=${membershipId}`;
    assert.ok(!(await visibleMemberships()).some(link => link.buildingId === buildingId));
    const response = await readmit();
    assert.equal(response.status, 201);
    const membership = await json<{ startsAt: string | null; endsAt: string | null }>(response);
    assert.equal(membership.startsAt, null);
    assert.equal(membership.endsAt, null);
    assert.ok((await visibleMemberships()).some(link => link.buildingId === buildingId));
  });

  it("preserves future and current validity windows during ordinary edits", async () => {
    for (const startsInFuture of [true, false]) {
      const [before] = await sqlClient`update memberships set active=true,
        starts_at=now() + (${startsInFuture ? 1 : -1} * interval '1 day'), ends_at=now()+interval '2 days'
        where id=${membershipId} returning starts_at::text, ends_at::text`;
      assert.equal((await readmit()).status, 201);
      const [after] = await sqlClient`select starts_at::text, ends_at::text, unit from memberships where id=${membershipId}`;
      assert.equal(after.starts_at, before.starts_at);
      assert.equal(after.ends_at, before.ends_at);
      assert.equal(after.unit, "101");
      assert.equal((await visibleMemberships()).some(link => link.buildingId === buildingId), !startsInFuture);
    }
  });

  it("does not let a resident readmit their own revoked membership", async () => {
    await sqlClient`update memberships set active=false, ends_at=now() where id=${membershipId}`;
    assert.equal((await readmit(resident.accessToken)).status, 403);
    const [membership] = await sqlClient`select active from memberships where id=${membershipId}`;
    assert.equal(membership.active, false);
  });
});
