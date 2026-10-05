import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("platform authorization exposes only the current commercial capabilities", () => {
  let server: TestServer, passwordHash: string;
  before(async () => { passwordHash = await hashPassword("predioon123"); server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });
  async function fixture(run: (f: { user: string; binding: string; token: string; request: () => Promise<Response> }) => Promise<void>) {
    const user = `org-projection-${randomUUID()}`, binding = randomUUID();
    try {
      await sqlClient`insert into users(id,name,email,password_hash) values(${user},'Projection fixture',${user + '@org039.test'},${passwordHash})`;
      await sqlClient`insert into role_bindings(id,user_id,role_key) values(${binding},${user},'PLATFORM_ADMIN')`;
      const { accessToken: token } = await login(server.url, user + '@org039.test');
      await run({ user, binding, token, request: () => call(server.url, '/v1/authorization/platform', { token }) });
    } finally { await sqlClient`delete from users where id=${user}`; }
  }
  it("returns a finite no-store projection without inventory or role-derived private powers", async () => fixture(async f => {
    const response = await f.request();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { capabilities: ['organizations:manage', 'organizations:read'] });
    assert.equal((await call(server.url, '/v1/authorization')).status, 401);
  }));
  it("returns an empty current scope on revocation using the same session", async () => fixture(async f => {
    assert.equal((await f.request()).status, 200);
    for (const mutation of [
      () => sqlClient`update role_bindings set active=false where id=${f.binding}`,
      () => sqlClient`update role_bindings set starts_at=clock_timestamp()+interval '1 hour' where id=${f.binding}`,
      () => sqlClient`update role_bindings set ends_at=clock_timestamp()-interval '1 second' where id=${f.binding}`,
    ]) {
      await mutation();
      const response = await f.request();
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { capabilities: [] });
      await sqlClient`update role_bindings set active=true,starts_at=null,ends_at=null where id=${f.binding}`;
    }
  }));
  it("reports read and manage independently and preserves active catalog metadata", async () => fixture(async f => {
    for (const key of ['organizations:read', 'organizations:manage']) {
      const [prior] = await sqlClient`select to_jsonb(p) row from permissions p where key=${key}`;
      assert.ok(prior, '039 permission must exist for this post-migration negative');
      try {
        await sqlClient`update permissions set active=false where key=${key}`;
        const response = await f.request(); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { capabilities: [key.endsWith(':read') ? 'organizations:manage' : 'organizations:read'] });
      } finally {
        await sqlClient`update permissions set (active,created_at)=(select active,created_at from jsonb_populate_record(null::permissions,${JSON.stringify(prior.row)}::jsonb)) where key=${key}`;
      }
    }
  }));
  it("requires active authenticated identity and does not turn query parameters into global authority", async () => fixture(async f => {
    assert.equal((await call(server.url, '/v1/authorization/platform')).status, 401);
    await sqlClient`delete from role_bindings where id=${f.binding}`;
    const response = await call(server.url, '/v1/authorization/platform?buildingId=foreign&resourceType=organization&resourceId=any', { token: f.token });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { capabilities: [] });
    await sqlClient`update users set active=false where id=${f.user}`;
    assert.equal((await f.request()).status, 401);
  }));
});
