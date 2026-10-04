import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { notificationConfiguration } from "../src/configuration.js";
import { runNotificationAttempt, type NotificationAttempt, type Claim, type Delivery, type Completion } from "../src/protocol.js";
import { postWebhook, retryAfterSeconds, type TransportOutcome } from "../src/transport.js";

const payload = {
  alertId: "aaaaaaaa-0000-4000-8000-000000000001", buildingId: "fixture-building", deviceId: "fixture-device",
  severity: "HIGH", type: "COMMUNICATION_LOST", message: "private synthetic message", triggeredAt: "2026-10-03T12:00:00.000Z",
};
const claim: Claim = { deliveryId: "delivery-fixture", eventId: "event-fixture", token: "token-fixture" };
const delivery: Delivery = { payload, idempotencyKey: "fixture/webhook/alert.raised.v1" };

function attemptFixture() {
  const cancelled = new AbortController();
  const calls: string[] = [];
  let outcome: TransportOutcome | undefined;
  const attempt: NotificationAttempt = {
    signal: cancelled.signal, isValid: () => !cancelled.signal.aborted,
    async claim() { calls.push("claim"); return claim; },
    async revalidate(actual) { assert.equal(actual, claim); calls.push("revalidate"); return delivery; },
    async complete(actual, received) { assert.equal(actual, claim); calls.push("complete"); outcome = received; return "delivered"; },
    async close() { calls.push("close"); },
  };
  return { attempt, calls, cancelled, outcome: () => outcome };
}

test("one revalidated delivery sends exactly one POST and closes after confirmation", async () => {
  const fixture = attemptFixture();
  let posts = 0;
  const request: typeof fetch = async (url, options) => {
    posts++;
    assert.equal(url, "https://fixture.invalid/hook");
    assert.deepEqual(fixture.calls, ["claim", "revalidate"]);
    assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "manual");
    assert.equal(new Headers(options?.headers).get("Idempotency-Key"), delivery.idempotencyKey);
    assert.deepEqual(JSON.parse(options!.body as string), payload);
    return new Response(null, { status: 204 });
  };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid/hook", request), "delivered");
  assert.equal(posts, 1); assert.deepEqual(fixture.calls, ["claim", "revalidate", "complete", "close"]);
  assert.deepEqual(fixture.outcome(), { kind: "http", status: 204 });
});

test("empty or expired reservations never send a webhook", async () => {
  for (const phase of ["claim", "revalidate"] as const) {
    const fixture = attemptFixture();
    fixture.attempt[phase] = async () => undefined;
    let requests = 0;
    const request: typeof fetch = async () => { requests++; throw new Error("must not send"); };
    const result = await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", request);
    assert.equal(result, phase === "claim" ? "empty" : "stale"); assert.equal(requests, 0);
    assert.equal(fixture.calls.at(-1), "close"); assert.equal(fixture.calls.includes("complete"), false);
  }
});

test("connection loss while HTTP is pending aborts transport and never completes a stale backend", async () => {
  const fixture = attemptFixture();
  let requests = 0;
  const request: typeof fetch = async (_url, options) => {
    requests++; fixture.cancelled.abort(); assert.equal(options!.signal!.aborted, true);
    throw new Error("private database URL and response body");
  };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", request), "aborted");
  assert.equal(requests, 1); assert.deepEqual(fixture.calls, ["claim", "revalidate", "close"]);
});

test("connection loss after revalidation prevents starting HTTP", async () => {
  const fixture = attemptFixture();
  fixture.attempt.revalidate = async () => { fixture.cancelled.abort(); return delivery; };
  let sent = 0;
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", async () => { sent++; return new Response(null, { status: 204 }); }), "aborted");
  assert.equal(sent, 0); assert.equal(fixture.calls.includes("complete"), false); assert.equal(fixture.calls.at(-1), "close");
});

test("late completion after a lost backend is never reported as delivered", async () => {
  const fixture = attemptFixture();
  fixture.attempt.complete = async () => { fixture.cancelled.abort(); return "delivered"; };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", async () => new Response(null, { status: 204 })), "aborted");
  assert.equal(fixture.calls.at(-1), "close");
});

test("missing destination is recorded explicitly with no HTTP request", async () => {
  const fixture = attemptFixture();
  fixture.attempt.complete = async (_claim, result) => { assert.deepEqual(result, { kind: "no_destination" }); return "no_destination"; };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, undefined, async () => { throw new Error("must not send"); }), "no_destination");
  assert.equal(fixture.calls.at(-1), "close");
});

test("unconfirmed unlock overrides acceptance and the connection still closes", async () => {
  const fixture = attemptFixture();
  fixture.attempt.close = async () => { fixture.calls.push("destroyed-after-unlock-error"); throw new Error("private SQL"); };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", async () => new Response(null, { status: 204 })), "database_error");
  assert.equal(fixture.calls.at(-1), "destroyed-after-unlock-error");
});

test("closed error categories hide private SQL and never retry a failed completion", async () => {
  const fixture = attemptFixture(); let requests = 0; let completions = 0;
  fixture.attempt.complete = async () => { completions++; throw new Error("postgres://user:secret@private/DB private message"); };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", async () => { requests++; return new Response(null, { status: 204 }); }), "database_error");
  assert.equal(requests, 1); assert.equal(completions, 1); assert.equal(fixture.calls.at(-1), "close");
});

