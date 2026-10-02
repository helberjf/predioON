import assert from "node:assert/strict";
import test from "node:test";
import type { AuthUser, WebSession } from "@predioon/contracts/auth";
import { createAuthActions } from "../src/auth-state.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  let user: AuthUser | null = null;
  let logouts = 0;
  const session = (email: string): WebSession => ({ accessToken: "memory-only", user: { id: email, name: email, email, role: "RESIDENT", memberships: [] } });
  const actions = createAuthActions({
    api: {
      async login(email: string) { return session(email); },
      async restore() { return session("restored@example.invalid"); },
      async logout() { logouts++; },
      clearMemory() {},
    },
    onUserChange(value) { user = value; }, onLoadingChange() {}, onErrorChange() {},
  });
  return { actions, get user() { return user; }, get logouts() { return logouts; } };
}

test("confirmed remote revocation clears the captured identity after the initiating view has gone away", async () => {
  const f = fixture(), remote = deferred();
  await f.actions.signIn("first@example.invalid", "secret");
  let calls = 0;
  const done = f.actions.signOutAfter(() => { calls++; return remote.promise; });
  assert.equal(f.user?.id, "first@example.invalid");
  assert.equal(f.logouts, 0);
  // There is no view callback to retain: the authentication provider owns completion.
  remote.resolve(); await done;
  assert.equal(calls, 1);
  assert.equal(f.user, null);
  assert.equal(f.logouts, 1);
});

test("a delayed revocation never logs out a newly authenticated account", async () => {
  const f = fixture(), remote = deferred();
  await f.actions.signIn("old@example.invalid", "secret");
  const done = f.actions.signOutAfter(() => remote.promise);
  await f.actions.signIn("new@example.invalid", "secret");
  remote.resolve(); await done;
  assert.equal(f.user?.id, "new@example.invalid");
  assert.equal(f.logouts, 0);
});

test("a failed revocation remains an error and does not claim to have logged out", async () => {
  const f = fixture(), remote = deferred();
  await f.actions.signIn("current@example.invalid", "secret");
  const done = f.actions.signOutAfter(() => remote.promise);
  const rejected = assert.rejects(done, /revocation unavailable/);
  remote.reject(new Error("revocation unavailable")); await rejected;
  assert.equal(f.user?.id, "current@example.invalid");
  assert.equal(f.logouts, 0);
});

test("provider cancellation and an independent restore supersede a pending revocation completion", async () => {
  for (const replace of ["cancel", "restore"] as const) {
    const f = fixture(), remote = deferred();
    await f.actions.signIn("initial@example.invalid", "secret");
    const done = f.actions.signOutAfter(() => remote.promise);
    await f.actions[replace]();
    remote.resolve(); await done;
    assert.equal(f.logouts, 0);
    assert.equal(f.user?.id, replace === "restore" ? "restored@example.invalid" : "initial@example.invalid");
  }
});
