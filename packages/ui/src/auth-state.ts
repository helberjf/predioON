import { ApiError, type ApiClient } from "@predioon/api-client";
import type { AuthUser } from "@predioon/contracts/auth";

type Options = {
  api: Pick<ApiClient, "get" | "login" | "logout">;
  tokens: { access(): string | null; clear(): void };
  onUserChange(user: AuthUser | null): void;
  onLoadingChange(loading: boolean): void;
};

/** Keep React identity updates in the same order as explicit authentication actions. */
export function createAuthActions(options: Options) {
  let generation = 0;

  function clearIdentity() {
    generation++;
    options.onUserChange(null);
    options.onLoadingChange(false);
  }

  return {
    async restore(): Promise<void> {
      const expected = ++generation;
      options.onLoadingChange(true);
      try {
        const user = options.tokens.access() ? await options.api.get<AuthUser>("/auth/me") : null;
        if (generation === expected) options.onUserChange(user);
      } catch (error) {
        if (generation === expected && !(error instanceof ApiError && error.code === "SESSION_CHANGED")) {
          options.tokens.clear();
          options.onUserChange(null);
        }
      } finally {
        if (generation === expected) options.onLoadingChange(false);
      }
    },

    async signIn(email: string, password: string): Promise<void> {
      clearIdentity();
      const expected = generation;
      const session = await options.api.login(email, password);
      if (generation === expected) options.onUserChange(session.user);
    },

    async signOut(): Promise<void> {
      clearIdentity();
      await options.api.logout();
    },

    authLost: clearIdentity,
    cancel(): void { generation++; },
  };
}
