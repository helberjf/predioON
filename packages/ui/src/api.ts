import { createApiClient } from "@predioon/api-client";
import type { SessionTokens } from "@predioon/contracts/auth";

export { ApiError } from "@predioon/api-client";
export type { Session } from "@predioon/contracts/auth";

const BASE_URL = (import.meta.env?.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
const ACCESS_KEY = "predioon.access";
const REFRESH_KEY = "predioon.refresh";

function saveTokens(session: SessionTokens): void {
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
}

function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/** Synchronous compatibility accessors are used when opening the SSE connection. */
export const tokens = {
  access: (): string | null => localStorage.getItem(ACCESS_KEY),
  refresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  save(session: SessionTokens): void {
    api.invalidateSession();
    saveTokens(session);
  },
  clear(): void {
    api.invalidateSession();
    clearTokens();
  },
};

let onAuthLost: (() => void) | null = null;

export function setAuthLostHandler(handler: (() => void) | null): void {
  onAuthLost = handler;
}

export const api = createApiClient({
  baseUrl: BASE_URL,
  fetch: (input, init) => globalThis.fetch(input, init),
  storage: {
    async getTokens() {
      const accessToken = tokens.access();
      const refreshToken = tokens.refresh();
      return refreshToken ? { accessToken: accessToken ?? "", refreshToken } : null;
    },
    async setTokens(session) { saveTokens(session); },
    async clearTokens() { clearTokens(); },
  },
  onAuthLost: () => onAuthLost?.(),
});
