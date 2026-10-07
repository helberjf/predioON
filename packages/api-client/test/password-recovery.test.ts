import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, requestPasswordRecovery as request } from "../src/index.ts";
import { createBoundedFetch } from "../../mobile/src/bounded-fetch.ts";

const generic = "Não foi possível solicitar a recuperação. Tente novamente mais tarde.";
test("public recovery sends only email without credentials and accepts unread204", async () => {
  let calls = 0;
  const cancel = new AbortController();
  await request({ baseUrl: "https://api.example.test/", fetch: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.example.test/auth/password/forgot");
    assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.deepEqual([...new Headers(init?.headers)], [["content-type", "application/json"]]);
    assert.deepEqual(JSON.parse(String(init?.body)), { email: "person@example.test" });
    assert.equal(init?.signal, cancel.signal);
    return { status: 204, json() { assert.fail("204 JSON must not be read"); }, text() { assert.fail("204 body must not be read"); } } as unknown as Response;
  } }, " Person@Example.test ", cancel.signal);
  assert.equal(calls, 1);
});
for (const status of [400, 401, 403, 429, 503, 200, 202]) test(`recovery sanitizes status${status} without interpreting its secret body or retrying`, async () => {
  let calls = 0;
  const message = status === 400 ? "Informe um e-mail válido." : status === 429 ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." : generic;
  await assert.rejects(request({ baseUrl: "https://api.example.test", fetch: async () => {
    calls++;
    return { status, json() { assert.fail("secret-token SQL body must not be read"); }, text() { assert.fail("secret-token SQL body must not be read"); } } as unknown as Response;
  } }, "person@example.test"), (error: unknown) => error instanceof ApiError && error.message === message && error.status === status && error.code === (status >= 200 && status < 300 ? "INVALID_RESPONSE" : "HTTP_ERROR"));
  assert.equal(calls, 1);
});
test("network and cancellation expose fixed text with one call", async () => {
  for (const cause of [new Error("secret-email SQL token"), Object.assign(new Error("private"), { name: "AbortError" })]) {
    let calls = 0;
    await assert.rejects(request({ baseUrl: "https://api.example.test", fetch: async () => { calls++; throw cause; } }, "person@example.test"), (error: unknown) => error instanceof ApiError && error.code === "NETWORK_ERROR" && error.message === generic);
    assert.equal(calls, 1);
  }
});
test("the existing bounded native transport cancels recovery without a retry", async () => {
  let calls = 0; let signal: AbortSignal | null | undefined;
  await assert.rejects(request({ baseUrl: "https://api.example.test", fetch: createBoundedFetch((_url, init) => {
    calls++; signal = init?.signal; return new Promise<Response>(() => {});
  }, 20) }, "person@example.test"), { message: generic });
  assert.equal(calls, 1); assert.equal(signal?.aborted, true);
});
test("real caller cancellation reaches the bounded public fetch and does not retry", async () => {
  let calls = 0; let signal: AbortSignal | null | undefined;
  const cancel = new AbortController();
  const pending = request({ baseUrl: "https://api.example.test", fetch: createBoundedFetch((_url, init) => {
    calls++; signal = init?.signal; return new Promise<Response>(() => {});
  }) }, "person@example.test", cancel.signal);
  cancel.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof ApiError && error.code === "NETWORK_ERROR" && error.message === generic);
  assert.equal(signal?.aborted, true); assert.equal(calls, 1);
});
