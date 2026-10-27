import assert from "node:assert/strict";
import { once } from "node:events";
import { it } from "node:test";
import express from "express";
import { createServerlessApp } from "../src/http/serverless.js";

async function serve(initialize: () => Promise<void>, run: (url: string) => Promise<void>) {
  const domain = express();
  domain.get("/example", (_req, res) => res.json({ ready: true }));
  const server = createServerlessApp(domain, initialize).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

it("holds concurrent requests until one shared runtime initialization succeeds", async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await serve(async () => { calls++; await pending; }, async url => {
    const requests = Array.from({ length: 3 }, () => fetch(`${url}/example`));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls, 1);
    release();
    for (const response of await Promise.all(requests)) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ready: true });
    }
    assert.equal((await fetch(`${url}/example`)).status, 200);
    assert.equal(calls, 1);
  });
});

it("refuses domain routes on initialization failure, sanitizes errors and permits a later request", async () => {
  let calls = 0;
  await serve(async () => { if (++calls === 1) throw new Error("postgres://owner:private-secret@example/db"); }, async url => {
    const rejected = await fetch(`${url}/example`);
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), { error: "API temporariamente indisponível" });
    assert.equal(rejected.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${url}/example`)).status, 200);
    assert.equal(calls, 2);
  });
});

it("keeps broker authorizers off the public Vercel entry before touching the database", async () => {
  let calls = 0;
  await serve(async () => { calls++; }, async url => {
    for (const path of ["/internal/mqtt/auth", "/internal/mqtt/acl", "/internal/other"]) {
      assert.equal((await fetch(url + path, { method: "POST" })).status, 404);
    }
    assert.equal(calls, 0);
  });
});
