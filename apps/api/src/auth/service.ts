import { and, eq, isNull } from "drizzle-orm";
import { db, memberships, refreshTokens, users } from "@predioon/db";
import type { Role } from "@predioon/shared";
import { unauthorized } from "../http/errors.js";
import { verifyPassword } from "./passwords.js";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  type AccessTokenClaims,
} from "./tokens.js";

type ClientMeta = { userAgent?: string | null; ipAddress?: string | null };
export type SessionTokens = { accessToken: string; refreshToken: string; claims: AccessTokenClaims };

/**
 * Authentication runs on the OWNER connection: there is no user context to scope by yet.
 * Everything after login goes through withUserContext.
 */
async function buildClaims(userId: string): Promise<AccessTokenClaims> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.active) throw unauthorized("Usuário inativo ou inexistente");

  const links = await db
    .select({ buildingId: memberships.buildingId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)));

  return {
    sub: user.id,
    name: user.name,
    email: user.email,
    role: effectiveRole(user.isPlatformAdmin, links),
    memberships: links,
  };
}

function effectiveRole(isPlatformAdmin: boolean, links: Array<{ role: "BUILDING_ADMIN" | "RESIDENT" }>): Role {
  if (isPlatformAdmin) return "PLATFORM_ADMIN";
  return links.some((link) => link.role === "BUILDING_ADMIN") ? "BUILDING_ADMIN" : "RESIDENT";
}

async function issueSession(claims: AccessTokenClaims, meta: ClientMeta): Promise<SessionTokens> {
  const { token, tokenHash } = createRefreshToken();
  await db.insert(refreshTokens).values({
    userId: claims.sub,
    tokenHash,
    expiresAt: refreshTokenExpiry(),
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
  });

  return { accessToken: await signAccessToken(claims), refreshToken: token, claims };
}

export async function login(email: string, password: string, meta: ClientMeta): Promise<SessionTokens> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

  // Same error for unknown e-mail and wrong password: never reveal which accounts exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !user.active || !ok) throw unauthorized("E-mail ou senha inválidos");

  return issueSession(await buildClaims(user.id), meta);
}

/** Rotation: the presented token is revoked and replaced, so replaying it stops working. */
export async function refreshSession(presentedToken: string, meta: ClientMeta): Promise<SessionTokens> {
  const tokenHash = hashRefreshToken(presentedToken);
  const [stored] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .limit(1);

  if (!stored || stored.expiresAt.getTime() <= Date.now()) throw unauthorized("Sessão expirada");

  const claims = await buildClaims(stored.userId);
  const session = await issueSession(claims, meta);

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedByHash: hashRefreshToken(session.refreshToken) })
    .where(eq(refreshTokens.id, stored.id));

  return session;
}

export async function revokeSession(presentedToken: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hashRefreshToken(presentedToken)), isNull(refreshTokens.revokedAt)));
}

export { buildClaims };
