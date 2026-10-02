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

it("renova uma única vez entre consultas simultâneas e não grava credenciais no navegador", async () => {
  const storage = new Map([["predioon.access", "legacy"], ["predioon.refresh", "legacy-refresh"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  }});
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { request: (_name: string, operation: () => Promise<unknown>) => operation() },
  }});
  const { api, setAuthLostHandler, tokens } = await import("../src/api.ts");
  let refreshCalls = 0, lost = 0;
  setAuthLostHandler(() => { lost++; });
  const user = { id: "resident", name: "Resident", email: "resident@example.test", role: "RESIDENT", memberships: [] };
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/web/logout")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/auth/web/login")) return Response.json({ accessToken: "expired", user });
    if (String(url).endsWith("/auth/web/refresh")) {
      refreshCalls++; await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json({ accessToken: "fresh", user });
    }
    return new Headers(init?.headers).get("Authorization") === "Bearer fresh"
      ? Response.json({ ok: true }) : Response.json({ error: "Expirado" }, { status: 401 });
  };
  await api.login("resident@example.test", "password");
  const result = await Promise.allSettled([api.get("/overview"), api.get("/readings"), api.get("/notices")]);
  assert.equal(refreshCalls, 1);
  assert.ok(result.every(item => item.status === "fulfilled")); assert.equal(lost, 0);
  assert.equal(tokens.access(), "fresh");
  assert.equal(storage.has("predioon.access"), false); assert.equal(storage.has("predioon.refresh"), false);
  assert.ok([...storage.values()].every(value => !value.includes("fresh") && !value.includes("expired")));
  api.dispose(); setAuthLostHandler(null);
});
