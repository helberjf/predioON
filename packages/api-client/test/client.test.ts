import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiError, createApiClient } from "../src/index.ts";

const session = (name = "old") => ({
  accessToken: `${name}-access`, refreshToken: `${name}-refresh`,
  user: { id: name, name, email: `${name}@example.com`, role: "RESIDENT" as const, memberships: [] },
});

function memoryStorage(initial = session()) {
  let value: { accessToken: string; refreshToken: string } | null = initial;
  return {
    getTokens: async () => value,
    setTokens: async (tokens: NonNullable<typeof value>) => { value = tokens; },
    clearTokens: async () => { value = null; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const unauthorized = () => Response.json({ error: "Sessão expirada" }, { status: 401 });
const isChanged = (error: unknown) => error instanceof ApiError && error.code === "SESSION_CHANGED";

it("shares one refresh rotation across concurrent unauthorized requests", async () => {
  const storage = memoryStorage();
  let refreshCalls = 0;
  const fresh = session("fresh");
  const client = createApiClient({ baseUrl: "https://api.example.com/", storage, fetch: async (url, init) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls++;
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: "old-refresh" });
      return Response.json(fresh);
    }
    return new Headers(init?.headers).get("Authorization") === `Bearer ${fresh.accessToken}`
      ? Response.json({ ok: true }) : unauthorized();
  } });
  assert.deepEqual(await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(await storage.getTokens(), { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
  assert.equal(client.baseUrl, "https://api.example.com");
});

it("reuses a renewed access token when an older 401 arrives after refresh completed", async () => {
  const lateResponse = deferred<Response>();
  let refreshCalls = 0;
  const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async (url, init) => {
    if (String(url).endsWith("/auth/refresh")) { refreshCalls++; return Response.json(session("fresh")); }
    if (new Headers(init?.headers).get("Authorization") === "Bearer fresh-access") return Response.json({ ok: true });
    return String(url).endsWith("/late") ? lateResponse.promise : unauthorized();
  } });
  const late = client.get("/late");
  await client.get("/first");
  lateResponse.resolve(unauthorized());
  assert.deepEqual(await late, { ok: true });
  assert.equal(refreshCalls, 1);
});

it("clears a rejected refresh once and reports authentication loss", async () => {
  const storage = memoryStorage();
  let lost = 0;
  let refreshCalls = 0;
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, onAuthLost: () => { lost++; }, fetch: async url => {
    if (String(url).endsWith("/auth/refresh")) { refreshCalls++; return Response.json({ error: "Refresh revogado" }, { status: 401 }); }
    return unauthorized();
  } });
  const results = await Promise.allSettled([client.get("/a"), client.get("/b")]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401));
  assert.equal(refreshCalls, 1);
  assert.equal(lost, 1);
  assert.equal(await storage.getTokens(), null);
});

it("keeps credentials on refresh transport failure and exposes a readable network error", async () => {
  const storage = memoryStorage();
  let lost = 0;
  let refreshCalls = 0;
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, onAuthLost: () => { lost++; }, fetch: async url => {
    if (String(url).endsWith("/auth/refresh")) { refreshCalls++; throw new TypeError("Failed to fetch"); }
    return unauthorized();
  } });
  await assert.rejects(client.get("/a"), error => error instanceof ApiError && error.status === 0 && error.code === "NETWORK_ERROR" && /Não foi possível/.test(error.message));
  assert.equal(refreshCalls, 1);
  assert.equal(lost, 0);
  assert.equal((await storage.getTokens())?.refreshToken, "old-refresh");
});

it("does not restore credentials when logout happens during refresh", async () => {
  const refreshStarted = deferred<void>();
  const refreshResponse = deferred<Response>();
  const storage = memoryStorage();
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async url => {
    if (String(url).endsWith("/auth/refresh")) { refreshStarted.resolve(); return refreshResponse.promise; }
    if (String(url).endsWith("/auth/logout")) return new Response(null, { status: 204 });
    return unauthorized();
  } });
  const result = assert.rejects(client.get("/a"), isChanged);
  await refreshStarted.promise;
  await client.logout();
  refreshResponse.resolve(Response.json(session("stale")));
  await result;
  assert.equal(await storage.getTokens(), null);
});

it("does not replace a new account with an older refresh response", async () => {
  const refreshStarted = deferred<void>();
  const refreshResponse = deferred<Response>();
  const storage = memoryStorage();
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async url => {
    if (String(url).endsWith("/auth/refresh")) { refreshStarted.resolve(); return refreshResponse.promise; }
    if (String(url).endsWith("/auth/login")) return Response.json(session("new"));
    return unauthorized();
  } });
  const result = assert.rejects(client.get("/a"), isChanged);
  await refreshStarted.promise;
  assert.equal((await client.login("new@example.com", "secret")).user.id, "new");
  refreshResponse.resolve(Response.json(session("stale")));
  await result;
  assert.equal((await storage.getTokens())?.accessToken, "new-access");
});

