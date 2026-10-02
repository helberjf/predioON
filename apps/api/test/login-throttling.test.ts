import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { sqlClient } from "@predioon/db";
import { config } from "../src/config.js";
import { loginBudgetKeys } from "../src/auth/login-budget-keys.js";
import { hashPassword } from "../src/auth/passwords.js";
import { startTestServer } from "./helpers.js";

const secret = process.env.AUTH_RATE_LIMIT_KEY ?? "predioon-local-only-login-budget-key-do-not-use-in-production";
const password = " Literal Password 123! ";
after(async () => { await sqlClient.end(); });

async function fixture(run: (f: { email: string; userId: string; url: string; network: Buffer; account: Buffer }) => Promise<void>) {
  const id = randomUUID(), email = `budget-${id}@example.invalid`, userId = `budget-${id}`;
  const keys = loginBudgetKeys(secret, email, "127.0.0.1");
  const server = await startTestServer();
  try {
    await sqlClient`delete from auth_login_buckets where scope='network' and key_hash=${keys.network}`;
    await sqlClient`insert into users(id,name,email,password_hash) values(${userId},'Budget fixture',${email},${await hashPassword(password)})`;
    await run({ email, userId, url: server.url, ...keys });
  } finally {
    await server.close();
    await sqlClient`delete from users where id=${userId}`;
    await sqlClient`delete from auth_login_buckets where key_hash in ${sqlClient([keys.network, keys.account])}`;
  }
}

async function exhaust(scope: string, key: Buffer) {
  await sqlClient`insert into auth_login_buckets(scope,key_hash,tokens,updated_at,expires_at)
    values(${scope},${key},0,clock_timestamp(),clock_timestamp()+interval '30 minutes')
    on conflict(scope,key_hash) do update set tokens=0,updated_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 minutes'`;
}
async function send(url: string, email: string, options: { web?: boolean; headers?: Record<string,string>; password?: string; raw?: string } = {}) {
  return fetch(`${url}/auth/${options.web ? "web/" : ""}login`, {
    method: "POST", headers: { "content-type": "application/json", ...(options.web ? { origin: config.corsOrigins[0]!, "x-predioon-web": "1" } : {}), ...options.headers },
    body: options.raw ?? JSON.stringify({ email, password: options.password ?? password }),
  });
}

test("native and web logins share account admission and never issue tokens after rejection", async () => fixture(async f => {
  await exhaust("account", f.account);
  for (const web of [false, true]) {
    const response = await send(f.url, f.email.toUpperCase(), { web });
    assert.equal(response.status, 429);
    assert.match(response.headers.get("retry-after") ?? "", /^[1-9][0-9]*$/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { error: "Muitas tentativas de entrada. Aguarde e tente novamente." });
  }
  const [sessions] = await sqlClient`select count(*)::int as count from sessions where user_id=${f.userId}`;
  assert.equal(sessions!.count, 0);
  const [network] = await sqlClient`select tokens from auth_login_buckets where scope='network' and key_hash=${f.network}`;
  assert.ok(Number(network!.tokens) < 299.9, "account denial still consumes network capacity");
}));

test("unknown and inactive accounts receive the same throttle response without account disclosure", async () => fixture(async f => {
  const unknown = `unknown-${randomUUID()}@example.invalid`, key = loginBudgetKeys(secret, unknown, "127.0.0.1").account;
  try {
    await sqlClient`update users set active=false where id=${f.userId}`;
    await exhaust("account", f.account); await exhaust("account", key);
    const known = await send(f.url, f.email), absent = await send(f.url, unknown);
    assert.equal(known.status, 429); assert.equal(absent.status, 429);
    assert.deepEqual(await known.json(), await absent.json());
  } finally { await sqlClient`delete from auth_login_buckets where key_hash=${key}`; }
}));

