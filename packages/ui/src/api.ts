const BASE_URL = (import.meta.env?.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

const ACCESS_KEY = "predioon.access";
const REFRESH_KEY = "predioon.refresh";

export type Session = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: "PLATFORM_ADMIN" | "BUILDING_ADMIN" | "RESIDENT";
    memberships: Array<{ buildingId: string; role: "BUILDING_ADMIN" | "RESIDENT" }>;
  };
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const tokens = {
  access: (): string | null => localStorage.getItem(ACCESS_KEY),
  refresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  save(session: Pick<Session, "accessToken" | "refreshToken">): void {
    localStorage.setItem(ACCESS_KEY, session.accessToken);
    localStorage.setItem(REFRESH_KEY, session.refreshToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/**
 * Called when the session cannot be renewed. Without it the panel would keep rendering
 * with empty cards after the refresh token expires, instead of asking for a new login.
 */
let onAuthLost: (() => void) | null = null;

export function setAuthLostHandler(handler: (() => void) | null): void {
  onAuthLost = handler;
}

async function parseError(response: Response): Promise<never> {
  let message = `Erro ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // resposta sem corpo JSON: mantém a mensagem padrão
  }
  throw new ApiError(response.status, message);
}

/** Refreshes once on a 401 and replays the request; a second failure logs the user out. */
async function refreshSession(): Promise<boolean> {
  const refreshToken = tokens.refresh();
  if (!refreshToken) {
    onAuthLost?.();
    return false;
  }

  const response = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    tokens.clear();
    onAuthLost?.();
    return false;
  }

  tokens.save((await response.json()) as Session);
  return true;
}

/** A network failure has no status, so it needs its own readable message. */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(0, `Não foi possível falar com a API em ${BASE_URL}. Verifique se ela está no ar.`);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const access = tokens.access();
  const response = await send(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && (await refreshSession())) {
    return request<T>(path, init, false);
  }

  if (!response.ok) await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  baseUrl: BASE_URL,
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  async login(email: string, password: string): Promise<Session> {
    const response = await send("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) await parseError(response);
    const session = (await response.json()) as Session;
    tokens.save(session);
    return session;
  },

  async logout(): Promise<void> {
    const refreshToken = tokens.refresh();
    if (refreshToken) {
      await fetch(`${BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    tokens.clear();
  },
};
