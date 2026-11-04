import type { InvitationAcceptRequest, InvitationPreview, InvitationPreviewRequest, PasswordForgotRequest, Session, SessionTokens } from "@predioon/contracts/auth";
import type { ReservationAvailabilityQuery } from "@predioon/contracts";
import { createBearerClient, type CredentialStorage, type MfaRestriction } from "#engine";
import { ApiError } from "#errors";

export type { MfaRestriction } from "#engine";
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
  onMfaRequired?: (restriction: MfaRestriction) => void;
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

/**
 * Public invitation steps for the native resident app (the portal has its own
 * screen). No session, cookie or stored credential is involved; the API's
 * message is shown as is, because it already avoids revealing more than needed.
 */
async function publicInvitationStep(options: Pick<ApiClientOptions, "baseUrl" | "fetch">, step: "preview" | "accept", body: InvitationPreviewRequest | InvitationAcceptRequest, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await options.fetch(`${options.baseUrl.replace(/\/+$/, "")}/auth/invitations/${step}`, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor. Tente novamente.", "NETWORK_ERROR");
  }
  if (response.ok) return response;
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  const message = response.status === 429 ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
    : typeof data?.error === "string" && data.error.length <= 200 ? data.error : "Não foi possível concluir. Tente novamente.";
  throw new ApiError(response.status, message, "HTTP_ERROR");
}

export async function previewInvitation(options: Pick<ApiClientOptions, "baseUrl" | "fetch">, token: string, signal?: AbortSignal): Promise<InvitationPreview> {
  const response = await publicInvitationStep(options, "preview", { token: token.trim() }, signal);
  const data = await response.json().catch(() => null) as Partial<InvitationPreview> | null;
  if (!data || typeof data.email !== "string" || typeof data.name !== "string" || typeof data.buildingName !== "string"
    || typeof data.accountExists !== "boolean" || typeof data.expiresAt !== "string") {
    throw new ApiError(response.status, "A API retornou uma resposta inválida.", "INVALID_RESPONSE");
  }
  return { email: data.email, name: data.name, buildingName: data.buildingName, accountExists: data.accountExists, expiresAt: data.expiresAt };
}

export async function acceptInvitation(options: Pick<ApiClientOptions, "baseUrl" | "fetch">, token: string, password: string, signal?: AbortSignal): Promise<void> {
  const response = await publicInvitationStep(options, "accept", { token: token.trim(), password }, signal);
  if (response.status !== 204) throw new ApiError(response.status, "A API retornou uma resposta inválida.", "INVALID_RESPONSE");
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
