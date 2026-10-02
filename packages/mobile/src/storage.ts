import type { SessionTokens, TokenStorage } from "@predioon/api-client";

/** The native adapter is injected so persistence can be checked without a simulator. */
export type SecureRefreshStore = {
  read(): Promise<string | null>;
  write(refreshToken: string): Promise<void>;
  remove(): Promise<void>;
};

export function createMobileTokenStorage(
  secure: SecureRefreshStore,
): TokenStorage {
  let accessToken = "";
  return {
    async getTokens(): Promise<SessionTokens | null> {
      const refreshToken = await secure.read();
      return refreshToken ? { accessToken, refreshToken } : null;
    },
    async setTokens(tokens): Promise<void> {
      // Persist rotation before publishing the access token to other requests.
      await secure.write(tokens.refreshToken);
      accessToken = tokens.accessToken;
    },
    async clearTokens(): Promise<void> {
      accessToken = "";
      await secure.remove();
    },
  };
}
