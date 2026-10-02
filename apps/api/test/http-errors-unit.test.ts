import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestServer, type TestServer } from "./helpers.js";

describe("HTTP request failures without a database", () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.close(); });

  it("returns 400 for malformed JSON without logging submitted credentials", async t => {
    const log = t.mock.method(console, "error", () => undefined);
    const response = await fetch(`${server.url}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: '{"password":"private-password",',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "JSON inválido" });
    assert.equal(log.mock.callCount(), 0, "body-parser errors include the submitted body");
  });

  it("returns 413 when a JSON payload exceeds the API body limit", async t => {
    const log = t.mock.method(console, "error", () => undefined);
    const response = await fetch(`${server.url}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x".repeat(1024 * 1024) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "Corpo da requisição excede o limite permitido" });
    assert.equal(log.mock.callCount(), 0);
  });

  it("prevents caching authentication and validation responses", async () => {
    for (const path of ["/auth/me", "/auth/sessions"]) {
      const response = await fetch(`${server.url}${path}`);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const invalid = await fetch(`${server.url}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
  });
});
