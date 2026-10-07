import type { PasswordForgotRequest, Session, SessionTokens } from "@predioon/contracts/auth";
import type { ReservationAvailabilityQuery } from "@predioon/contracts";
import { createBearerClient, type CredentialStorage } from "#engine";
import { ApiError } from "#errors";

export { ApiError, type ApiErrorCode } from "#errors";
export type { PasswordChangeRequest, Session, SessionTokens, WebSession } from "@predioon/contracts/auth";
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

/** Public recovery deliberately bypasses authenticated storage and session effects. */
export async function requestPasswordRecovery(
  options: Pick<ApiClientOptions, "baseUrl" | "fetch">,
  email: string,
  signal?: AbortSignal,
): Promise<void> {
  const generic = "Não foi possível solicitar a recuperação. Tente novamente mais tarde.";
  const body: PasswordForgotRequest = { email: email.trim().toLowerCase() };
  let response: Response;
  try {
    response = await options.fetch(`${options.baseUrl.replace(/\/+$/, "")}/auth/password/forgot`, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
  } catch {
    throw new ApiError(0, generic, "NETWORK_ERROR");
  }
  if (response.status === 204) return;
  const message = response.status === 400 ? "Informe um e-mail válido."
    : response.status === 429 ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
    : generic;
  throw new ApiError(response.status, message,
    response.status >= 200 && response.status < 300 ? "INVALID_RESPONSE" : "HTTP_ERROR");
}

function authRequest(path: string, body: unknown) {
  return { path, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } };
}
/** Native facade: endpoint, persistence and logout semantics remain unchanged. */
export function createApiClient(options: ApiClientOptions) {
  const { restore: _restore, ...client } = createBearerClient<SessionTokens, Session>({
    ...options,
    protocol: {
      login: (email, password, code) => authRequest("/auth/login", code ? { email, password, code } : { email, password }),
      refresh: tokens => tokens?.refreshToken ? authRequest("/auth/refresh", { refreshToken: tokens.refreshToken }) : null,
      logout: tokens => tokens?.refreshToken ? authRequest("/auth/logout", { refreshToken: tokens.refreshToken }) : null,
      password: body => authRequest("/auth/password", body),
      credentials: session => ({ accessToken: session.accessToken, refreshToken: session.refreshToken }),
      ignoreLogoutFailure: true,
    },
  });
  return client;
}
export type ApiClient = ReturnType<typeof createApiClient>;
