import { ApiError, type WebApiClient } from "@predioon/api-client";
import type { AuthUser } from "@predioon/contracts/auth";

type Options = {
  api: Pick<WebApiClient, "restore" | "login" | "logout" | "clearMemory">;
  onUserChange(user: AuthUser | null): void;
  onLoadingChange(loading: boolean): void;
  onErrorChange(error: string | null): void;
};

/** Keep React identity updates in the same order as explicit authentication actions. */
export function createAuthActions(options: Options) {
  let generation = 0;

  function clearIdentity() {
    generation++;
    options.onUserChange(null);
    options.onLoadingChange(false);
  }

  async function signOut(): Promise<void> {
    clearIdentity();
    options.onErrorChange(null);
    const expected = generation;
    try { await options.api.logout(); }
    catch (error) {
      if (generation === expected && !(error instanceof ApiError && error.code === "SESSION_CHANGED")) {
        options.onErrorChange("Você saiu deste portal. Não foi possível confirmar a revogação no servidor; ao entrar novamente, vamos concluir essa etapa primeiro.");
      }
    }
  }

  return {
    async restore(): Promise<void> {
      const expected = ++generation;
      options.onLoadingChange(true);
      options.onErrorChange(null);
      try {
        const session = await options.api.restore();
        if (generation === expected) options.onUserChange(session?.user ?? null);
      } catch (error) {
        if (generation === expected && !(error instanceof ApiError && error.code === "SESSION_CHANGED")) {
          options.api.clearMemory();
          options.onUserChange(null);
          if (!(error instanceof ApiError && error.status === 401)) {
            options.onErrorChange(error instanceof Error ? error.message : "Não foi possível recuperar a sessão. Tente novamente.");
          }
        }
      } finally {
        if (generation === expected) options.onLoadingChange(false);
      }
    },

    async signIn(email: string, password: string): Promise<void> {
      clearIdentity();
      options.onErrorChange(null);
      const expected = generation;
      const session = await options.api.login(email, password);
      if (generation === expected) options.onUserChange(session.user);
    },

    signOut,

    /** Completion belongs to the provider, even if its initiating view unmounts.
     * A later login/restore always supersedes this captured identity. */
    async signOutAfter(operation: () => Promise<void>): Promise<void> {
      const expected = generation;
      await operation();
      if (generation === expected) await signOut();
    },

    authLost: clearIdentity,
    cancel(): void { generation++; },
  };
}
