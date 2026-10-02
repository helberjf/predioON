import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { login } from "./fixture-login.js";

async function fixture(replies: { status: number; retry?: string }[], run: (url: string, attempts: number[]) => Promise<void>) {
  const attempts: number[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.url, "/auth/login");
    assert.equal(req.method, "POST");
    attempts.push(Date.now());
    const reply = replies[Math.min(attempts.length - 1, replies.length - 1)]!;
    req.resume();
    res.writeHead(reply.status, { "content-type": "application/json", ...(reply.retry ? { "retry-after": reply.retry } : {}) });
    res.end(JSON.stringify(reply.status === 200 ? { accessToken: "fixture-access" } : { error: "fixture rejection" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, attempts); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("fixture login waits for the server's Retry-After before another real request", async () => {
  await fixture([{ status: 429, retry: "1" }, { status: 200 }], async (url, attempts) => {
    assert.equal((await login(url, "test@example.invalid")).accessToken, "fixture-access");
    assert.equal(attempts.length, 2);
    assert.ok(attempts[1]! - attempts[0]! >= 1000);
  });
});

test("fixture login never retries wrong credentials, service errors or invalid excessive wait advice", async () => {
  for (const reply of [
    { status: 400, retry: "1" }, { status: 401, retry: "1" }, { status: 403, retry: "1" },
    { status: 500, retry: "1" }, { status: 503, retry: "1" }, { status: 429 },
    ...["0", "-1", "1.5", "invalid", "61", "999999999999999999999"].map(retry => ({ status: 429, retry })),
  ]) await fixture([reply], async (url, attempts) => {
    await assert.rejects(login(url, "test@example.invalid"), new RegExp(String(reply.status)));
    assert.equal(attempts.length, 1);
  });
});

test("fixture login stops after four rejected attempts instead of masking a persistent failure", async () => {
  await fixture([{ status: 429, retry: "1" }], async (url, attempts) => {
    await assert.rejects(login(url, "test@example.invalid"), /429/);
    assert.equal(attempts.length, 4);
  });
});
