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
const session = (id: string) => ({ accessToken: id, user: user(id) });

function harness() {
  const restore = deferred<ReturnType<typeof session> | null>();
  const login = deferred<ReturnType<typeof session>>();
  const logout = deferred<void>();
  let currentUser: ReturnType<typeof user> | null = user("old");
  let loading = true;
  let clears = 0;
  let error: string | null = null;
  let sessionResets = 0;
  const actions = createAuthActions({
    api: { restore: async () => restore.promise, login: async () => login.promise, logout: async () => logout.promise, clearMemory: () => { clears++; } },
    onUserChange: next => { currentUser = next; },
    onLoadingChange: next => { loading = next; },
    onErrorChange: next => { error = next; },
    onSessionReset: () => { sessionResets++; },
  });
  return { actions, restore, login, logout, state: () => ({ user: currentUser, loading, clears }), error: () => error, sessionResets: () => sessionResets };
}

it("invalidates session-owned physical intents before login, restore, logout, auth loss or provider cancellation can finish", async () => {
  const context = harness();
  const restoring = context.actions.restore(); assert.equal(context.sessionResets(),1);
  const signingIn = context.actions.signIn("new@example.com","secret"); assert.equal(context.sessionResets(),2);
  context.actions.authLost(); assert.equal(context.sessionResets(),3);
  context.actions.cancel(); assert.equal(context.sessionResets(),4);
  const signingOut = context.actions.signOut(); assert.equal(context.sessionResets(),5);
  context.login.resolve(session("new")); context.restore.resolve(session("old")); context.logout.resolve();
  await Promise.all([restoring,signingIn,signingOut]);
  assert.equal(context.state().user,null); assert.equal(context.sessionResets(),5);
});

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
  context.restore.resolve(session("old"));
  await restoring;
  context.logout.resolve();
  await signingOut;
  assert.equal(context.state().user, null);
});

it("restores the HttpOnly session without a pre-existing access token", async () => {
  const context = harness();
  const restoring = context.actions.restore();
  context.restore.resolve(session("cookie-user")); await restoring;
  assert.equal(context.state().user?.id, "cookie-user");
  assert.equal(context.state().loading, false);
});

it("reports transient restore failure while preserving recovery and reports incomplete server logout", async () => {
  const context = harness();
  const restoring = context.actions.restore();
  context.restore.reject(new ApiError(0, "offline", "NETWORK_ERROR")); await restoring;
  assert.equal(context.error(), "offline");
  assert.equal(context.state().user, null);
  const logout = context.actions.signOut();
  context.logout.reject(new ApiError(0, "offline", "NETWORK_ERROR")); await logout;
  assert.match(context.error()!, /revogação no servidor/);
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