test("stopped workers open no connection, and cancellation before claim still checks cleanup", async () => {
  const stopped = new AbortController(); stopped.abort(); let opens = 0;
  assert.equal(await runNotificationAttempt(async () => { opens++; throw new Error(); }, stopped.signal, undefined), "aborted");
  assert.equal(opens, 0);
  const fixture = attemptFixture(); fixture.cancelled.abort();
  fixture.attempt.close = async () => { throw new Error("cleanup failed"); };
  assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, undefined), "database_error");
  assert.deepEqual(fixture.calls, []);
});

test("SQL owns every terminal/retry/stale decision returned to the caller", async () => {
  for (const result of ["delivered", "retry", "failed", "cancelled", "no_destination", "stale"] satisfies Completion[]) {
    const fixture = attemptFixture(); fixture.attempt.complete = async () => result;
    assert.equal(await runNotificationAttempt(async () => fixture.attempt, new AbortController().signal, "https://fixture.invalid", async () => new Response(null, { status: 503 })), result);
    assert.equal(fixture.calls.at(-1), "close");
  }
});

async function withHttp(run: (url: string, server: Server) => Promise<void>) {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, server); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("shutdown during real HTTP cancels immediately without waiting for the transport deadline", async () => withHttp(async (url, server) => {
  const fixture = attemptFixture(); const shutdown = new AbortController();
  let posts = 0;
  server.on("request", req => { posts++; req.resume(); shutdown.abort(); });
  const result = await runNotificationAttempt(async () => fixture.attempt, shutdown.signal, url);
  assert.equal(result, "aborted"); assert.equal(posts, 1);
  assert.deepEqual(fixture.calls, ["claim", "revalidate", "close"]);
}));

test("real HTTP redirects are refused and provider body is excluded", async () => withHttp(async (url, server) => {
  const paths: string[] = [];
  server.on("request", (req, res) => { paths.push(req.url!); req.resume(); res.writeHead(302, { Location: "/other" }); res.end("private provider content"); });
  assert.deepEqual(await postWebhook(url, payload, delivery.idempotencyKey, new AbortController().signal), { kind: "http", status: 302 });
  assert.deepEqual(paths, ["/"]);
}));

test("real HTTP429/503 hints are bounded and other status hints are ignored", async () => withHttp(async (url, server) => {
  let status = 429; let requests = 0;
  server.on("request", (req, res) => { requests++; req.resume(); res.writeHead(status, { "Retry-After": "999999999" }); res.end(); });
  for (status of [429, 503, 500, 403, 204]) {
    assert.deepEqual(await postWebhook(url, payload, delivery.idempotencyKey, new AbortController().signal),
      { kind: "http", status, ...([429, 503].includes(status) ? { retryAfterSeconds: 300 } : {}) });
  }
  assert.equal(requests, 5);
}));

test("real HTTP timeout is bounded, sends once and exports no URL/payload", async () => withHttp(async (url, server) => {
  let requests = 0; server.on("request", req => { requests++; req.resume(); });
  assert.deepEqual(await postWebhook(url, payload, delivery.idempotencyKey, new AbortController().signal, fetch, 100), { kind: "timeout" });
  assert.equal(requests, 1);
}));

test("real HTTP network failure sends once and exposes only its category", async () => withHttp(async (url, server) => {
  let requests = 0; server.on("request", req => { requests++; req.socket.destroy(); });
  assert.deepEqual(await postWebhook(url, payload, delivery.idempotencyKey, new AbortController().signal), { kind: "network" });
  assert.equal(requests, 1);
}));

test("Retry-After accepts bounded seconds/RFC dates and rejects malformed data", () => {
  const now = Date.parse("Sat, 03 Oct 2026 12:00:00 GMT");
  assert.equal(retryAfterSeconds("42", now), 42); assert.equal(retryAfterSeconds("999999999", now), 300);
  assert.equal(retryAfterSeconds("Sat, 03 Oct 2026 12:00:30 GMT", now), 30);
  assert.equal(retryAfterSeconds("Sat, 03 Oct 2026 11:59:00 GMT", now), 0);
  for (const value of [null, "", "-1", "1.5", "+1", "banana", "9999999999999", "1".repeat(200)]) assert.equal(retryAfterSeconds(value, now), undefined);
});

test("configuration rejects unsafe destination without echoing secrets", () => {
  assert.deepEqual(notificationConfiguration({}), {});
  assert.equal(notificationConfiguration({ ALERT_WEBHOOK_URL: "https://fixture.invalid/hook", NODE_ENV: "production" }).destination, "https://fixture.invalid/hook");
  for (const url of ["http://fixture.invalid", "https://user:secret@fixture.invalid/hook", "https://fixture.invalid/#secret", "file:///secret"]) {
    assert.throws(() => notificationConfiguration({ ALERT_WEBHOOK_URL: url, NODE_ENV: "production" }), error => {
      assert.ok(error instanceof Error); assert.equal(error.message.includes("secret"), false); assert.equal(error.message.includes(url), false); return true;
    });
  }
});
