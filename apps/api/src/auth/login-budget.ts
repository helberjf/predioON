import type { RequestHandler } from "express";
import { identitySqlClient } from "@predioon/db/identity";
import { config } from "../config.js";
import { HttpError } from "../http/errors.js";
import { loginBudgetKeys } from "./login-budget-keys.js";
import { currentAuth } from "./middleware.js";

/** A short committed transaction ends before credentials or Argon2 are read. */
export async function takeLoginBudget(email: string, address: string | null | undefined): Promise<number> {
  const keys = loginBudgetKeys(config.authRateLimitKey, email, address);
  try {
    const decision = await identitySqlClient.begin(async tx => {
      await tx`set local statement_timeout='2s'`;
      const [row] = await tx`select public.identity_take_login_budget(${keys.network},${keys.account}) as retry_after`;
      if (!row || !Number.isSafeInteger(row.retry_after) || row.retry_after < 0) throw new Error("Invalid budget decision");
      return row.retry_after as number;
    });
    return decision;
  } catch {
    // Driver errors may contain query parameters/connection details. Expose no
    // cause, credentials or budget keys, and never proceed without admission.
    throw new HttpError(503, "Entrada temporariamente indisponível. Tente novamente em instantes.");
  }
}

/** Mount only after the login schema and, for web, the origin/CSRF checks. */
function admission(email: (req: Parameters<RequestHandler>[0]) => string): RequestHandler {
 return async (req, res, next) => {
  const retryAfter = await takeLoginBudget(email(req), req.ip);
  if (retryAfter > 0) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Muitas tentativas de entrada. Aguarde e tente novamente." });
    return;
  }
  next();
 };
}
export const admitLogin = admission(req => req.body.email);
/** Identity is authenticated before this middleware; no body field selects the bucket. */
export const admitPasswordChange = admission(req => currentAuth(req).email);
