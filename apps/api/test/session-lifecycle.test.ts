import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { decodeJwt } from "jose";
import { call, json, login, startTestServer, unique, type TestServer } from "./helpers.js";
import { startRealtimeBus } from "../src/modules/events/bus.js";

describe("session lifecycle against PostgreSQL", () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.close(); await closeAppDb(); await sqlClient.end(); });

  it("allows only one concurrent refresh and revokes the winning family after replay", async () => {
    const first = await login(server.url, "morador@predioon.local");
    const attempts = await Promise.all(Array.from({ length: 6 }, () => call(server.url, "/auth/refresh", {
      method: "POST", body: { refreshToken: first.refreshToken },
    })));
    assert.equal(attempts.filter((response) => response.status === 200).length, 1);
    const winner = await json<{ accessToken: string; refreshToken: string }>(attempts.find((response) => response.status === 200)!);
    assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: winner.refreshToken } })).status, 401);
    assert.equal((await call(server.url, "/auth/me", { token: winner.accessToken })).status, 401);
  });

  it("logs out a rotated family using the consumed token", async () => {
    const first = await login(server.url, "morador@predioon.local");
    const rotatedResponse = await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: first.refreshToken } });
    assert.equal(rotatedResponse.status, 200);
    const rotated = await json<{ accessToken: string; refreshToken: string }>(rotatedResponse);
    assert.equal((await call(server.url, "/auth/logout", { method: "POST", body: { refreshToken: first.refreshToken } })).status, 204);
    assert.equal((await call(server.url, "/auth/me", { token: rotated.accessToken })).status, 401);
    assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: rotated.refreshToken } })).status, 401);
  });

  it("revokes every login for an account while leaving other accounts valid", async () => {
    const first = await login(server.url, "morador@predioon.local");
    const second = await login(server.url, "morador@predioon.local");
    const other = await login(server.url, "admin@predioon.local");
    assert.equal((await call(server.url, "/auth/sessions/revoke-all", { method: "POST", token: first.accessToken })).status, 204);
    assert.equal((await call(server.url, "/auth/me", { token: first.accessToken })).status, 401);
    assert.equal((await call(server.url, "/auth/me", { token: second.accessToken })).status, 401);
    assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: second.refreshToken } })).status, 401);
    assert.equal((await call(server.url, "/auth/me", { token: other.accessToken })).status, 200);
  });

  it("rejects revoked tokens at the SSE entrypoint", async () => {
    const session = await login(server.url, "morador@predioon.local");
    assert.equal((await call(server.url, "/auth/logout", { method: "POST", body: { refreshToken: session.refreshToken } })).status, 204);
    assert.equal((await call(server.url, "/events/stream", { token: session.accessToken })).status, 401);
  });

  it("ends an already open SSE stream before delivering events after revocation", async () => {
    await startRealtimeBus();
    const session = await login(server.url, "morador@predioon.local");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${server.url}/events/stream`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    try {
      await reader.read(); // Subscription is established after the initial retry frame.
      assert.equal((await call(server.url, "/auth/logout", { method: "POST", body: { refreshToken: session.refreshToken } })).status, 204);
      await sqlClient`select pg_notify('predioon_events', ${JSON.stringify({ kind: "features-changed", buildingId: "*" })})`;
      const next = await reader.read();
      assert.equal(next.done, true, next.value && new TextDecoder().decode(next.value));
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it("rejects an inactive account and uses current account fields", async () => {
    const session = await login(server.url, "morador@predioon.local");
    const [original] = await sqlClient`select name, active from users where id='resident_demo'`;
    try {
      await sqlClient`update users set name='Nome atualizado' where id='resident_demo'`;
      const current = await json<{ name: string }>(await call(server.url, "/auth/me", { token: session.accessToken }));
      assert.equal(current.name, "Nome atualizado");
      await sqlClient`update users set active=false where id='resident_demo'`;
      assert.equal((await call(server.url, "/auth/me", { token: session.accessToken })).status, 401);
      assert.equal((await call(server.url, "/events/stream", { token: session.accessToken })).status, 401);
      assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } })).status, 401);
    } finally {
      await sqlClient`update users set active=${original!.active as boolean}, name=${original!.name as string} where id='resident_demo'`;
    }
  });

  it("does not extend an expired refresh family", async () => {
    const session = await login(server.url, "morador@predioon.local");
    const sid = decodeJwt(session.accessToken).sid as string;
    await sqlClient`update sessions set expires_at=now() - interval '1 minute' where id=${sid}`;
    assert.equal((await call(server.url, "/auth/me", { token: session.accessToken })).status, 401);
    assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } })).status, 401);
  });

  it("lists only own sessions and forbids revoking another user's session", async () => {
    const resident = await login(server.url, "morador@predioon.local");
    const admin = await login(server.url, "admin@predioon.local");
    const residentList = await call(server.url, "/auth/sessions", { token: resident.accessToken });
    assert.equal(residentList.status, 200);
    const sessions = await json<{ items: Array<{ id: string; userId: string; current: boolean }> }>(residentList);
    const residentId = sessions.items.find((session) => session.current)?.id;
    assert.ok(residentId);
    const adminList = await json<{ items: Array<{ id: string }> }>(await call(server.url, "/auth/sessions", { token: admin.accessToken }));
    assert.ok(!adminList.items.some((session) => session.id === residentId));
    assert.equal((await call(server.url, `/auth/sessions/${residentId}`, { method: "DELETE", token: admin.accessToken })).status, 404);
    assert.equal((await call(server.url, "/auth/me", { token: resident.accessToken })).status, 200);
    assert.equal((await call(server.url, `/auth/sessions/${residentId}`, { method: "DELETE", token: resident.accessToken })).status, 204);
    assert.equal((await call(server.url, "/auth/me", { token: resident.accessToken })).status, 401);
  });

  it("refreshes current identity and immediately excludes inactive or time-bounded memberships", async () => {
    const session = await login(server.url, "morador@predioon.local");
    const id = unique("session-member");
    const org = unique("session-org");
    try {
      await sqlClient`insert into organizations (id,name,slug) values (${org},'Session test',${org})`;
      await sqlClient`insert into buildings (id,organization_id,name,code) values (${id},${org},'Session building',${id})`;
      await sqlClient`insert into memberships (user_id,building_id,role,starts_at) values ('resident_demo',${id},'BUILDING_ADMIN',now() + interval '1 day')`;
      const future = await json<{ memberships: Array<{ buildingId: string }> }>(await call(server.url, "/auth/me", { token: session.accessToken }));
      assert.ok(!future.memberships.some((membership) => membership.buildingId === id));
      await sqlClient`update memberships set starts_at=now() - interval '1 day', ends_at=now() + interval '1 day' where user_id='resident_demo' and building_id=${id}`;
      const active = await json<{ role: string; memberships: Array<{ buildingId: string }> }>(await call(server.url, "/auth/me", { token: session.accessToken }));
      assert.ok(active.memberships.some((membership) => membership.buildingId === id));
      assert.equal(active.role, "BUILDING_ADMIN");
      await sqlClient`update memberships set ends_at=now() - interval '1 minute' where user_id='resident_demo' and building_id=${id}`;
      const ended = await json<{ role: string; memberships: Array<{ buildingId: string }> }>(await call(server.url, "/auth/me", { token: session.accessToken }));
      assert.ok(!ended.memberships.some((membership) => membership.buildingId === id));
      assert.equal(ended.role, "RESIDENT");
      await sqlClient`update memberships set ends_at=now() + interval '1 day' where user_id='resident_demo' and building_id=${id}`;
      await sqlClient`update buildings set active=false where id=${id}`;
      const disabled = await json<{ memberships: Array<{ buildingId: string }> }>(await call(server.url, "/auth/me", { token: session.accessToken }));
      assert.ok(!disabled.memberships.some((membership) => membership.buildingId === id));
      await sqlClient`update buildings set active=true where id=${id}`;
      await sqlClient`update organizations set active=false where id=${org}`;
      const disabledOrg = await json<{ memberships: Array<{ buildingId: string }> }>(await call(server.url, "/auth/me", { token: session.accessToken }));
      assert.ok(!disabledOrg.memberships.some((membership) => membership.buildingId === id));
    } finally {
      await sqlClient`delete from buildings where id=${id}`;
      await sqlClient`delete from organizations where id=${org}`;
    }
  });
});
