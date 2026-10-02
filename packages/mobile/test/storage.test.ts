import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "@predioon/api-client";
import { createSessionActionScope } from "../src/session-actions.ts";
import {
  createMobileTokenStorage,
  type SecureRefreshStore,
} from "../src/storage.ts";

function secureStore(initial: string | null = null) {
  let persisted = initial;
  const writes: string[] = [];
  const adapter: SecureRefreshStore = {
    async read() {
      return persisted;
    },
    async write(value) {
      writes.push(value);
      persisted = value;
    },
    async remove() {
      persisted = null;
    },
  };
  return { adapter, writes, persisted: () => persisted };
}

test("native persistence receives only refresh token; restart has no access token", async () => {
  const secure = secureStore();
  const storage = createMobileTokenStorage(secure.adapter);
  await storage.setTokens({
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
  });
  assert.deepEqual(secure.writes, ["refresh-secret"]);
  assert.deepEqual(await storage.getTokens(), {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
  });
  assert.deepEqual(await createMobileTokenStorage(secure.adapter).getTokens(), {
    accessToken: "",
    refreshToken: "refresh-secret",
  });
  await storage.clearTokens();
  assert.equal(await storage.getTokens(), null);
  assert.equal(secure.persisted(), null);
});

test("a slow failed logout cannot display an error over the next sign-in", async () => {
  const actions = createSessionActionScope();
  let rejectRemoval!: (reason: Error) => void;
  const slowRemoval = new Promise<void>((_resolve, reject) => { rejectRemoval = reject; });
  let bootError: string | null = null;
  const logoutAction = actions.begin();
  const logout = slowRemoval.catch(error => { if (actions.isCurrent(logoutAction)) bootError = error.message; });
  const loginAction = actions.begin();
  rejectRemoval(new Error("old keychain failure"));
  await logout;
  assert.equal(bootError, null);
  assert.equal(actions.isCurrent(loginAction), true);
});

test("failed secure persistence never exposes the unpersisted access token", async () => {
  const storage = createMobileTokenStorage({
    async read() {
      return "previous-refresh";
    },
    async write() {
      throw new Error("keychain locked");
    },
    async remove() {},
  });
  await assert.rejects(
    storage.setTokens({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    }),
    /keychain locked/,
  );
  assert.deepEqual(await storage.getTokens(), {
    accessToken: "",
    refreshToken: "previous-refresh",
  });
});

test("restart and parallel API requests rotate a persisted refresh token only once", async () => {
  const secure = secureStore("old-refresh");
  let refreshes = 0;
  const storage = createMobileTokenStorage(secure.adapter);
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    storage,
    fetch: async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshes++;
        assert.deepEqual(JSON.parse(String(init?.body)), {
          refreshToken: "old-refresh",
        });
        return Response.json({
          accessToken: "fresh-access",
          refreshToken: "fresh-refresh",
        });
      }
      if (
        new Headers(init?.headers).get("Authorization") !==
        "Bearer fresh-access"
      )
        return new Response(null, { status: 401 });
      return Response.json({ id: "user" });
    },
  });
  const values = await Promise.all([
    client.get("/auth/me"),
    client.get("/buildings"),
    client.get("/notices"),
  ]);
  assert.equal(refreshes, 1);
  assert.equal(values.length, 3);
  assert.deepEqual(secure.writes, ["fresh-refresh"]);
});

test("a temporarily unavailable API preserves the native refresh token", async () => {
  const secure = secureStore("persisted-refresh");
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    storage: createMobileTokenStorage(secure.adapter),
    fetch: async () => {
      throw new TypeError("offline");
    },
  });
  await assert.rejects(client.get("/auth/me"), /conexão/);
  assert.equal(secure.persisted(), "persisted-refresh");
});

test("local logout clears persisted credentials even if remote revocation fails", async () => {
  const secure = secureStore("persisted-refresh");
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    storage: createMobileTokenStorage(secure.adapter),
    fetch: async () => {
      throw new TypeError("offline");
    },
  });
  await client.logout();
  assert.equal(secure.persisted(), null);
});

test("an unauthorized rotation removes native credentials and emits auth lost", async () => {
  const secure = secureStore("revoked-refresh");
  let lost = 0;
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    storage: createMobileTokenStorage(secure.adapter),
    onAuthLost: () => lost++,
    fetch: async () => new Response(null, { status: 401 }),
  });
  await assert.rejects(client.get("/auth/me"));
  assert.equal(secure.persisted(), null);
  assert.equal(lost, 1);
});
