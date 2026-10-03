import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiError, createApiClient, createWebApiClient } from "../src/index.ts";
import { createWebSessionCoordinator } from "../../ui/src/web-session-coordinator.ts";

const credentials = { accessToken: "old-access", refreshToken: "old-refresh" };
const user = { id: "new", name: "New", email: "new@example.test", role: "RESIDENT" as const, memberships: [] };
const body = { currentPassword: " Current literal password ", newPassword: " New literal password " };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function storage() {
  let value: typeof credentials | null = { ...credentials };
  return { getTokens: async () => value, setTokens: async (tokens: typeof credentials) => { value = tokens; }, clearTokens: async () => { value = null; } };
}

it("native password replacement sends exact confirmation and clears credentials only after confirmed204", async () => {
  const saved = storage(), sent = deferred<void>(), response = deferred<Response>(); let lost = 0;
  const api = createApiClient({ baseUrl: "https://api.example.test", storage: saved, onAuthLost: () => { lost++; }, fetch: async (url, init) => {
    assert.equal(String(url), "https://api.example.test/auth/password");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer old-access");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    sent.resolve(); return response.promise;
  } });
  const pending = api.changePassword(body); await sent.promise;
  assert.deepEqual(await saved.getTokens(), credentials); assert.equal(lost, 0);
  response.resolve(new Response(null, { status: 204 })); await pending;
  assert.equal(await saved.getTokens(), null); assert.equal(lost, 1);
});

it("incorrect confirmation, throttling, service errors, offline delivery and unexpected success preserve credentials", async () => {
  for (const status of [400, 429, 503, 200, 0]) {
    const saved = storage(); let lost = 0;
    const api = createApiClient({ baseUrl: "https://api.example.test", storage: saved, onAuthLost: () => { lost++; }, fetch: async () => {
      if (!status) throw new TypeError("offline");
      return Response.json({ error: "Rejected" }, { status });
    } });
    await assert.rejects(api.changePassword(body), ApiError);
    assert.deepEqual(await saved.getTokens(), credentials); assert.equal(lost, 0);
  }
});

it("a delayed change for accountA cannot clear a newer accountB or deliver old private responses", async () => {
  const saved = storage(), sent = deferred<void>(), response = deferred<Response>(); let lost = 0;
  const api = createApiClient({ baseUrl: "https://api.example.test", storage: saved, onAuthLost: () => { lost++; }, fetch: async (url) => {
    if (String(url).endsWith("/auth/password")) { sent.resolve(); return response.promise; }
    return Response.json({ accessToken: "new-access", refreshToken: "new-refresh", user });
  } });
  const pending = assert.rejects(api.changePassword(body), (error: unknown) => error instanceof ApiError && error.code === "SESSION_CHANGED");
  await sent.promise; await api.login(user.email, "new-password");
  response.resolve(new Response(null, { status: 204 })); await pending;
  assert.deepEqual(await saved.getTokens(), { accessToken: "new-access", refreshToken: "new-refresh" }); assert.equal(lost, 0);
});

it("password replacement renews an expired access token once and sends the mutation with the new bearer", async () => {
  const saved = storage(); const calls: string[] = []; let attempted = 0;
  const api = createApiClient({ baseUrl: "https://api.example.test", storage: saved, fetch: async (url, init) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path === "/auth/refresh") return Response.json({ accessToken: "renewed-access", refreshToken: "renewed-refresh", user });
    if (!attempted++) return Response.json({ error: "Expired" }, { status: 401 });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer renewed-access");
    return new Response(null, { status: 204 });
  } });
  await api.changePassword(body);
  assert.deepEqual(calls, ["/auth/password", "/auth/refresh", "/auth/password"]); assert.equal(await saved.getTokens(), null);
});

it("a private response sent before confirmed replacement cannot deliver data after session invalidation", async () => {
  const saved = storage(), sent = deferred<void>(), response = deferred<Response>();
  const api = createApiClient({ baseUrl: "https://api.example.test", storage: saved, fetch: async url => {
    if (String(url).endsWith("/private")) { sent.resolve(); return response.promise; }
    return new Response(null, { status: 204 });
  } });
  const privateRequest = assert.rejects(api.get("/private"), (error: unknown) => error instanceof ApiError && error.code === "SESSION_CHANGED");
  await sent.promise; await api.changePassword(body);
  response.resolve(Response.json({ private: "old-account" })); await privateRequest;
  assert.equal(await saved.getTokens(), null);
});

