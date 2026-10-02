import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApiClient } from "@predioon/api-client";
import { createBoundedFetch } from "../src/bounded-fetch.ts";
import { createAccessIntentStore } from "../src/access-intents.ts";

test("a response that stops after headers times out without replaying a physical intent", async () => {
  let posts = 0;
  let aborted = false;
  const fetch = createBoundedFetch(async (_input, init) => {
    posts++;
    assert.equal(init?.method, "POST");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          controller.error(new Error("transport aborted"));
        }, { once: true });
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  }, 30);
  const api = createApiClient({
    baseUrl: "https://api.example.test", fetch,
    storage: {
      async getTokens() { return { accessToken: "token", refreshToken: "refresh" }; },
      async setTokens() {},
      async clearTokens() {},
    },
  });
  const store = createAccessIntentStore(() => "4c34414e-62c9-4b74-833d-7e2ba0f5c77c");
  await store.submit("building", "gate", (requestId) => api.post("/access/gate/open", { requestId }));
  assert.equal(posts, 1);
  assert.equal(aborted, true);
  const intent = store.getSnapshot()[store.key("building", "gate")];
  assert.equal(intent.pending, false);
  assert.equal(intent.command, null);
  assert.equal(intent.requestId, "4c34414e-62c9-4b74-833d-7e2ba0f5c77c");
  assert.match(intent.error!, /conexão/);
});

test("a transport ignoring AbortSignal cannot keep the caller pending after the deadline", async () => {
  const fetch = createBoundedFetch(() => new Promise<Response>(() => {}), 20);
  await assert.rejects(fetch("https://api.example.test"), { name: "AbortError" });
});

test("caller cancellation propagates while consuming the body and never reissues the request", async () => {
  const caller = new AbortController();
  let sent = 0;
  let transportSignal: AbortSignal | null | undefined;
  let headersReady!: () => void;
  const ready = new Promise<void>((resolve) => { headersReady = resolve; });
  const fetch = createBoundedFetch(async (_input, init) => {
    sent++;
    transportSignal = init?.signal;
    headersReady();
    return new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new Error("cancelled")), { once: true });
      },
    }));
  }, 5_000);
  const pending = fetch("https://api.example.test", { signal: caller.signal });
  await ready;
  caller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(transportSignal?.aborted, true);
  assert.equal(sent, 1);
});

test("an already cancelled Request is rejected before any transport call", async () => {
  const caller = new AbortController();
  caller.abort();
  let sent = 0;
  const fetch = createBoundedFetch(async () => { sent++; return Response.json({}); });
  await assert.rejects(fetch(new Request("https://api.example.test", { signal: caller.signal })), { name: "AbortError" });
  assert.equal(sent, 0);
});

test("a complete response keeps identity, status, headers and an unread original body", async () => {
  const original = Response.json({ error: "forbidden" }, { status: 403, headers: { "x-trace": "example" } });
  const caller = new AbortController();
  let transportSignal: AbortSignal | null | undefined;
  const fetch = createBoundedFetch(async (_input, init) => { transportSignal = init?.signal; return original; }, 40);
  const response = await fetch("https://api.example.test", { signal: caller.signal });
  assert.equal(response, original);
  assert.equal(response.bodyUsed, false);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("x-trace"), "example");
  assert.deepEqual(await response.json(), { error: "forbidden" });
  caller.abort();
  assert.equal(transportSignal?.aborted, false, "completed calls detach cancellation listeners");
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.equal(transportSignal?.aborted, false, "completed calls clear their deadline timer");
});

test("empty 204 and invalid JSON preserve the API client response contract", async () => {
  const empty = await createBoundedFetch(async () => new Response(null, { status: 204 }))("https://api.example.test");
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
  const invalid = await createBoundedFetch(async () => new Response("not JSON"))("https://api.example.test");
  await assert.rejects(invalid.json(), SyntaxError);
});

test("real HTTP redirects retain their final URL and redirected metadata", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/start") {
      response.writeHead(302, { Location: "/destination" });
      response.end();
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"complete":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await createBoundedFetch(globalThis.fetch, 5_000)(`${origin}/start`);
    assert.equal(response.url, `${origin}/destination`);
    assert.equal(response.redirected, true);
    assert.deepEqual(await response.json(), { complete: true });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
