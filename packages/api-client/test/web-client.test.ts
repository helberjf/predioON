import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiError, createWebApiClient } from "../src/index.ts";
import { createWebSessionCoordinator, webSessionNamespace } from "../../ui/src/web-session-coordinator.ts";

const user = (id: string) => ({ id, name: id, email: `${id}@example.test`, role: "RESIDENT" as const, memberships: [] });
const session = (id: string, revision = 0) => ({ user: user(id), accessToken: `${id}:${revision}` });
const expired = () => Response.json({ error: "Expirado" }, { status: 401 });
const changed = (error: unknown) => error instanceof ApiError && error.code === "SESSION_CHANGED";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function world() {
  const values = new Map<string, string>();
  const listeners = new Map<number, () => void>();
  let sequence = 0, queue: Promise<unknown> = Promise.resolve(), cookie: string | null = null, revision = 0;
  let notifications = true, offline = false, active = 0, peak = 0;
  let failActivation = false;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  let intercept: ((path: string, init: RequestInit) => Promise<Response | null>) | null = null;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, init });
    if (offline) throw new TypeError("offline");
    const custom = await intercept?.(path, init);
    if (custom) return custom;
    if (path.startsWith("/auth/web/")) {
      active++; peak = Math.max(peak, active);
      await tick();
      active--;
      if (path.endsWith("/logout")) { cookie = null; return new Response(null, { status: 204 }); }
      if (path.endsWith("/login")) {
        const body = JSON.parse(String(init.body));
        if (body.password === "invalid") return expired();
        cookie = body.email; revision++;
        return Response.json(session(cookie!, revision));
      }
      if (!cookie) return expired();
      revision++;
      return Response.json(session(cookie, revision));
    }
    const token = new Headers(init.headers).get("Authorization");
    return cookie && token === `Bearer ${cookie}:${revision}` ? Response.json({ owner: cookie }) : expired();
  };
  function tab(namespace = "portal", supported = true, authTimeoutMs = 1000) {
    const id = ++sequence;
    const coordinator = createWebSessionCoordinator({
      namespace,
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
        if (failActivation && JSON.parse(value).blocked === false) throw new Error("Storage unavailable");
        values.set(key, value);
      }, removeItem: key => { values.delete(key); } },
      locks: supported ? { request: <T>(_key: string, run: () => Promise<T>): Promise<T> => {
        const pending = queue.then(run); queue = pending.catch(() => undefined); return pending;
      } } : undefined,
      newId: () => `${id}-${++sequence}`,
      subscribe: listener => { listeners.set(id, listener); return () => { listeners.delete(id); }; },
      publish: () => { if (notifications) queueMicrotask(() => { for (const [other, listener] of listeners) if (other !== id) listener(); }); },
    });
    let lost = 0, available = 0;
    const api = createWebApiClient({ baseUrl: "https://api.example.test", fetch: fetcher, coordinator, authTimeoutMs,
      onAuthLost: () => { lost++; }, onSessionAvailable: () => { available++; } });
    return { api, state: () => ({ lost, available }), close() { api.dispose(); coordinator.dispose(); } };
  }
  return { tab, calls, values, peak: () => peak, cookie: () => cookie, revision: () => revision,
    offline(value: boolean) { offline = value; }, notifications(value: boolean) { notifications = value; },
    failActivation(value: boolean) { failActivation = value; },
    intercept(value: typeof intercept) { intercept = value; }, setCookie(value: string) { cookie = value; revision++; },
  };
}

it("web login revokes previous cookie, keeps access only in memory and scopes credentials/CSRF headers to web auth", async () => {
  const fixture = world();
  fixture.values.set("predioon.access", "legacy-access"); fixture.values.set("predioon.refresh", "legacy-refresh");
  const tab = fixture.tab();
  assert.equal((await tab.api.login("new", "password")).user.id, "new");
  assert.deepEqual(await tab.api.get("/private"), { owner: "new" });
  assert.deepEqual(fixture.calls.map(call => call.path), ["/auth/web/logout", "/auth/web/login", "/private"]);
  for (const call of fixture.calls.slice(0, 2)) {
    assert.equal(call.init.credentials, "include"); assert.equal(call.init.redirect, "error");
    assert.equal(new Headers(call.init.headers).get("X-Predioon-Web"), "1");
    assert.equal(new Headers(call.init.headers).get("Authorization"), null);
  }
  assert.equal(fixture.calls[2]!.init.credentials, "omit");
  assert.equal(new Headers(fixture.calls[2]!.init.headers).get("X-Predioon-Web"), null);
  assert.ok(tab.api.accessToken());
  assert.equal(fixture.values.size, 1);
  assert.deepEqual(Object.keys(JSON.parse([...fixture.values.values()][0]!)).sort(), ["blocked", "epoch"]);
  tab.close();
});

