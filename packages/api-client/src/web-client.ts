import type { WebSession } from "@predioon/contracts/auth";
import { createBearerClient, type AuthGate, type AuthOperation } from "#engine";
import { ApiError } from "#errors";

/** Coordination stores identity epochs and logout intent only, never credentials. */
export type WebSessionCoordinator = {
  assertCurrent(): void;
  blocked(): boolean;
  beginIdentityChange(): void;
  blockSession(): void;
  gate(operation: AuthOperation): AuthGate;
  subscribe(listener: (available: boolean) => void): () => void;
};
export type WebApiClientOptions = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  coordinator: WebSessionCoordinator;
  onAuthLost?: () => void;
  onSessionAvailable?: () => void;
  authTimeoutMs?: number;
};

export function createWebApiClient(options: WebApiClientOptions) {
  let session: WebSession | null = null;
  let intent = 0;
  const { coordinator } = options;
  const webRequest = (path: string, body: unknown = {}) => ({
    path: `/auth/web/${path}`,
    init: {
      method: "POST", credentials: "include" as const, cache: "no-store" as const, redirect: "error" as const,
      headers: { "Content-Type": "application/json", "X-Predioon-Web": "1" }, body: JSON.stringify(body),
    },
  });
  const core = createBearerClient<WebSession, WebSession>({
    baseUrl: options.baseUrl, fetch: options.fetch, domainCredentials: "omit", authTimeoutMs: options.authTimeoutMs ?? 20_000,
    storage: {
      async getTokens() { return session; },
      async setTokens(value) { session = { accessToken: value.accessToken, user: value.user }; },
      async clearTokens() { session = null; },
    },
    assertSession: () => coordinator.assertCurrent(),
    authGate: operation => coordinator.gate(operation),
    onAuthLost: () => { session = null; coordinator.blockSession(); options.onAuthLost?.(); },
    protocol: {
      beforeLogin: () => webRequest("logout"),
      login: (email, password) => webRequest("login", { email, password }),
      refresh: () => coordinator.blocked() ? null : webRequest("refresh"),
      logout: () => webRequest("logout"),
      credentials: value => ({ accessToken: value.accessToken, user: value.user }),
      ignoreLogoutFailure: false,
    },
  });
  const unsubscribe = coordinator.subscribe(available => {
    invalidate();
    options.onAuthLost?.();
    if (available) options.onSessionAvailable?.();
  });
  function invalidate() { intent++; session = null; core.invalidateSession(); }
  return {
    ...core,
    /** Synchronous memory access is needed for SSE; nothing is persisted. */
    accessToken(): string | null {
      try { coordinator.assertCurrent(); return session?.accessToken ?? null; }
      catch (error) {
        if (!(error instanceof ApiError)) throw error;
        invalidate(); options.onAuthLost?.(); return null;
      }
    },
    async restore(): Promise<WebSession | null> {
      coordinator.assertCurrent();
      if (coordinator.blocked()) return null;
      return core.restore();
    },
    async login(email: string, password: string): Promise<WebSession> {
      invalidate();
      const expected = intent;
      try {
        coordinator.beginIdentityChange();
        return await core.login(email, password);
      } catch (error) {
        // A storage/coordination failure after the HTTP response must not leave
        // usable credentials behind, nor clear a newer explicit identity.
        if (intent === expected) invalidate();
        throw error;
      }
    },
    async logout(): Promise<void> {
      invalidate();
      coordinator.beginIdentityChange();
      await core.logout();
    },
    clearMemory: invalidate,
    dispose(): void { invalidate(); unsubscribe(); },
  };
}
export type WebApiClient = ReturnType<typeof createWebApiClient>;