it("confirmed replacement closes the local identity even if secure-storage deletion fails, without retrying the password", async () => {
  let saved: typeof credentials | null = { ...credentials }, lost = 0;
  const sent: Array<{ path: string; bearer: string | null }> = [];
  const api = createApiClient({ baseUrl: "https://api.example.test", onAuthLost: () => { lost++; }, storage: {
    getTokens: async () => saved, setTokens: async value => { saved = value; }, clearTokens: async () => { throw new Error("Secure store unavailable"); },
  }, fetch: async (url, init) => {
    const path = new URL(String(url)).pathname;
    sent.push({ path, bearer: new Headers(init?.headers).get("Authorization") });
    return path === "/auth/password" ? new Response(null, { status: 204 }) : Response.json({ public: true });
  } });
  let failure: unknown;
  try { await api.changePassword(body); } catch (error) { failure = error; }
  await api.get("/public");
  assert.equal(failure, undefined, "the server already confirmed replacement; an IO failure must not encourage another password submission");
  assert.equal(lost, 1); assert.equal(sent.filter(call => call.path === "/auth/password").length, 1);
  assert.equal(sent.at(-1)!.bearer, null, "revoked credentials retained by a broken store must be blocked locally");
  assert.deepEqual(saved, credentials, "the injected store really refused deletion");
});

it("a failed deletion for confirmed accountA cannot clear accountB or invoke its identity-loss callback", async () => {
  let saved: typeof credentials | null = { ...credentials }, clears = 0, lost = 0;
  const clearing = deferred<void>(); let failDeletion!: (error: Error) => void;
  const deletion = new Promise<void>((_resolve, reject) => { failDeletion = reject; });
  const api = createApiClient({ baseUrl: "https://api.example.test", onAuthLost: () => { lost++; }, storage: {
    getTokens: async () => saved, setTokens: async value => { saved = value; }, clearTokens: async () => {
      if (!clears++) { clearing.resolve(); await deletion; } else saved = null;
    },
  }, fetch: async url => String(url).endsWith("/auth/password") ? new Response(null, { status: 204 })
    : Response.json({ accessToken: "new-access", refreshToken: "new-refresh", user }),
  });
  const changing = assert.rejects(api.changePassword(body), (error: unknown) => error instanceof ApiError && error.code === "SESSION_CHANGED");
  await clearing.promise;
  const signingIn = api.login(user.email, "password"); failDeletion(new Error("Secure store unavailable"));
  await changing; await signingIn;
  assert.deepEqual(saved, { accessToken: "new-access", refreshToken: "new-refresh" }); assert.equal(lost, 0);
});

it("web password replacement uses cookie/CSRF protocol under the common lock and blocks session restoration after success", async () => {
  const values = new Map<string, string>(); let queue: Promise<unknown> = Promise.resolve(); let lost = 0;
  const coordinator = createWebSessionCoordinator({ namespace: "password-fixture", storage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
  }, locks: { request<T>(_name: string, run: () => Promise<T>) { const pending = queue.then(run); queue = pending.catch(() => undefined); return pending; } },
    newId: () => String(values.size + 1), subscribe: () => () => {}, publish: () => {},
  });
  const calls: string[] = [];
  const api = createWebApiClient({ baseUrl: "https://api.example.test", coordinator, onAuthLost: () => { lost++; }, fetch: async (url, init) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path === "/auth/web/password") {
      assert.equal(init?.credentials, "include"); assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("X-Predioon-Web"), "1");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer web-access");
      assert.deepEqual(JSON.parse(String(init?.body)), body); return new Response(null, { status: 204 });
    }
    if (path === "/auth/web/logout") return new Response(null, { status: 204 });
    return Response.json({ accessToken: "web-access", user });
  } });
  try {
    await api.login(user.email, "password"); await api.changePassword(body);
    assert.equal(api.accessToken(), null); assert.equal(coordinator.blocked(), true); assert.equal(lost, 1);
    assert.equal(await api.restore(), null);
    assert.deepEqual(calls, ["/auth/web/logout", "/auth/web/login", "/auth/web/password"]);
  } finally { api.dispose(); coordinator.dispose(); }
});