it("reload restores identity solely through the HttpOnly cookie and serializes two tabs' rotations", async () => {
  const fixture = world(), first = fixture.tab();
  await first.api.login("resident", "password"); first.close();
  const a = fixture.tab(), b = fixture.tab();
  assert.equal(a.api.accessToken(), null);
  const sessions = await Promise.all([a.api.restore(), b.api.restore()]);
  assert.deepEqual(sessions.map(value => value?.user.id), ["resident", "resident"]);
  assert.equal(fixture.peak(), 1);
  assert.equal(fixture.calls.filter(call => call.path === "/auth/web/refresh").length, 2);
  a.close(); b.close();
});

it("shares refresh for concurrent 401s and does not rotate twice for a late 401", async () => {
  const fixture = world(), tab = fixture.tab();
  await tab.api.login("resident", "password"); fixture.setCookie("resident");
  const delayed = deferred<Response>(), began = deferred<void>();
  fixture.intercept(async path => { if (path === "/late") { began.resolve(); return delayed.promise; } return null; });
  const late = tab.api.get("/late"); await began.promise;
  const results = await Promise.all([tab.api.get("/one"), tab.api.get("/two")]);
  assert.deepEqual(results, [{ owner: "resident" }, { owner: "resident" }]);
  fixture.intercept(null); delayed.resolve(expired());
  assert.deepEqual(await late, { owner: "resident" });
  assert.equal(fixture.calls.filter(call => call.path === "/auth/web/refresh").length, 1);
  tab.close();
});

it("logout invalidates another tab immediately and a suspended tab checks the persisted epoch before sending", async () => {
  const fixture = world(), a = fixture.tab(), b = fixture.tab();
  await a.api.login("old", "password"); await b.api.restore();
  fixture.notifications(false);
  await a.api.logout();
  const count = fixture.calls.length;
  await assert.rejects(b.api.post("/private", { unsafe: true }), changed);
  assert.equal(fixture.calls.length, count);
  assert.equal(b.api.accessToken(), null);
  assert.equal(await b.api.restore(), null);
  a.close(); b.close();
});

it("an in-flight old login cannot resurrect identity after queued logout", async () => {
  const fixture = world(), a = fixture.tab(), b = fixture.tab();
  const delayed = deferred<Response>(), began = deferred<void>();
  fixture.intercept(async path => { if (path === "/auth/web/login") { began.resolve(); return delayed.promise; } return null; });
  const login = assert.rejects(a.api.login("old", "password"), changed);
  await began.promise;
  const logout = b.api.logout();
  delayed.resolve(Response.json(session("old"))); await login; await logout;
  assert.equal(a.api.accessToken(), null); assert.equal(b.api.accessToken(), null);
  assert.equal(await a.api.restore(), null); assert.equal(fixture.cookie(), null);
  a.close(); b.close();
});

it("a newer login wins over an older queued logout without a late cookie clear", async () => {
  const fixture = world(), a = fixture.tab(), b = fixture.tab();
  await a.api.login("old", "password"); await b.api.restore();
  const delayed = deferred<Response>(), began = deferred<void>(); let once = true;
  fixture.intercept(async path => { if (path === "/auth/web/logout" && once) { once = false; began.resolve(); return delayed.promise; } return null; });
  const logout = assert.rejects(a.api.logout(), changed); await began.promise;
  const login = b.api.login("new", "password");
  delayed.resolve(new Response(null, { status: 204 })); await logout;
  assert.equal((await login).user.id, "new");
  assert.equal(fixture.cookie(), "new");
  assert.deepEqual(await b.api.get("/private"), { owner: "new" });
  a.close(); b.close();
});

it("offline logout keeps a tombstone across reload and an explicit login requires successful old-cookie revocation", async () => {
  const fixture = world(), a = fixture.tab();
  await a.api.login("old", "password"); fixture.offline(true);
  await assert.rejects(a.api.logout(), (error: unknown) => error instanceof ApiError && error.code === "NETWORK_ERROR");
  assert.equal(a.api.accessToken(), null); a.close();
  const b = fixture.tab(), count = fixture.calls.length;
  assert.equal(await b.api.restore(), null); assert.equal(fixture.calls.length, count);
  await assert.rejects(b.api.login("new", "password"), /Não foi possível/);
  assert.equal(fixture.calls.at(-1)?.path, "/auth/web/logout");
  assert.equal(fixture.cookie(), "old");
  fixture.offline(false);
  assert.equal((await b.api.login("new", "password")).user.id, "new");
  b.close();
});

it("a rejected login cannot recover the previous account's cookie on reload", async () => {
  const fixture = world(), a = fixture.tab();
  await a.api.login("old", "password");
  await assert.rejects(a.api.login("new", "invalid"), error => error instanceof ApiError && error.status === 401);
  assert.equal(fixture.cookie(), null); a.close();
  const b = fixture.tab(); assert.equal(await b.api.restore(), null); b.close();
});

