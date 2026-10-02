import assert from "node:assert/strict";
import { afterEach, it } from "node:test";

const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [["navigator", originalNavigator], ["localStorage", originalStorage]] as const) {
    if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
  }
});

it("keeps synchronous memory access for SSE and rejects old responses after web logout", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() },
  }});
  const { api, ApiError, tokens } = await import("../../ui/src/api.ts");
  globalThis.fetch = async url => String(url).endsWith("/auth/web/login")
    ? Response.json({ accessToken: "old-access", user: { id: "old", name: "Old", email: "old@example.test", role: "RESIDENT", memberships: [] } })
    : new Response(null, { status: 204 });
  await api.login("old@example.test", "password");
  assert.equal(tokens.access(), "old-access");
  let respond!: (response: Response) => void, started!: () => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async url => {
    if (String(url).endsWith("/auth/web/logout")) return new Response(null, { status: 204 });
    started(); return response;
  };
  const pending = assert.rejects(api.get("/auth/me"), error => error instanceof ApiError && error.code === "SESSION_CHANGED");
  await requestStarted; await api.logout(); respond(Response.json({ id: "old-user" })); await pending;
  assert.equal(tokens.access(), null);
  assert.equal(values.has("predioon.access"), false); assert.equal(values.has("predioon.refresh"), false);
  api.dispose();
});
