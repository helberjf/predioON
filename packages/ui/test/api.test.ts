import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { api, setAuthLostHandler } from "../src/api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setAuthLostHandler(null); });

it("renova uma única vez quando consultas simultâneas recebem token expirado", async () => {
  const storage = new Map([["predioon.access", "expired"], ["predioon.refresh", "refresh-once"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  }});
  let refreshCalls = 0;
  let lost = 0;
  setAuthLostHandler(() => { lost++; });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      if (refreshCalls > 1) return Response.json({ error: "Token já utilizado" }, { status: 401 });
      return Response.json({ accessToken: "fresh", refreshToken: "rotated" });
    }
    return new Headers(init?.headers).get("Authorization") === "Bearer fresh"
      ? Response.json({ ok: true }) : Response.json({ error: "Expirado" }, { status: 401 });
  };
  const result = await Promise.allSettled([api.get("/overview"), api.get("/readings"), api.get("/notices")]);
  assert.equal(refreshCalls, 1, "as três consultas devem compartilhar a renovação");
  assert.ok(result.every(item => item.status === "fulfilled"));
  assert.equal(lost, 0);
  assert.equal(storage.get("predioon.refresh"), "rotated");
});