it("transient restore errors preserve cookie recovery, whereas rejected refresh clears all tabs", async () => {
  const fixture = world(), a = fixture.tab();
  await a.api.login("old", "password"); a.close();
  const b = fixture.tab(); fixture.offline(true);
  await assert.rejects(b.api.restore(), /Não foi possível/);
  assert.equal(fixture.cookie(), "old"); fixture.offline(false);
  assert.equal((await b.api.restore())?.user.id, "old");
  const c = fixture.tab(); await c.api.restore();
  fixture.intercept(async path => path === "/auth/web/refresh" ? expired() : null);
  await assert.rejects(b.api.restore(), error => error instanceof ApiError && error.status === 401);
  await tick(); assert.equal(c.api.accessToken(), null); assert.equal(await c.api.restore(), null);
  b.close(); c.close();
});

it("missing Web Locks fails closed with an actionable error and makes no network request", async () => {
  const fixture = world(), tab = fixture.tab("portal", false);
  await assert.rejects(tab.api.login("user", "password"), error => error instanceof ApiError && error.code === "BROWSER_UNSUPPORTED");
  await assert.rejects(tab.api.restore(), /bloqueios entre abas/);
  assert.equal(fixture.calls.length, 0); tab.close();
});

it("stalled auth headers or body abort, release the lock and cannot restore a late session", async () => {
  for (const stage of ["headers", "body"] as const) {
    const fixture = world(), a = fixture.tab("portal", true, 100), b = fixture.tab();
    const delayed = deferred<Response>(), body = deferred<unknown>(), began = deferred<void>();
    let authSignal: AbortSignal | undefined;
    fixture.intercept(async (path, init) => {
      if (path !== "/auth/web/login") return null;
      authSignal = init.signal ?? undefined; began.resolve();
      return stage === "headers" ? delayed.promise : { ok: true, status: 200, json: () => body.promise } as Response;
    });
    const failed = assert.rejects(a.api.login("old", "password"), error => error instanceof ApiError && error.code === "NETWORK_ERROR");
    await began.promise; await failed;
    assert.equal(authSignal?.aborted, true);
    fixture.intercept(null);
    await b.api.login("new", "password");
    delayed.resolve(Response.json(session("old"))); body.resolve(session("old")); await tick();
    assert.equal(a.api.accessToken(), null);
    assert.match(b.api.accessToken()!, /^new:/);
    assert.equal(fixture.cookie(), "new"); a.close(); b.close();
  }
});

it("SSE memory access fails safely after missed epoch notifications or absent browser support", async () => {
  const fixture = world(), a = fixture.tab(), b = fixture.tab();
  await a.api.login("old", "password"); await b.api.restore(); fixture.notifications(false);
  await a.api.logout();
  assert.equal(b.api.accessToken(), null);
  assert.ok(b.state().lost > 0);
  const unsupported = fixture.tab("unsupported", false);
  assert.equal(unsupported.api.accessToken(), null);
  a.close(); b.close(); unsupported.close();
});

it("equivalent API URLs use the same portal lock and metadata namespace", () => {
  assert.equal(webSessionNamespace("https://portal.example.test", "https://API.example.test:443/"),
    webSessionNamespace("https://portal.example.test", "https://api.example.test/path"));
  assert.notEqual(webSessionNamespace("https://other.example.test", "https://api.example.test"),
    webSessionNamespace("https://portal.example.test", "https://api.example.test"));
});

it("failed metadata activation cannot leave usable access credentials after a rejected login", async () => {
  const fixture = world(), tab = fixture.tab(); fixture.failActivation(true);
  await assert.rejects(tab.api.login("new", "password"), error => error instanceof ApiError && error.code === "BROWSER_UNSUPPORTED");
  assert.equal(tab.api.accessToken(), null);
  assert.equal(await tab.api.restore(), null);
  fixture.failActivation(false);
  assert.equal((await tab.api.login("recovered", "password")).user.id, "recovered");
  tab.close();
});

it("cleanup from an old failed login cannot invalidate a newer login in the same tab", async () => {
  const fixture = world(), tab = fixture.tab();
  const delayed = deferred<Response>(), began = deferred<void>(); let first = true;
  fixture.intercept(async path => {
    if (path !== "/auth/web/login" || !first) return null;
    first = false; began.resolve(); return delayed.promise;
  });
  const old = assert.rejects(tab.api.login("old", "password"), changed); await began.promise;
  const next = tab.api.login("new", "password");
  delayed.resolve(Response.json(session("old"))); await old;
  assert.equal((await next).user.id, "new");
  assert.deepEqual(await tab.api.get("/private"), { owner: "new" });
  tab.close();
});

it("different API/portal namespaces do not invalidate each other's memory sessions", async () => {
  const fixture = world(), a = fixture.tab("portal-a"), b = fixture.tab("portal-b");
  await a.api.login("a", "password"); await b.api.login("b", "password");
  assert.match(a.api.accessToken()!, /^a:/);
  await b.api.logout(); await tick();
  assert.match(a.api.accessToken()!, /^a:/);
  a.close(); b.close();
});
