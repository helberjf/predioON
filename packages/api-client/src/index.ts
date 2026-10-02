import type { Session, SessionTokens } from "@predioon/contracts/auth";
import type { ReservationAvailabilityQuery } from "@predioon/contracts";
import { createBearerClient, type CredentialStorage } from "#engine";

export { ApiError, type ApiErrorCode } from "#errors";
export type { Session, SessionTokens, WebSession } from "@predioon/contracts/auth";
export { createWebApiClient, type WebApiClient, type WebApiClientOptions, type WebSessionCoordinator } from "#web-client";

/** Shared by web/native callers; values can never become extra query parameters. */
export function reservationAvailabilityPath(query: ReservationAvailabilityQuery): string {
  return `/reservations/availability?${new URLSearchParams({
    buildingId: query.buildingId, areaId: query.areaId, from: query.from, to: query.to,
  })}`;
}

/** Native credentials belong in a Keychain/Keystore adapter. */
export type TokenStorage = CredentialStorage<SessionTokens>;
export type ApiClientOptions = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  storage: TokenStorage;
  onAuthLost?: () => void;
};
function authRequest(path: string, body: unknown) {
  return { path, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } };
}
/** Native facade: endpoint, persistence and logout semantics remain unchanged. */
export function createApiClient(options: ApiClientOptions) {
  const { restore: _restore, ...client } = createBearerClient<SessionTokens, Session>({
    ...options,
    protocol: {
      login: (email, password) => authRequest("/auth/login", { email, password }),
      refresh: tokens => tokens?.refreshToken ? authRequest("/auth/refresh", { refreshToken: tokens.refreshToken }) : null,
      logout: tokens => tokens?.refreshToken ? authRequest("/auth/logout", { refreshToken: tokens.refreshToken }) : null,
      credentials: session => ({ accessToken: session.accessToken, refreshToken: session.refreshToken }),
      ignoreLogoutFailure: true,
    },
  });
  return client;
}
export type ApiClient = ReturnType<typeof createApiClient>;
