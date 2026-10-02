import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient, type SessionTokens } from "@predioon/api-client";
import type { AccessCommandView } from "@predioon/contracts";
import { createAccessIntentStore } from "../src/access-intents.ts";

function storage() {
  let tokens: SessionTokens | null = {
    accessToken: "expired",
    refreshToken: "refresh",
  };
  return {
    async getTokens() {
      return tokens;
    },
    async setTokens(next: SessionTokens) {
      tokens = next;
    },
    async clearTokens() {
      tokens = null;
    },
  };
}
function accepted(requestId: string): AccessCommandView {
  return {
    id: "server-command",
    requestId,
    gateId: "gate",
    status: "SENT",
    createdAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T00:00:15Z",
    failureReason: null,
  };
}

test("real API client and mobile intents recover an accepted command after a lost response without creating a second physical action", async () => {
  const commands = new Map<string, AccessCommandView>();
  let posts = 0;
  let effects = 0;
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    storage: storage(),
    fetch: async (_url, init) => {
      assert.equal(init?.method, "POST");
      posts++;
      const { requestId } = JSON.parse(String(init.body));
      if (!commands.has(requestId)) {
        commands.set(requestId, accepted(requestId));
        effects++;
      }
      if (posts === 1) throw new Error("response lost after server commit");
      return Response.json(commands.get(requestId));
    },
  });
  const store = createAccessIntentStore(
    () => "7d17d101-5015-4a08-a179-d0d4d4509d39",
  );
  const send = (requestId: string) =>
    api.post<AccessCommandView>("/access/gate/open", { requestId });
  await store.submit("building", "gate", send);
  assert.equal(posts, 1);
  assert.equal(effects, 1);
  assert.equal(
    store.getSnapshot()[store.key("building", "gate")].command,
    null,
  );
  // A separate, explicitly confirmed gesture invokes submit again, preserving the key.
  await store.submit("building", "gate", send);
  assert.equal(posts, 2);
  assert.equal(effects, 1);
  assert.equal(
    store.getSnapshot()[store.key("building", "gate")].command?.status,
    "SENT",
  );
  await store.submit("building", "gate", send);
  assert.equal(posts, 2, "pending server commands only allow GET polling");
});

test("401 renewal preserves the physical intent body and does not replay an authenticated ambiguous failure", async () => {
  const bodies: string[] = [];
  let refreshes = 0;
  let effects = 0;
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    storage: storage(),
    fetch: async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshes++;
        return Response.json({ accessToken: "fresh", refreshToken: "rotated" });
      }
      bodies.push(String(init?.body));
      if (new Headers(init?.headers).get("Authorization") === "Bearer expired")
        return Response.json({ error: "expired" }, { status: 401 });
      effects++;
      return Response.json(
        { error: "gateway response uncertain" },
        { status: 503 },
      );
    },
  });
  const store = createAccessIntentStore(
    () => "7d17d101-5015-4a08-a179-d0d4d4509d39",
  );
  await store.submit("building", "gate", (requestId) =>
    api.post("/access/gate/open", { requestId }),
  );
  assert.equal(refreshes, 1);
  assert.equal(effects, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(
    store.getSnapshot()[store.key("building", "gate")].requestId,
    "7d17d101-5015-4a08-a179-d0d4d4509d39",
  );
  assert.match(
    store.getSnapshot()[store.key("building", "gate")].error!,
    /uncertain/,
  );
});