it("rejects old account data that arrives after a new login", async () => {
  const started = deferred<void>();
  const response = deferred<Response>();
  const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async url => {
    if (String(url).endsWith("/auth/login")) return Response.json(session("new"));
    started.resolve();
    return response.promise;
  } });
  const result = assert.rejects(client.get("/auth/me"), isChanged);
  await started.promise;
  await client.login("new@example.com", "secret");
  response.resolve(Response.json(session().user));
  await result;
});

it("does not restore a login response after logout", async () => {
  const started = deferred<void>();
  const response = deferred<Response>();
  const storage = memoryStorage();
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async () => {
    started.resolve();
    return response.promise;
  } });
  const result = assert.rejects(client.login("old@example.com", "secret"), isChanged);
  await started.promise;
  await client.logout();
  response.resolve(Response.json(session()));
  await result;
  assert.equal(await storage.getTokens(), null);
});

it("does not retry a mutation after a transport failure", async () => {
  let attempts = 0;
  const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async () => {
    attempts++;
    throw new TypeError("connection closed after request accepted");
  } });
  await assert.rejects(client.post("/reservations", { areaId: "pool" }), error => error instanceof ApiError && error.code === "NETWORK_ERROR");
  assert.equal(attempts, 1);
});

it("supports each HTTP verb and empty 204 responses", async () => {
  const calls: Array<{ method: string; body: unknown }> = [];
  const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async (_url, init) => {
    calls.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(null, { status: 204 });
  } });
  assert.equal(await client.get("/resource"), undefined);
  assert.equal(await client.post("/resource"), undefined);
  assert.equal(await client.put("/resource", { value: 1 }), undefined);
  assert.equal(await client.patch("/resource", { value: 2 }), undefined);
  assert.equal(await client.delete("/resource"), undefined);
  assert.deepEqual(calls, [
    { method: "GET", body: undefined }, { method: "POST", body: {} },
    { method: "PUT", body: { value: 1 } }, { method: "PATCH", body: { value: 2 } }, { method: "DELETE", body: undefined },
  ]);
});

it("preserves typed HTTP errors, including non-JSON response bodies", async () => {
  for (const response of [Response.json({ error: "Sem permissão" }, { status: 403 }), new Response("upstream failed", { status: 502 })]) {
    const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async () => response });
    await assert.rejects(client.get("/resource"), error => error instanceof ApiError && error.status === response.status && error.code === "HTTP_ERROR");
  }
});

it("orders slow token persistence before logout clearing", async () => {
  const writing = deferred<void>();
  const finishWrite = deferred<void>();
  const storage = memoryStorage();
  const setTokens = storage.setTokens;
  storage.setTokens = async tokens => {
    writing.resolve();
    await finishWrite.promise;
    await setTokens(tokens);
  };
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async url => {
    if (String(url).endsWith("/auth/login")) return Response.json(session("new"));
    return new Response(null, { status: 204 });
  } });
  const result = assert.rejects(client.login("new@example.com", "secret"), isChanged);
  await writing.promise;
  const logout = client.logout();
  finishWrite.resolve();
  await Promise.all([result, logout]);
  assert.equal(await storage.getTokens(), null);
});

it("completes local logout before revocation and leaves a newer login intact", async () => {
  const revoking = deferred<void>();
  const revokeResponse = deferred<Response>();
  const storage = memoryStorage();
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async url => {
    if (String(url).endsWith("/auth/logout")) { revoking.resolve(); return revokeResponse.promise; }
    return Response.json(session("new"));
  } });
  const logout = client.logout();
  await revoking.promise;
  assert.equal(await storage.getTokens(), null);
  await client.login("new@example.com", "secret");
  revokeResponse.resolve(new Response(null, { status: 204 }));
  await logout;
  assert.equal((await storage.getTokens())?.accessToken, "new-access");
});

it("invalidates a session when the replay still returns 401 without refreshing twice", async () => {
  const storage = memoryStorage();
  let refreshCalls = 0;
  let lost = 0;
  const client = createApiClient({ baseUrl: "https://api.example.com", storage, onAuthLost: () => { lost++; }, fetch: async url => {
    if (String(url).endsWith("/auth/refresh")) { refreshCalls++; return Response.json(session("fresh")); }
    return unauthorized();
  } });
  await assert.rejects(client.get("/a"), error => error instanceof ApiError && error.status === 401);
  assert.equal(refreshCalls, 1);
  assert.equal(lost, 1);
  assert.equal(await storage.getTokens(), null);
});

