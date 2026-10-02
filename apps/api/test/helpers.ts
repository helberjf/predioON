import type { Server } from "node:http";
import { after } from "node:test";
import { closeIdentityDb } from "@predioon/db/identity";
import { closeBrokerAuthDb } from "@predioon/db/broker-auth";
import { app } from "../src/app.js";

// Some files host multiple suites: close shared authentication pools only after
// every suite has finished, never when an individual HTTP test server closes.
after(async () => { await Promise.all([closeIdentityDb(), closeBrokerAuthDb()]); });

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

export { login, type Session } from "./fixture-login.js";

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
