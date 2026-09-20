import type { Server } from "node:http";
import { app } from "../src/app.js";

export type TestServer = { url: string; close: () => Promise<void> };

/** Starts the real app on an ephemeral port, so tests exercise the same middleware chain as production. */
export async function startTestServer(): Promise<TestServer> {
  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Servidor de teste sem porta");

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type Session = { accessToken: string; refreshToken: string; user: { id: string; role: string } };

export async function login(url: string, email: string, password = "predioon123"): Promise<Session> {
  const response = await fetch(`${url}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Login falhou para ${email}: ${response.status}`);
  return (await response.json()) as Session;
}

type RequestOptions = { method?: string; token?: string; body?: unknown };

export async function call(url: string, path: string, options: RequestOptions = {}): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Unique suffix so repeated runs never collide on unique columns. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
