import type { ApiErrorResponse } from "@predioon/contracts/auth";
import { ApiError } from "#errors";

export type CredentialStorage<C> = {
  getTokens(): Promise<C | null>;
  setTokens(tokens: C): Promise<void>;
  clearTokens(): Promise<void>;
};
export type AuthOperation = "login" | "refresh" | "logout";
type AuthRequest = { path: string; init: RequestInit };
export type AuthGate = <T>(operation: () => Promise<T>) => Promise<T>;
type Options<C extends { accessToken: string }, S extends C> = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  storage: CredentialStorage<C>;
  onAuthLost?: () => void;
  assertSession?: () => void;
  /** Capture the caller's identity before any asynchronous work starts. */
  authGate?: (operation: AuthOperation) => AuthGate;
  domainCredentials?: RequestCredentials;
  authTimeoutMs?: number;
  protocol: {
    login(email: string, password: string): AuthRequest;
    beforeLogin?: () => AuthRequest;
    refresh(tokens: C | null): AuthRequest | null;
    logout(tokens: C | null): AuthRequest | null;
    credentials(session: S): C;
    ignoreLogoutFailure: boolean;
  };
};

/** Shared request/version/rotation pipeline. Native and cookie sessions supply only their protocol. */
export function createBearerClient<C extends { accessToken: string }, S extends C>(options: Options<C, S>) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  let version = 0;
  let storageQueue: Promise<unknown> = Promise.resolve();
  let refreshInFlight: { version: number; promise: Promise<void> } | null = null;
  const direct: AuthGate = operation => operation();

  function stored<T>(operation: () => Promise<T>): Promise<T> {
    const pending = storageQueue.then(operation);
    storageQueue = pending.catch(() => undefined);
    return pending;
  }
  function assertCurrent(expected: number): void {
    options.assertSession?.();
    if (version !== expected) throw new ApiError(0, "A sessão mudou. Tente novamente.", "SESSION_CHANGED");
  }
  async function readTokens(expected: number): Promise<C | null> {
    const tokens = await stored(async () => { assertCurrent(expected); return options.storage.getTokens(); });
    assertCurrent(expected);
    return tokens;
  }
  async function saveTokens(session: S, expected: number): Promise<void> {
    await stored(async () => { assertCurrent(expected); await options.storage.setTokens(options.protocol.credentials(session)); });
    assertCurrent(expected);
  }
  async function loseSession(expected: number): Promise<void> {
    assertCurrent(expected);
    const clearedVersion = ++version;
    await stored(async () => { assertCurrent(clearedVersion); await options.storage.clearTokens(); });
    assertCurrent(clearedVersion);
    options.onAuthLost?.();
  }
  function networkError(): ApiError {
    return new ApiError(0, `Não foi possível falar com a API em ${baseUrl}. Verifique sua conexão e tente novamente.`, "NETWORK_ERROR");
  }
  async function send(path: string, init: RequestInit): Promise<Response> {
    try { return await options.fetch(`${baseUrl}${path}`, init); }
    catch { throw networkError(); }
  }
  async function readJson<T>(response: Response, expected: number, signal?: AbortSignal): Promise<T> {
    let body: T;
    try { body = await response.json() as T; }
    catch (error) {
      assertCurrent(expected);
      if (signal?.aborted) throw networkError();
      if (error instanceof SyntaxError) throw new ApiError(response.status, "A API retornou uma resposta JSON inválida.", "INVALID_RESPONSE");
      throw networkError();
    }
    assertCurrent(expected);
    if (signal?.aborted) throw networkError();
    return body;
  }
  async function authDeadline<T>(run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    if (!options.authTimeoutMs) return run();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(networkError()); }, options.authTimeoutMs);
    });
    try { return await Promise.race([run(controller.signal), timeout]); }
    finally { clearTimeout(timer!); }
  }
  async function responseError(response: Response): Promise<ApiError> {
    let message = `Erro ${response.status}`;
    try {
      const body = await response.json() as Partial<ApiErrorResponse>;
      if (typeof body.error === "string") message = body.error;
    } catch { /* Retain status for proxy errors and empty responses. */ }
    return new ApiError(response.status, message);
  }
  function json(body: unknown): RequestInit {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }
  async function checkedAuth(request: AuthRequest, expected: number, signal?: AbortSignal): Promise<Response> {
    assertCurrent(expected);
    if (signal?.aborted) throw networkError();
    const response = await send(request.path, { ...request.init, ...(signal ? { signal } : {}) });
    assertCurrent(expected);
    if (signal?.aborted) throw networkError();
    return response;
  }
  async function renewSession(expected: number): Promise<void> {
    const gate = options.authGate?.("refresh") ?? direct;
    return gate(() => authDeadline(async signal => {
      const tokens = await readTokens(expected);
      const request = options.protocol.refresh(tokens);
      if (!request) {
        await loseSession(expected);
        throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
      }
      const response = await checkedAuth(request, expected, signal);
      if (!response.ok) {
        const error = await responseError(response);
        assertCurrent(expected);
        if (signal?.aborted) throw networkError();
        if (response.status === 401 || response.status === 403) await loseSession(expected);
        throw error;
      }
      await saveTokens(await readJson<S>(response, expected, signal), expected);
    }));
  }
  function refreshSession(expected: number): Promise<void> {
    assertCurrent(expected);
    if (refreshInFlight?.version === expected) return refreshInFlight.promise;
    const promise = renewSession(expected).finally(() => { if (refreshInFlight?.promise === promise) refreshInFlight = null; });
    refreshInFlight = { version: expected, promise };
    return promise;
  }
  async function request<T>(path: string, init: RequestInit = {}, retry = true, expected = version): Promise<T> {
    const tokens = await readTokens(expected);
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (tokens?.accessToken) headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    assertCurrent(expected);
    const response = await send(path, { ...init, headers, ...(options.domainCredentials ? { credentials: options.domainCredentials } : {}) });
    assertCurrent(expected);
    if (response.status === 401 && retry) {
      const currentTokens = await readTokens(expected);
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
    invalidateSession(): void { version++; },
    async restore(): Promise<C | null> {
      const expected = version;
      await refreshSession(expected);
      return readTokens(expected);
    },
    async login(email: string, password: string): Promise<S> {
      const expected = ++version;
      const gate = options.authGate?.("login") ?? direct;
      await stored(async () => { assertCurrent(expected); await options.storage.clearTokens(); });
      return gate(() => authDeadline(async signal => {
        if (options.protocol.beforeLogin) {
          const revoked = await checkedAuth(options.protocol.beforeLogin(), expected, signal);
          if (!revoked.ok) { const error = await responseError(revoked); assertCurrent(expected); if (signal?.aborted) throw networkError(); throw error; }
        }
        const response = await checkedAuth(options.protocol.login(email, password), expected, signal);
        if (!response.ok) { const error = await responseError(response); assertCurrent(expected); if (signal?.aborted) throw networkError(); throw error; }
        const session = await readJson<S>(response, expected, signal);
        await saveTokens(session, expected);
        return session;
      }));
    },
    async logout(): Promise<void> {
      const expected = ++version;
      const gate = options.authGate?.("logout") ?? direct;
      const tokens = await stored(async () => {
        assertCurrent(expected);
        const current = await options.storage.getTokens();
        assertCurrent(expected);
        await options.storage.clearTokens();
        return current;
      });
      const pending = gate(() => authDeadline(async signal => {
        const request = options.protocol.logout(tokens);
        if (!request) return;
        // Native logout retains its local-first best-effort behavior.
        const response = options.protocol.ignoreLogoutFailure ? await send(request.path, request.init) : await checkedAuth(request, expected, signal);
        if (!options.protocol.ignoreLogoutFailure && !response.ok) { const error = await responseError(response); assertCurrent(expected); throw error; }
      }));
      if (options.protocol.ignoreLogoutFailure) await pending.catch(() => undefined);
      else await pending;
    },
  };
}
