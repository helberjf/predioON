import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { api, ApiError, tokens } from "../../ui/src/api.ts";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

it("keeps synchronous token access for SSE and invalidates requests on legacy token changes", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  tokens.save({ accessToken: "old-access", refreshToken: "old-refresh" });
  assert.equal(tokens.access(), "old-access");
  assert.equal(tokens.refresh(), "old-refresh");
  let respond!: (response: Response) => void;
  let started!: () => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async () => { started(); return response; };
  const pending = assert.rejects(api.get("/auth/me"), error => error instanceof ApiError && error.code === "SESSION_CHANGED");
  await requestStarted;
  tokens.clear();
  respond(Response.json({ id: "old-user" }));
  await pending;
  assert.equal(tokens.access(), null);
  assert.equal(tokens.refresh(), null);
});
