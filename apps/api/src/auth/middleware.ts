import type { Request, RequestHandler } from "express";
import { withUserContext, type AppTransaction } from "@predioon/db";
import { hasAtLeast, type Role } from "@predioon/shared";
import { forbidden, unauthorized } from "../http/errors.js";
import { verifyAccessToken, type AccessTokenClaims } from "./tokens.js";

export type Auth = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  memberships: AccessTokenClaims["memberships"];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: Auth;
    }
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(unauthorized("Token de acesso ausente"));

  const claims = await verifyAccessToken(token);
  if (!claims) return next(unauthorized("Token de acesso inválido ou expirado"));

  req.auth = {
    userId: claims.sub,
    name: claims.name,
    email: claims.email,
    role: claims.role,
    memberships: claims.memberships,
  };
  next();
};

export function currentAuth(req: Request): Auth {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export const requireRole = (minimum: Role): RequestHandler => (req, _res, next) => {
  const auth = currentAuth(req);
  if (!hasAtLeast(auth.role, minimum)) return next(forbidden());
  next();
};

/** Role the user holds in one specific building, or null when they have no link to it. */
export function buildingRole(auth: Auth, buildingId: string): Role | null {
  if (auth.role === "PLATFORM_ADMIN") return "PLATFORM_ADMIN";
  return auth.memberships.find((link) => link.buildingId === buildingId)?.role ?? null;
}

export function assertBuildingAccess(auth: Auth, buildingId: string, minimum: Role = "RESIDENT"): void {
  const role = buildingRole(auth, buildingId);
  // 404-style message on purpose: a user must not learn that a building id exists.
  if (!role || !hasAtLeast(role, minimum)) throw forbidden("Prédio fora do seu escopo");
}

/** Buildings the user can read. Empty array for a platform admin means "all buildings". */
export function scopedBuildingIds(auth: Auth): string[] | null {
  return auth.role === "PLATFORM_ADMIN" ? null : auth.memberships.map((link) => link.buildingId);
}

/** Every authenticated query runs here, so PostgreSQL RLS sees who is asking. */
export function inTenantContext<T>(req: Request, fn: (tx: AppTransaction) => Promise<T>): Promise<T> {
  const auth = currentAuth(req);
  return withUserContext({ userId: auth.userId, role: auth.role }, fn);
}
