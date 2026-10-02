import type { ApiErrorResponse, Session, SessionTokens } from "@predioon/contracts/auth";

export type { Session, SessionTokens } from "@predioon/contracts/auth";

export type ApiErrorCode = "HTTP_ERROR" | "NETWORK_ERROR" | "SESSION_CHANGED" | "INVALID_RESPONSE";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, message: string, code: ApiErrorCode = "HTTP_ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Implement with a Keychain/Keystore adapter on mobile or browser storage on web. */
export type TokenStorage = {
  getTokens(): Promise<SessionTokens | null>;
  setTokens(tokens: SessionTokens): Promise<void>;
  clearTokens(): Promise<void>;
};

export type ApiClientOptions = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  storage: TokenStorage;
  onAuthLost?: () => void;
};

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  let version = 0;
  let storageQueue: Promise<unknown> = Promise.resolve();
  let refreshInFlight: { version: number; promise: Promise<void> } | null = null;

  // Serialize async persistence too: a slow old write must finish before a new clear/save.
  function stored<T>(operation: () => Promise<T>): Promise<T> {
    const pending = storageQueue.then(operation);
    storageQueue = pending.catch(() => undefined);
    return pending;
  }

  function assertCurrent(expected: number): void {
    if (version !== expected) throw new ApiError(0, "A sessão mudou. Tente novamente.", "SESSION_CHANGED");
  }

  async function readTokens(expected: number): Promise<SessionTokens | null> {
    const tokens = await stored(async () => {
      assertCurrent(expected);
      return options.storage.getTokens();
    });
    assertCurrent(expected);
    return tokens;
  }

  async function saveTokens(session: SessionTokens, expected: number): Promise<void> {
    await stored(async () => {
      assertCurrent(expected);
      await options.storage.setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    });
    assertCurrent(expected);
  }

  async function loseSession(expected: number): Promise<void> {
    assertCurrent(expected);
    const clearedVersion = ++version;
    await stored(async () => {
      assertCurrent(clearedVersion);
      await options.storage.clearTokens();
    });
    assertCurrent(clearedVersion);
    options.onAuthLost?.();
  }

  function networkError(): ApiError {
    return new ApiError(0, `Não foi possível falar com a API em ${baseUrl}. Verifique sua conexão e tente novamente.`, "NETWORK_ERROR");
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await options.fetch(`${baseUrl}${path}`, init);
    } catch {
      // A failed transport can have reached the server. Never replay it automatically.
      throw networkError();
    }
  }

  async function readJson<T>(response: Response, expected: number): Promise<T> {
    let body: T;
    try {
      body = await response.json() as T;
    } catch (error) {
      assertCurrent(expected);
      if (error instanceof SyntaxError) throw new ApiError(response.status, "A API retornou uma resposta JSON inválida.", "INVALID_RESPONSE");
      // Fetch can resolve headers before the response stream loses its connection.
      throw networkError();
    }
    assertCurrent(expected);
    return body;
  }

  async function responseError(response: Response): Promise<ApiError> {
    let message = `Erro ${response.status}`;
    try {
      const body = await response.json() as Partial<ApiErrorResponse>;
      if (typeof body.error === "string") message = body.error;
    } catch { /* Keep the status for proxy errors and empty responses. */ }
    return new ApiError(response.status, message);
  }

  function json(body: unknown): RequestInit {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  async function renewSession(expected: number): Promise<void> {
    const tokens = await readTokens(expected);
    assertCurrent(expected);
    if (!tokens?.refreshToken) {
      await loseSession(expected);
      throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
    }
    assertCurrent(expected);
    const response = await send("/auth/refresh", json({ refreshToken: tokens.refreshToken }));
    assertCurrent(expected);
    if (!response.ok) {
      const error = await responseError(response);
      assertCurrent(expected);
      // Transport/temporary server failures do not destroy recoverable credentials.
      if (response.status === 401 || response.status === 403) await loseSession(expected);
      throw error;
    }
    const session = await readJson<SessionTokens>(response, expected);
    await saveTokens(session, expected);
  }

  function refreshSession(expected: number): Promise<void> {
    assertCurrent(expected);
    if (refreshInFlight?.version === expected) return refreshInFlight.promise;
    const promise = renewSession(expected).finally(() => {
      if (refreshInFlight?.promise === promise) refreshInFlight = null;
    });
    refreshInFlight = { version: expected, promise };
    return promise;
  }

  async function request<T>(path: string, init: RequestInit = {}, retry = true, expected = version): Promise<T> {
    const tokens = await readTokens(expected);
    assertCurrent(expected);
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    assertCurrent(expected);
    const response = await send(path, { ...init, headers });
    assertCurrent(expected);
    if (response.status === 401 && retry) {
      const currentTokens = await readTokens(expected);
      assertCurrent(expected);
      // A late 401 can arrive after another request already completed rotation.
      if (!currentTokens?.accessToken || currentTokens.accessToken === tokens?.accessToken) await refreshSession(expected);
      assertCurrent(expected);
      return request<T>(path, init, false, expected);
    }
    if (!response.ok) {
      const error = await responseError(response);
      assertCurrent(expected);
      if (response.status === 401) await loseSession(expected);
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return readJson<T>(response, expected);
  }

  return {
    baseUrl,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, json(body ?? {})),
    put: <T>(path: string, body: unknown) => request<T>(path, { ...json(body), method: "PUT" }),
    patch: <T>(path: string, body: unknown) => request<T>(path, { ...json(body), method: "PATCH" }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

    /** Invalidate pending operations before legacy adapters mutate their own storage. */
    invalidateSession(): void { version++; },

    async login(email: string, password: string): Promise<Session> {
      const expected = ++version;
      await stored(async () => { assertCurrent(expected); await options.storage.clearTokens(); });
      assertCurrent(expected);
      const response = await send("/auth/login", json({ email, password }));
      assertCurrent(expected);
      if (!response.ok) throw await responseError(response);
      const session = await readJson<Session>(response, expected);
      await saveTokens(session, expected);
      return session;
    },

    async logout(): Promise<void> {
      const expected = ++version;
      const tokens = await stored(async () => {
        assertCurrent(expected);
        const current = await options.storage.getTokens();
        assertCurrent(expected);
        await options.storage.clearTokens();
        return current;
      });
      // Local logout is complete before revocation, even if the server is unavailable.
      if (tokens?.refreshToken) await send("/auth/logout", json({ refreshToken: tokens.refreshToken })).catch(() => undefined);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
