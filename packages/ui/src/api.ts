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