test("an untrusted forwarded address cannot evade the socket network budget", async () => fixture(async f => {
  await exhaust("network", f.network);
  const response = await send(f.url, f.email, { headers: { "x-forwarded-for": "203.0.113.8", forwarded: "for=198.51.100.8", "x-real-ip": "192.0.2.8" } });
  assert.equal(response.status, 429);
  const [account] = await sqlClient`select count(*)::int as count from auth_login_buckets where scope='account' and key_hash=${f.account}`;
  assert.equal(account!.count, 0, "a rejected network does not create account buckets");
}));

test("budget recovery admits the exact password and success does not reset consumption", async () => fixture(async f => {
  await exhaust("account", f.account);
  await sqlClient`update auth_login_buckets set updated_at=clock_timestamp()-interval '46 seconds' where scope='account' and key_hash=${f.account}`;
  const admitted = await send(f.url, f.email, { web: true });
  assert.equal(admitted.status, 200); assert.ok(admitted.headers.get("set-cookie"));
  const body = await admitted.json() as Record<string,unknown>;
  assert.equal(typeof body.accessToken, "string"); assert.equal(body.refreshToken, undefined);
  assert.equal((await send(f.url, f.email)).status, 429);
  const [sessions] = await sqlClient`select count(*)::int as count from sessions where user_id=${f.userId}`;
  assert.equal(sessions!.count, 1);
}));

test("a fresh API process observes the restriction and recovery persisted by another process", async () => fixture(async f => {
  await exhaust("account", f.account);
  const child = async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "test/fixtures/login-budget-process.mts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, TEST_LOGIN_BUDGET_EMAIL: f.email }, windowsHide: true, timeout: 15_000,
    });
    return JSON.parse(stdout) as { retryAfter: number };
  };
  assert.ok((await child()).retryAfter > 0);
  await sqlClient`update auth_login_buckets set updated_at=clock_timestamp()-interval '46 seconds' where scope='account' and key_hash=${f.account}`;
  assert.equal((await child()).retryAfter, 0);
  assert.equal((await send(f.url, f.email)).status, 429, "the child committed its consumption before exiting");
}));

test("CSRF and bounded JSON validation run before consuming login capacity", async () => fixture(async f => {
  const crossSite = await send(f.url, f.email, { web: true, headers: { origin: "https://untrusted.invalid" } });
  assert.equal(crossSite.status, 403);
  for (const web of [false, true]) {
    assert.equal((await send(f.url, f.email, { web, password: "a".repeat(1025) })).status, 400);
    assert.equal((await send(f.url, f.email, { web, password: "\u00e9".repeat(513) })).status, 400);
    assert.equal((await send(f.url, f.email, { web, raw: '{"password":"' + "x".repeat(9_000) + '"}' })).status, 413);
    assert.equal((await send(f.url, f.email, { web, raw: '{"password":"private' })).status, 400);
  }
  const [buckets] = await sqlClient`select count(*)::int as count from auth_login_buckets where key_hash in ${sqlClient([f.network, f.account])}`;
  assert.equal(buckets!.count, 0);
}));

test("unavailable budget storage fails closed with a generic response and no credential logs", async t => fixture(async f => {
  const errors: unknown[][] = [];
  const log = t.mock.method(console, "error", (...values: unknown[]) => { errors.push(values); });
  await sqlClient`revoke execute on function public.identity_take_login_budget(bytea,bytea) from predioon_identity`;
  try {
    for (const web of [false, true]) {
      const response = await send(f.url, f.email, { web });
      assert.equal(response.status, 503); assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(await response.json(), { error: "Entrada temporariamente indisponível. Tente novamente em instantes." });
    }
    const [sessions] = await sqlClient`select count(*)::int as count from sessions where user_id=${f.userId}`;
    assert.equal(sessions!.count, 0); assert.deepEqual(errors, []);
  } finally {
    await sqlClient`grant execute on function public.identity_take_login_budget(bytea,bytea) to predioon_identity`;
    log.mock.restore();
  }
}));
