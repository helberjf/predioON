import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { decodeJwt } from "jose";
import { sqlClient } from "@predioon/db";
import { closeAppDb } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { config } from "../src/config.js";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";
import { loginBudgetKeys } from "../src/auth/login-budget-keys.js";
import { signAccessToken } from "../src/auth/tokens.js";
import { readFile } from "node:fs/promises";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

describe("password replacement and credential serialization against PostgreSQL", () => {
  let server: TestServer;
  const currentPassword = " Legacy password 123! ";
  const nextPassword = " Nova senha literal 456! ";
  before(async () => { server = await startTestServer(); });
  after(async () => { await server?.close(); await closeAppDb(); await sqlClient.end(); });

  async function fixture(run: (f: { id: string; email: string; token: string; refresh: string; sid: string; hash: string }) => Promise<void>, originalPassword = currentPassword) {
    const id = `password-${randomUUID()}`, email = `${id}@example.invalid`, hash = await hashPassword(originalPassword);
    const keys = loginBudgetKeys(config.authRateLimitKey, email, "127.0.0.1");
    try {
      // Other test files use this same socket bucket. Wait for normal refill
      // before fixture setup; never reset admission or retry the behavior under
      // assertion. Deliberate429 assertions still observe the first response.
      const deadline = Date.now() + 60_000;
      for (;;) {
        const [network] = await sqlClient`select least(300,tokens+greatest(0,extract(epoch from clock_timestamp()-updated_at))*5)>=20 ready
          from auth_login_buckets where scope='network' and key_hash=${keys.network}`;
        if (!network || network.ready) break;
        assert.ok(Date.now() < deadline, "Shared fixture network admission did not refill");
        await setTimeout(200);
      }
      await sqlClient`insert into users(id,name,email,password_hash) values(${id},'Password fixture',${email},${hash})`;
      const session = await login(server.url, email, originalPassword);
      await run({ id, email, hash, token: session.accessToken, refresh: session.refreshToken, sid: decodeJwt(session.accessToken).sid as string });
    } finally {
      await sqlClient`delete from users where id=${id}`;
      await sqlClient`delete from auth_login_buckets where scope='account' and key_hash=${keys.account}`;
    }
  }
  const change = (token: string, body: unknown = { currentPassword, newPassword: nextPassword }) =>
    call(server.url, "/auth/password", { method: "POST", token, body });
  async function stored(id: string) {
    const [user] = await sqlClient`select password_hash from users where id=${id}`;
    const families = await sqlClient`select id,revoked_at,revoked_reason from sessions where user_id=${id} order by id`;
    return { hash: user!.password_hash as string, families };
  }
  async function waitForBlockedIdentity(settled?: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (settled?.()) assert.fail("Identity operation finished before acquiring the expected account lock");
      const [waiting] = await sqlClient`select count(*)::int n from pg_stat_activity where usename='predioon_identity'
        and wait_event_type='Lock' and (query like '%identity_lock_account_active%' or query like '%insert into "sessions"%')`;
      if (waiting!.n > 0) return;
      await setTimeout(20);
    }
    assert.fail("Identity operation did not reach an observed PostgreSQL row-lock wait");
  }

  it("replaces the literal password and revokes every own family, including the caller, without changing another account", async () => fixture(async f => {
    const second = await login(server.url, f.email, currentPassword);
    const other = await login(server.url, "admin@predioon.local");
    const response = await change(f.token);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
    const result = await stored(f.id);
    assert.notEqual(result.hash, f.hash);
    assert.equal(await verifyPassword(nextPassword, result.hash), true);
    assert.equal(await verifyPassword(nextPassword.trim(), result.hash), false);
    assert.ok(result.families.length >= 2);
    assert.ok(result.families.every(family => family.revoked_at && family.revoked_reason === "PASSWORD_CHANGED"));
    for (const token of [f.token, second.accessToken]) assert.equal((await call(server.url, "/auth/me", { token })).status, 401);
    for (const refreshToken of [f.refresh, second.refreshToken]) assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken } })).status, 401);
    assert.equal((await call(server.url, "/auth/me", { token: other.accessToken })).status, 200);
    assert.equal((await call(server.url, "/auth/login", { method: "POST", body: { email: f.email, password: currentPassword } })).status, 401);
    assert.equal((await call(server.url, "/auth/login", { method: "POST", body: { email: f.email, password: nextPassword } })).status, 200);
  }));

  it("keeps the password and families intact on incorrect confirmation or reuse", async () => fixture(async f => {
    for (const body of [{ currentPassword: currentPassword.trim(), newPassword: nextPassword }, { currentPassword, newPassword: currentPassword }]) {
      assert.equal((await change(f.token, body)).status, 400);
      const result = await stored(f.id);
      assert.equal(result.hash, f.hash); assert.ok(result.families.every(family => !family.revoked_at));
      assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
    }
    const key = loginBudgetKeys(config.authRateLimitKey, f.email, "127.0.0.1").account;
    const [budget] = await sqlClient`select tokens from auth_login_buckets where scope='account' and key_hash=${key}`;
    assert.ok(Number(budget!.tokens) < 18, "both failed confirmations consume committed admission");
  }));

  it("rejects account selectors and invalid/oversized bodies before consuming admission", async () => fixture(async f => {
    const key = loginBudgetKeys(config.authRateLimitKey, f.email, "127.0.0.1").account;
    const [before] = await sqlClient`select tokens,updated_at from auth_login_buckets where scope='account' and key_hash=${key}`;
    for (const body of [
      {}, { currentPassword, newPassword: "x".repeat(14) }, { currentPassword, newPassword: "😀".repeat(14) },
      { currentPassword: "é".repeat(513), newPassword: nextPassword }, { currentPassword, newPassword: "é".repeat(513) },
      { currentPassword, newPassword: nextPassword, userId: "admin_demo" }, { currentPassword, newPassword: nextPassword, email: f.email },
      { currentPassword, newPassword: nextPassword, sessionId: f.sid },
      { currentPassword, newPassword: "\ud800".repeat(15) },
    ]) assert.equal((await change(f.token, body)).status, 400);
    const oversized = await fetch(`${server.url}/auth/password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${f.token}` }, body: JSON.stringify({ currentPassword, newPassword: "x".repeat(9000) }) });
    assert.equal(oversized.status, 413);
    const [after] = await sqlClient`select tokens,updated_at from auth_login_buckets where scope='account' and key_hash=${key}`;
    assert.deepEqual(after, before);
    assert.equal((await stored(f.id)).hash, f.hash);
  }));

  it("accepts fifteen Unicode code points and exactly1024 UTF8 bytes without composition rules", async () => {
    for (const newPassword of ["😀".repeat(15), " ".repeat(15), "é".repeat(512)]) await fixture(async f => {
      assert.equal((await change(f.token, { currentPassword, newPassword })).status, 204);
      assert.equal(await verifyPassword(newPassword, (await stored(f.id)).hash), true);
    });
  });

  it("shares login admission using the authenticated account and fails closed before changing credentials", async () => fixture(async f => {
    const keys = loginBudgetKeys(config.authRateLimitKey, f.email, "127.0.0.1");
    await sqlClient`update auth_login_buckets set tokens=0,updated_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 minutes' where scope='account' and key_hash=${keys.account}`;
    const response = await change(f.token);
    assert.equal(response.status, 429); assert.match(response.headers.get("retry-after") ?? "", /^[1-9][0-9]*$/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await stored(f.id)).hash, f.hash);
    assert.equal((await call(server.url, "/auth/login", { method: "POST", body: { email: f.email, password: currentPassword } })).status, 429);
    assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
  }));

  it("requires a live own bearer session rather than a cookie or a valid foreign session id", async () => fixture(async f => {
    assert.equal((await change("")).status, 401);
    const other = await login(server.url, "admin@predioon.local");
    const forged = await signAccessToken({ sub: f.id, sid: decodeJwt(other.accessToken).sid as string });
    assert.equal((await change(forged)).status, 401);
    await sqlClient`update sessions set revoked_at=clock_timestamp() where id=${f.sid}`;
    assert.equal((await change(f.token)).status, 401);
    assert.equal((await stored(f.id)).hash, f.hash);
  }));

  it("denies expired sessions and inactive accounts without altering the credential", async () => {
    for (const inactive of [false, true]) await fixture(async f => {
      if (inactive) await sqlClient`update users set active=false where id=${f.id}`;
      else await sqlClient`update sessions set expires_at=clock_timestamp()-interval '1 second' where id=${f.sid}`;
      assert.equal((await change(f.token)).status, 401);
      assert.equal((await stored(f.id)).hash, f.hash);
    });
  });

  it("protects web changes with CSRF and clears the refresh cookie only after success", async () => fixture(async f => {
    const origin = config.corsOrigins[0]!;
    const headers = { Origin: origin, "X-Predioon-Web": "1", "Content-Type": "application/json", Authorization: `Bearer ${f.token}` };
    const webLogin = await fetch(`${server.url}/auth/web/login`, { method: "POST", headers, body: JSON.stringify({ email: f.email, password: currentPassword }) });
    assert.equal(webLogin.status, 200);
    const cookie = webLogin.headers.getSetCookie()[0]!.split(";")[0]!;
    const request = (extra: Record<string, string> = {}, body: unknown = { currentPassword, newPassword: nextPassword }) => fetch(`${server.url}/auth/web/password`, { method: "POST", headers: { ...headers, Cookie: cookie, ...extra }, body: JSON.stringify(body) });
    for (const extra of [{ Origin: "" }, { Origin: "https://untrusted.invalid" }, { "X-Predioon-Web": "" }, { "Sec-Fetch-Site": "cross-site" }]) {
      const response = await request(extra); assert.equal(response.status, 403); assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal((await request({ Authorization: "" })).status, 401, "refresh cookie never authorizes a credential mutation");
    assert.equal((await request({ "Content-Type": "text/plain" })).status, 415);
    const incorrect = await request({}, { currentPassword: "wrong", newPassword: nextPassword });
    assert.equal(incorrect.status, 400); assert.equal(incorrect.headers.get("set-cookie"), null);
    const result = await request(); assert.equal(result.status, 204);
    assert.match(result.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
    assert.match(result.headers.get("set-cookie")!, /HttpOnly/);
  }));

  it("rejects a login that verified the old password before waiting for a changed credential", async () => fixture(async f => {
    const owner = await sqlClient.reserve();
    let pending: Promise<Response> | undefined;
    try {
      await owner`begin`; await owner`select id from users where id=${f.id} for update`;
      pending = call(server.url, "/auth/login", { method: "POST", body: { email: f.email, password: currentPassword } });
      await waitForBlockedIdentity();
      await owner`update users set password_hash=${await hashPassword(nextPassword)} where id=${f.id}`;
      await owner`update sessions set revoked_at=clock_timestamp(),revoked_reason='PASSWORD_CHANGED' where user_id=${f.id}`;
      await owner`commit`;
      assert.equal((await pending).status, 401);
      const [active] = await sqlClient`select count(*)::int n from sessions where user_id=${f.id} and revoked_at is null`;
      assert.equal(active!.n, 0);
    } finally { await owner`rollback`.catch(() => undefined); owner.release(); await pending?.then(response => response.body?.cancel()); }
  }));

  it("acquires the account before the refresh family, so a waiting refresh holds no family lock", async () => fixture(async f => {
    const owner = await sqlClient.reserve(), probe = await sqlClient.reserve();
    let pending: Promise<Response> | undefined;
    try {
      await owner`begin`; await owner`select id from users where id=${f.id} for update`;
      pending = call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: f.refresh } });
      await waitForBlockedIdentity();
      await probe`begin`;
      await assert.doesNotReject(() => probe`select id from sessions where id=${f.sid} for update nowait`);
      await probe`rollback`;
      await owner`update users set active=false where id=${f.id}`; await owner`commit`;
      assert.equal((await pending).status, 401);
    } finally { await owner`rollback`.catch(() => undefined); await probe`rollback`.catch(() => undefined); owner.release(); probe.release(); await pending?.then(response => response.body?.cancel()); }
  }));

  it("all-family revocation waits for the account before acquiring any family, matching password replacement", async () => fixture(async f => {
    const owner = await sqlClient.reserve(), probe = await sqlClient.reserve();
    let pending: Promise<Response> | undefined, active = false, settled = false;
    try {
      await owner`begin`; active = true; await owner`select id from users where id=${f.id} for update`;
      pending = call(server.url, "/auth/sessions/revoke-all", { method: "POST", token: f.token }).then(response => { settled = true; return response; });
      await waitForBlockedIdentity(() => settled);
      await probe`begin`; await probe`select id from sessions where id=${f.sid} for update nowait`; await probe`rollback`;
      await owner`commit`; active = false;
      assert.equal((await pending).status, 204);
      assert.ok((await stored(f.id)).families.every(family => family.revoked_at));
    } finally { if (active) await owner`rollback`; await probe`rollback`.catch(() => undefined); owner.release(); probe.release(); await pending?.then(response => response.body?.cancel()); }
  }));

  it("allows one of two concurrent changes, then rejects the stale credential without partial revocations", async () => fixture(async f => {
    const otherPassword = " Segunda senha literal789! ";
    const responses = await Promise.all([change(f.token), change(f.token, { currentPassword, newPassword: otherPassword })]);
    assert.equal(responses.filter(response => response.status === 204).length, 1);
    assert.ok(responses.every(response => [204, 400, 401].includes(response.status)));
    const result = await stored(f.id);
    assert.ok(result.families.every(family => family.revoked_at));
    const winners = await Promise.all([nextPassword, otherPassword].map(password => verifyPassword(password, result.hash)));
    assert.equal(winners.filter(Boolean).length, 1);
  }));

  for (const table of ["users", "sessions"]) it(`rolls back credential and every family when ${table} triggers throw, skip, or rewrite the intended value`, async t => {
    const errors: unknown[][] = [];
    const log = t.mock.method(console, "error", (...values: unknown[]) => { errors.push(values); });
    try {
      for (const mode of ["skip", "throw", "rewrite"]) await fixture(async f => {
        const suffix = randomUUID().replaceAll("-", ""), fn = `test_password_failure_${suffix}`, trigger = `test_password_trigger_${suffix}`;
        const field = table === "users" ? "id" : "user_id";
        const behavior = mode === "skip" ? "return null;" : mode === "throw" ? "raise exception 'Isolated password persistence failure';"
          : table === "users" ? "NEW.password_hash:=OLD.password_hash;" : "NEW.revoked_at:=NULL;";
        await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin
          if NEW.${field}=TG_ARGV[0] then ${behavior} end if;
          return NEW; end $$`);
        let installed = false;
        try {
          const [definition] = await sqlClient`select format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.%I(%L)',${trigger}::text,${table}::text,${fn}::text,${f.id}::text) ddl`;
          await sqlClient.unsafe(definition!.ddl as string); installed = true;
          const before = await stored(f.id);
          const response = await change(f.token); assert.equal(response.status, 503);
          assert.equal(response.headers.get("set-cookie"), null);
          assert.deepEqual(await response.json(), { error: "Não foi possível alterar a senha. Tente novamente em instantes." });
          assert.deepEqual(await stored(f.id), before);
          assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
          await sqlClient.unsafe(`drop trigger ${trigger} on ${table}`); installed = false;
          assert.equal((await change(f.token)).status, 204, "the same family remains usable after failed persistence");
        } finally {
          if (installed) await sqlClient.unsafe(`drop trigger ${trigger} on ${table}`);
          await sqlClient.unsafe(`drop function public.${fn}()`);
        }
      });
      assert.deepEqual(errors, [], "driver errors must never log old/new hashes");
    } finally { log.mock.restore(); }
  });

  it("rejects a well-formed new string that represents the same UTF8 bytes as a legacy malformed password", async () => {
    const originalPassword = "\ud800".repeat(15), newPassword = "\ufffd".repeat(15);
    assert.notEqual(originalPassword, newPassword); assert.deepEqual(Buffer.from(originalPassword), Buffer.from(newPassword));
    await fixture(async f => {
      const response = await change(f.token, { currentPassword: originalPassword, newPassword });
      assert.equal(response.status, 400); assert.equal((await stored(f.id)).hash, f.hash);
      assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
    }, originalPassword);
  });

  it("allows a legacy malformed current password to migrate to a different well-formed password", async () => {
    const originalPassword = "\ud800".repeat(15);
    await fixture(async f => {
      const response = await change(f.token, { currentPassword: originalPassword, newPassword: nextPassword });
      assert.equal(response.status, 204); assert.equal(await verifyPassword(nextPassword, (await stored(f.id)).hash), true);
    }, originalPassword);
  });

  for (const table of ["users", "sessions"]) it(`rolls back replacement if an AFTER trigger rewrites persisted ${table}`, async () => fixture(async f => {
    const suffix = randomUUID().replaceAll("-", ""), fn = `test_password_after_${suffix}`, trigger = `test_password_after_trigger_${suffix}`;
    const field = table === "users" ? "id" : "user_id";
    const mutation = table === "users" ? "UPDATE public.users SET password_hash=OLD.password_hash WHERE id=NEW.id;"
      : "UPDATE public.sessions SET revoked_at=NULL WHERE id=NEW.id;";
    await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin
      if pg_trigger_depth()=1 AND NEW.${field}=TG_ARGV[0] then ${mutation} end if; return NEW; end $$`);
    let installed = false;
    try {
      const [definition] = await sqlClient`select format('CREATE TRIGGER %I AFTER UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.%I(%L)',${trigger}::text,${table}::text,${fn}::text,${f.id}::text) ddl`;
      await sqlClient.unsafe(definition!.ddl as string); installed = true;
      const before = await stored(f.id);
      const response = await change(f.token); assert.equal(response.status, 503);
      assert.deepEqual(await stored(f.id), before);
    } finally { if (installed) await sqlClient.unsafe(`drop trigger ${trigger} on ${table}`); await sqlClient.unsafe(`drop function public.${fn}()`); }
  }));

  it("rolls back replacement if an AFTER trigger inserts another active family", async () => fixture(async f => {
    const suffix = randomUUID().replaceAll("-", ""), fn = `test_password_insert_${suffix}`, trigger = `test_password_insert_trigger_${suffix}`;
    await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin
      if pg_trigger_depth()=1 AND NEW.id::text=TG_ARGV[0] then INSERT INTO public.sessions(user_id,expires_at) VALUES(NEW.user_id,NEW.expires_at); end if; return NEW; end $$`);
    let installed = false;
    try {
      const [definition] = await sqlClient`select format('CREATE TRIGGER %I AFTER UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.%I(%L)',${trigger}::text,${fn}::text,${f.sid}::text) ddl`;
      await sqlClient.unsafe(definition!.ddl as string); installed = true;
      const before = await stored(f.id);
      assert.equal((await change(f.token)).status, 503); assert.deepEqual(await stored(f.id), before);
    } finally { if (installed) await sqlClient.unsafe(`drop trigger ${trigger} on sessions`); await sqlClient.unsafe(`drop function public.${fn}()`); }
  }));

  it("rolls back all-family revocation if an AFTER trigger inserts another active family", async () => fixture(async f => {
    const suffix = randomUUID().replaceAll("-", ""), fn = `test_revoke_insert_${suffix}`, trigger = `test_revoke_insert_trigger_${suffix}`;
    await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin
      if pg_trigger_depth()=1 AND NEW.id::text=TG_ARGV[0] then INSERT INTO public.sessions(user_id,expires_at) VALUES(NEW.user_id,NEW.expires_at); end if; return NEW; end $$`);
    let installed = false;
    try {
      const [definition] = await sqlClient`select format('CREATE TRIGGER %I AFTER UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.%I(%L)',${trigger}::text,${fn}::text,${f.sid}::text) ddl`;
      await sqlClient.unsafe(definition!.ddl as string); installed = true;
      const before = await stored(f.id);
      assert.equal((await call(server.url, "/auth/sessions/revoke-all", { method: "POST", token: f.token })).status, 503);
      assert.deepEqual(await stored(f.id), before);
    } finally { if (installed) await sqlClient.unsafe(`drop trigger ${trigger} on sessions`); await sqlClient.unsafe(`drop function public.${fn}()`); }
  }));

  it("does not emit own credential changes into global or tenant audit storage", async () => fixture(async f => {
    const [before] = await sqlClient`select count(*)::int n from audit_logs where user_id=${f.id}`;
    assert.equal((await change(f.token)).status, 204);
    const [after] = await sqlClient`select count(*)::int n from audit_logs where user_id=${f.id}`;
    assert.equal(after!.n, before!.n);
  }));

  it("revalidates the caller after a family-lock wait and leaves the credential intact after logout", async () => fixture(async f => {
    const owner = await sqlClient.reserve(); let pending: Promise<Response> | undefined; let active = false;
    try {
      await owner`begin`; active = true; await owner`select id from sessions where id=${f.sid} for update`;
      pending = change(f.token);
      const deadline = Date.now() + 10_000;
      let observed = false;
      while (Date.now() < deadline) {
        const [waiting] = await sqlClient`select count(*)::int n from pg_stat_activity where usename='predioon_identity' and wait_event_type='Lock' and query like '%identity_replace_password%'`;
        if (waiting!.n > 0) { observed = true; break; } await setTimeout(20);
      }
      assert.equal(observed, true, "password helper must reach an observed family lock");
      await owner`update sessions set revoked_at=clock_timestamp(),revoked_reason='LOGOUT' where id=${f.sid}`;
      await owner`commit`; active = false;
      assert.equal((await pending).status, 401); assert.equal((await stored(f.id)).hash, f.hash);
    } finally { if (active) await owner`rollback`; owner.release(); await pending?.then(response => response.body?.cancel()); }
  }));

  it("uses database time after a refresh-generation lock wait without rotating an expired family", async () => fixture(async f => {
    const owner = await sqlClient.reserve(); let pending: Promise<Response> | undefined; let active = false;
    try {
      await sqlClient`update sessions set expires_at=clock_timestamp()+interval '1 second' where id=${f.sid}`;
      const [generation] = await sqlClient`select id from refresh_tokens where session_id=${f.sid} and revoked_at is null`;
      await owner`begin`; active = true; await owner`select id from refresh_tokens where id=${generation!.id} for update`;
      pending = call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: f.refresh } });
      const deadline = Date.now() + 10_000; let observed = false;
      while (Date.now() < deadline) {
        const [waiting] = await sqlClient`select count(*)::int n from pg_stat_activity where usename='predioon_identity' and wait_event_type='Lock' and query like '%refresh_tokens%'`;
        if (waiting!.n > 0) { observed = true; break; } await setTimeout(20);
      }
      assert.equal(observed, true, "refresh must reach an observed generation row lock");
      await setTimeout(1100);
      await owner`commit`; active = false;
      assert.equal((await pending).status, 401);
      const [count] = await sqlClient`select count(*)::int n from refresh_tokens where session_id=${f.sid}`;
      assert.equal(count!.n, 1);
    } finally { if (active) await owner`rollback`; owner.release(); await pending?.then(response => response.body?.cancel()); }
  }));

  for (const table of ["refresh_tokens", "sessions"]) for (const mode of ["skip", "rewrite"]) it(`rolls back rotation when ${table} update has ${mode} behavior`, async t => {
    const errors: unknown[][] = [], log = t.mock.method(console, "error", (...values: unknown[]) => { errors.push(values); });
    try {
      await fixture(async f => {
        const suffix = randomUUID().replaceAll("-", ""), fn = `test_rotation_failure_${suffix}`, trigger = `test_rotation_trigger_${suffix}`;
        const behavior = mode === "skip" ? "return null;" : table === "refresh_tokens"
          ? "NEW.revoked_at:=OLD.revoked_at; NEW.replaced_by_hash:=OLD.replaced_by_hash;" : "NEW.last_used_at:=OLD.last_used_at;";
        await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin
          if NEW.user_id=TG_ARGV[0] then ${behavior} end if; return NEW; end $$`);
        let installed = false;
        const snapshot = async () => ({ family: await sqlClient`select * from sessions where id=${f.sid}`, generations: await sqlClient`select * from refresh_tokens where session_id=${f.sid} order by id` });
        try {
          const [definition] = await sqlClient`select format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.%I(%L)',${trigger}::text,${table}::text,${fn}::text,${f.id}::text) ddl`;
          await sqlClient.unsafe(definition!.ddl as string); installed = true;
          const before = await snapshot();
          const response = await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: f.refresh } });
          assert.equal(response.status, 503); assert.deepEqual(await snapshot(), before);
          assert.equal(response.headers.get("set-cookie"), null);
          assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
          await sqlClient.unsafe(`drop trigger ${trigger} on ${table}`); installed = false;
          assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: f.refresh } })).status, 200, "the original generation remains recoverable after the rollback");
        } finally {
          if (installed) await sqlClient.unsafe(`drop trigger ${trigger} on ${table}`);
          await sqlClient.unsafe(`drop function public.${fn}()`);
        }
      });
      assert.deepEqual(errors, [], "failed rotation must not log token hashes or persistence parameters");
    } finally { log.mock.restore(); }
  });

  for (const operation of ["logout", "own", "all"]) for (const mode of ["skip", "rewrite"]) it(`refuses false ${operation} revocation success with ${mode} behavior`, async () => fixture(async f => {
    await login(server.url, f.email, currentPassword);
    const suffix = randomUUID().replaceAll("-", ""), fn = `test_revoke_failure_${suffix}`, trigger = `test_revoke_trigger_${suffix}`;
    await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin
      if NEW.user_id=TG_ARGV[0] then ${mode === "skip" ? "return null;" : "NEW.revoked_at:=NULL;"} end if; return NEW; end $$`);
    let installed = false;
    const request = () => operation === "logout" ? call(server.url, "/auth/logout", { method: "POST", body: { refreshToken: f.refresh } })
      : operation === "own" ? call(server.url, `/auth/sessions/${f.sid}`, { method: "DELETE", token: f.token })
        : call(server.url, "/auth/sessions/revoke-all", { method: "POST", token: f.token });
    try {
      const [definition] = await sqlClient`select format('CREATE TRIGGER %I BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.%I(%L)',${trigger}::text,${fn}::text,${f.id}::text) ddl`;
      await sqlClient.unsafe(definition!.ddl as string); installed = true;
      const before = await stored(f.id);
      assert.equal((await request()).status, 503); assert.deepEqual(await stored(f.id), before);
      assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
      await sqlClient.unsafe(`drop trigger ${trigger} on sessions`); installed = false;
      assert.equal((await request()).status, 204);
    } finally { if (installed) await sqlClient.unsafe(`drop trigger ${trigger} on sessions`); await sqlClient.unsafe(`drop function public.${fn}()`); }
  }));

  it("reapplication removes accidental helper grants without granting direct account writes", async () => {
    await sqlClient`grant execute on function public.identity_replace_password(text,uuid,text,text) to PUBLIC,predioon_app,predioon_broker_auth`;
    const migration = await readFile(new URL("../../../infrastructure/037-password-change.sql", import.meta.url), "utf8");
    await sqlClient.begin(tx => tx.unsafe(migration));
    const [permissions] = await sqlClient`select has_function_privilege('predioon_app','public.identity_replace_password(text,uuid,text,text)','EXECUTE') app,
      has_function_privilege('predioon_broker_auth','public.identity_replace_password(text,uuid,text,text)','EXECUTE') broker,
      has_function_privilege('predioon_identity','public.identity_replace_password(text,uuid,text,text)','EXECUTE') identity,
      has_table_privilege('predioon_identity','users','UPDATE') account_write`;
    assert.deepEqual(permissions, { app: false, broker: false, identity: true, account_write: false });
    const [publicAcl] = await sqlClient`select count(*)::int n from pg_proc p cross join lateral aclexplode(p.proacl) acl where p.oid='public.identity_replace_password(text,uuid,text,text)'::regprocedure and acl.grantee=0`;
    assert.equal(publicAcl!.n, 0);
  });

  it("refuses an unavailable budget without exposing hashes or revoking the authenticated family", async t => fixture(async f => {
    const errors: unknown[][] = [], log = t.mock.method(console, "error", (...values: unknown[]) => { errors.push(values); });
    await sqlClient`revoke execute on function public.identity_take_login_budget(bytea,bytea) from predioon_identity`;
    try {
      const response = await change(f.token); assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Entrada temporariamente indisponível. Tente novamente em instantes." });
      assert.equal((await stored(f.id)).hash, f.hash); assert.equal((await call(server.url, "/auth/me", { token: f.token })).status, 200);
      assert.deepEqual(errors, []);
    } finally { await sqlClient`grant execute on function public.identity_take_login_budget(bytea,bytea) to predioon_identity`; log.mock.restore(); }
  }));

  it("the helper rejects a foreign family, an obsolete hash, and inactive account without partial writes", async () => fixture(async f => {
    const other = await login(server.url, "admin@predioon.local"), replacementHash = await hashPassword(nextPassword);
    const before = await stored(f.id);
    for (const [sid, observed] of [[decodeJwt(other.accessToken).sid as string, f.hash], [f.sid, "obsolete-hash"]]) {
      const [result] = await identitySqlClient`select public.identity_replace_password(${f.id},${sid!}::uuid,${observed!},${replacementHash}) changed`;
      assert.equal(result!.changed, false); assert.deepEqual(await stored(f.id), before);
    }
    await sqlClient`update users set active=false where id=${f.id}`;
    const [result] = await identitySqlClient`select public.identity_replace_password(${f.id},${f.sid}::uuid,${f.hash},${replacementHash}) changed`;
    assert.equal(result!.changed, false); assert.deepEqual(await stored(f.id), before);
  }));

  it("keeps users UPDATE private and exposes only the fixed helper to the identity authority", async () => {
    const [permission] = await sqlClient`select has_table_privilege('predioon_identity','users','UPDATE') allowed`;
    assert.equal(permission!.allowed, false);
    await assert.rejects(() => identitySqlClient`update users set password_hash='not-a-hash' where id='admin_demo'`, (error: unknown) => (error as { code?: string }).code === "42501");
    const helpers = await sqlClient`select p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
      has_function_privilege('predioon_identity',p.oid,'EXECUTE') identity,
      has_function_privilege('predioon_app',p.oid,'EXECUTE') app,
      has_function_privilege('predioon_broker_auth',p.oid,'EXECUTE') broker
      from pg_proc p where p.oid='public.identity_replace_password(text,uuid,text,text)'::regprocedure`;
    assert.equal(helpers.length, 1); assert.equal(helpers[0]!.prosecdef, true);
    assert.deepEqual(helpers[0]!.proconfig, ["search_path=public, pg_temp"]);
    assert.equal(helpers[0]!.identity, true); assert.equal(helpers[0]!.app, false); assert.equal(helpers[0]!.broker, false);
    const [existingOwner] = await sqlClient`select pg_get_userbyid(proowner) owner from pg_proc where oid='public.identity_lock_account_active(text)'::regprocedure`;
    assert.equal(helpers[0]!.owner, existingOwner!.owner);
  });
});