function interruptedResponse() {
  return new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("body connection terminated")); },
  }), { headers: { "Content-Type": "application/json" } });
}

it("reports response-body transport failures without replaying requests or mutations", async () => {
  for (const method of ["get", "post"] as const) {
    let attempts = 0;
    const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async () => {
      attempts++;
      return interruptedResponse();
    } });
    await assert.rejects(client[method]("/resource"), error => error instanceof ApiError && error.code === "NETWORK_ERROR" && error.status === 0 && /Não foi possível/.test(error.message));
    assert.equal(attempts, 1);
  }
});

it("normalizes login and refresh body interruptions without storing incomplete credentials", async () => {
  for (const operation of ["login", "refresh"] as const) {
    const storage = memoryStorage();
    let authCalls = 0;
    let lost = 0;
    const client = createApiClient({ baseUrl: "https://api.example.com", storage, onAuthLost: () => { lost++; }, fetch: async url => {
      if (String(url).endsWith(`/auth/${operation}`)) { authCalls++; return interruptedResponse(); }
      return unauthorized();
    } });
    const pending = operation === "login" ? client.login("new@example.com", "secret") : client.get("/resource");
    await assert.rejects(pending, error => error instanceof ApiError && error.code === "NETWORK_ERROR" && error.status === 0);
    assert.equal(authCalls, 1);
    assert.equal(lost, 0);
    assert.equal((await storage.getTokens())?.refreshToken ?? null, operation === "login" ? null : "old-refresh");
  }
});

it("reports malformed success JSON distinctly from a network failure", async () => {
  const client = createApiClient({ baseUrl: "https://api.example.com", storage: memoryStorage(), fetch: async () => new Response("{malformed") });
  await assert.rejects(client.get("/resource"), error => error instanceof ApiError && error.code === "INVALID_RESPONSE" && error.status === 200 && /JSON inválida/.test(error.message));
});

it("keeps session-change errors when a response body fails after logout", async () => {
  for (const operation of ["request", "login", "refresh"] as const) {
    const reading = deferred<void>();
    const interrupt = deferred<void>();
    const response = new Response(new ReadableStream({
      async pull(controller) {
        reading.resolve();
        await interrupt.promise;
        controller.error(new TypeError("body connection terminated"));
      },
    }, { highWaterMark: 0 }));
    const storage = memoryStorage();
    const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async url => {
      if (String(url).endsWith("/auth/logout")) return new Response(null, { status: 204 });
      if (operation === "refresh" && !String(url).endsWith("/auth/refresh")) return unauthorized();
      return response;
    } });
    const pending = assert.rejects(operation === "login" ? client.login("new@example.com", "secret") : client.post("/resource"), isChanged);
    await reading.promise;
    await client.logout();
    interrupt.resolve();
    await pending;
    assert.equal(await storage.getTokens(), null);
  }
});

for (const operation of ["mutation", "refresh"] as const) {
  it(`does not send an old ${operation} after logout between token-read continuations`, async () => {
    let storedTokens: { accessToken: string; refreshToken: string } | null = session();
    const invalidated = deferred<void>();
    let reads = 0;
    let logout: Promise<void> | undefined;
    let logoutStarted = false;
    const lateSends: string[] = [];
    const storage = {
      async getTokens() {
        const snapshot = storedTokens;
        if (++reads === (operation === "mutation" ? 1 : 3)) {
          void (async () => {
            // Resume logout after readTokens validates, before its caller resumes.
            for (let tick = 0; tick < 5; tick++) await Promise.resolve();
            logoutStarted = true;
            logout = client.logout();
            invalidated.resolve();
          })();
        }
        return snapshot;
      },
      async setTokens(tokens: NonNullable<typeof storedTokens>) { storedTokens = tokens; },
      async clearTokens() { storedTokens = null; },
    };
    const client = createApiClient({ baseUrl: "https://api.example.com", storage, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/auth/logout") return new Response(null, { status: 204 });
      if (logoutStarted) lateSends.push(`${init?.method} ${path}`);
      if (path === "/auth/refresh") return Response.json(session("fresh"));
      return operation === "mutation" ? new Response(null, { status: 204 }) : unauthorized();
    } });
    const pending = assert.rejects(client.post("/resource"), isChanged);
    await invalidated.promise;
    await Promise.all([pending, logout]);
    assert.deepEqual(lateSends, [], "logout must invalidate work before it reaches the transport");
    assert.equal(await storage.getTokens(), null);
  });
}
