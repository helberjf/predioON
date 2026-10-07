import { createWebApiClient } from "@predioon/api-client";
import { browserSessionCoordinator } from "#web-session-coordinator";

export { ApiError } from "@predioon/api-client";
export type { WebSession as Session } from "@predioon/contracts/auth";

const BASE_URL = (import.meta.env?.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
let onAuthLost: (() => void) | null = null;
let onSessionAvailable: (() => void) | null = null;

export function setAuthLostHandler(handler: (() => void) | null): void { onAuthLost = handler; }
export function setSessionAvailableHandler(handler: (() => void) | null): void { onSessionAvailable = handler; }

export const api = createWebApiClient({
  baseUrl: BASE_URL,
  fetch: (input, init) => globalThis.fetch(input, init),
  coordinator: browserSessionCoordinator(BASE_URL),
  onAuthLost: () => onAuthLost?.(),
  onSessionAvailable: () => onSessionAvailable?.(),
});

/** Compatibility access for SSE; credentials exist only in this page's memory. */
export const tokens = { access: () => api.accessToken(), clear: () => api.clearMemory() };

/** Public endpoints: no cookie, token or session renewal is involved. */
async function publicPost<T>(path: string, body: object): Promise<T> {
  let response: Response;
  try {
    response = await globalThis.fetch(`${BASE_URL}${path}`, { method: "POST", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Error("Sem conexão com o servidor. Tente novamente."); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? "Não foi possível concluir. Tente novamente.");
  return data as T;
}
export const openInvitation = <T = void>(step: "preview" | "accept", body: object) => publicPost<T>(`/auth/invitations/${step}`, body);
export const recoverPassword = (step: "forgot" | "reset", body: object) => publicPost<void>(`/auth/password/${step}`, body);
