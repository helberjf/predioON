import type { Request, RequestHandler } from "express";
import { lockFeatures, withUserContext, type AppTransaction } from "@predioon/db/runtime";
import { hasAtLeast, type Capability, type ResourceType, type Role } from "@predioon/shared";
import { sql } from "drizzle-orm";
import { forbidden, unauthorized } from "../http/errors.js";
import { verifyAccessToken } from "./tokens.js";
import { resolveIdentity, type Identity } from "./service.js";

export type Auth = Identity & { sessionId: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: Auth; }
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(unauthorized("Token de acesso ausente"));
  const claims = await verifyAccessToken(token);
  if (!claims) return next(unauthorized("Token de acesso inválido ou expirado"));
  req.auth = { ...(await resolveIdentity(claims)), sessionId: claims.sid };
  next();
};

export function currentAuth(req: Request): Auth {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Compatibility guard for routes that still use the three legacy roles. */
export const requireRole = (minimum: Role): RequestHandler => (req, _res, next) => {
  const auth = currentAuth(req);
  if (!hasAtLeast(auth.role, minimum)) return next(forbidden());
  next();
};

/**
 * Explicit capability authorization for new routes. The decision is made by
 * PostgreSQL from active bindings, teams, support grants and resource scope;
 * no ordinal role comparison is involved.
 */
export async function capabilityAllowed(
  tx: AppTransaction,
  capability: Capability,
  buildingId: string,
  resource?: { type: ResourceType; id?: string | null },
): Promise<boolean> {
  const rows = await tx.execute(sql`select app_has_capability(${buildingId}, ${capability}, ${resource?.type ?? null}, ${resource?.id ?? null}) as allowed`);
  return Boolean((rows[0] as { allowed?: boolean } | undefined)?.allowed);
}
/** Check authorization in the same transaction as the protected read/write. */
export async function assertCapability(tx: AppTransaction, capability: Capability, buildingId: string, resource?: { type: ResourceType; id: string }): Promise<void> {
  if (!(await capabilityAllowed(tx, capability, buildingId, resource))) throw forbidden("Sem a capacidade necessária para este recurso");
}

/** Global capabilities are live database grants, including explicit platform bindings. */
export async function assertGlobalCapability(tx: AppTransaction, capability: Capability): Promise<void> {
  const [row] = await tx.execute(sql`select app_has_global_capability(${capability}) as allowed`);
  if (!row?.allowed) throw forbidden("Sem a capacidade global necessária");
}

/** Basic tenant discovery does not grant access to private operational domains. */
export async function assertBuildingDiscovery(tx: AppTransaction, buildingId: string): Promise<void> {
  const [row] = await tx.execute(sql`select app_can_discover_building(${buildingId}) as allowed`);
  if (!row?.allowed) throw forbidden("Prédio fora do seu escopo");
}

/** Role the user holds in one specific building, or null when they have no link to it. */
export function buildingRole(auth: Auth, buildingId: string): Role | null {
  if (auth.role === "PLATFORM_ADMIN") return "PLATFORM_ADMIN";
  return auth.memberships.find((link) => link.buildingId === buildingId)?.role ?? null;
}

export function assertBuildingAccess(auth: Auth, buildingId: string, minimum: Role = "RESIDENT"): void {
  const role = buildingRole(auth, buildingId);
  if (!role || !hasAtLeast(role, minimum)) throw forbidden("Prédio fora do seu escopo");
}

/** Buildings the user can read. Empty array for a platform admin means "all buildings". */
export function scopedBuildingIds(auth: Auth): string[] | null {
  return auth.role === "PLATFORM_ADMIN" ? null : auth.memberships.map((link) => link.buildingId);
}

/** Every authenticated query runs here, so PostgreSQL RLS sees who is asking. */
export function inTenantContext<T>(req: Request, fn: (tx: AppTransaction) => Promise<T>, options?: { featureWrite?: boolean }): Promise<T> {
  const auth = currentAuth(req);
  return withUserContext({ userId: auth.userId, role: auth.role }, async tx => {
    if (!options?.featureWrite) await lockFeatures(tx);
    return fn(tx);
  });
}
