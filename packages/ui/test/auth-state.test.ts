import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiError } from "@predioon/api-client";
import { createAuthActions } from "../src/auth-state.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const user = (id: string) => ({ id, name: id, email: `${id}@example.com`, role: "RESIDENT" as const, memberships: [] });
const session = (id: string) => ({ accessToken: id, refreshToken: id, user: user(id) });

function harness() {
  const restore = deferred<ReturnType<typeof user>>();
  const login = deferred<ReturnType<typeof session>>();
  const logout = deferred<void>();
  let currentUser: ReturnType<typeof user> | null = user("old");
  let loading = true;
  let clears = 0;
  const actions = createAuthActions({
    api: { get: async <T>() => await restore.promise as T, login: async () => login.promise, logout: async () => logout.promise },
    tokens: { access: () => "old", clear: () => { clears++; } },
    onUserChange: next => { currentUser = next; },
    onLoadingChange: next => { loading = next; },
  });
  return { actions, restore, login, logout, state: () => ({ user: currentUser, loading, clears }) };
}

it("does not let a failed bootstrap clear a newer login", async () => {
  const context = harness();
  const restoring = context.actions.restore();
  const signingIn = context.actions.signIn("new@example.com", "secret");
  context.login.resolve(session("new"));
  await signingIn;
  context.restore.reject(new ApiError(0, "changed", "SESSION_CHANGED"));
  await restoring;
  assert.deepEqual(context.state(), { user: user("new"), loading: false, clears: 0 });
});

it("does not expose a stale bootstrap result after logout", async () => {
  const context = harness();
  const restoring = context.actions.restore();
  const signingOut = context.actions.signOut();
  assert.equal(context.state().user, null);
  context.restore.resolve(user("old"));
  await restoring;
  context.logout.resolve();
  await signingOut;
  assert.equal(context.state().user, null);
});

it("does not let an older logout erase a newer signed-in identity", async () => {
  const context = harness();
  const signingOut = context.actions.signOut();
  const signingIn = context.actions.signIn("new@example.com", "secret");
  context.login.resolve(session("new"));
  await signingIn;
  context.logout.resolve();
  await signingOut;
  assert.equal(context.state().user?.id, "new");
});

it("invalidates pending state updates when authentication is lost or the provider unmounts", async () => {
  for (const stop of ["authLost", "cancel"] as const) {
    const context = harness();
    const signingIn = context.actions.signIn("new@example.com", "secret");
    context.actions[stop]();
    context.login.resolve(session("new"));
    await signingIn;
    assert.equal(context.state().user, null);
  }
});

it("clears a failed current bootstrap but ignores a session-changed error", async () => {
  for (const changed of [false, true]) {
    const context = harness();
    const restoring = context.actions.restore();
    context.restore.reject(new ApiError(changed ? 0 : 401, "expired", changed ? "SESSION_CHANGED" : "HTTP_ERROR"));
    await restoring;
    assert.equal(context.state().clears, changed ? 0 : 1);
    assert.equal(context.state().loading, false);
  }
});
