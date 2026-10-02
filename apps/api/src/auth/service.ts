import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { buildings, memberships, organizations, refreshTokens, sessions, users } from "@predioon/db/runtime";
import { identityDb as db } from "@predioon/db/identity";
import type { Role } from "@predioon/shared";
import { notFound, unauthorized } from "../http/errors.js";
import { verifyPassword } from "./passwords.js";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiry, signAccessToken, type AccessTokenClaims } from "./tokens.js";

type ClientMeta = { userAgent?: string | null; ipAddress?: string | null };
export type Identity = { userId: string; name: string; email: string; role: Role; memberships: Array<{ buildingId: string; role: "BUILDING_ADMIN" | "RESIDENT" }> };
export type SessionTokens = { accessToken: string; refreshToken: string; identity: Identity };

function effectiveRole(isPlatformAdmin: boolean, links: Identity["memberships"]): Role {
  if (isPlatformAdmin) return "PLATFORM_ADMIN";
  return links.some((link) => link.role === "BUILDING_ADMIN") ? "BUILDING_ADMIN" : "RESIDENT";
}

/** Read account, active tenants and time-bounded grants on every authenticated request. */
export async function buildIdentity(userId: string): Promise<Identity> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.active) throw unauthorized("Usuário inativo ou inexistente");
  const links = await db.select({ buildingId: memberships.buildingId, role: memberships.role })
    .from(memberships)
    .innerJoin(buildings, eq(memberships.buildingId, buildings.id))
    .innerJoin(organizations, eq(buildings.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true),
      eq(buildings.active, true), eq(organizations.active, true),
      or(isNull(memberships.startsAt), lte(memberships.startsAt, sql`now()`)),
      or(isNull(memberships.endsAt), gt(memberships.endsAt, sql`now()`))));
  return { userId: user.id, name: user.name, email: user.email,
    role: effectiveRole(user.isPlatformAdmin, links), memberships: links };
}

/** A valid signature alone never authenticates a revoked, expired or mismatched session. */
export async function resolveIdentity(claims: AccessTokenClaims): Promise<Identity> {
  const [session] = await db.select({ userId: sessions.userId }).from(sessions)
    .where(and(eq(sessions.id, claims.sid), eq(sessions.userId, claims.sub),
      isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`))).limit(1);
  if (!session) throw unauthorized("Sessão revogada ou expirada");
  return buildIdentity(session.userId);
}

async function issueTokens(userId: string, sessionId: string, refreshToken: string): Promise<SessionTokens> {
  const identity = await buildIdentity(userId);
  return { accessToken: await signAccessToken({ sub: userId, sid: sessionId }), refreshToken, identity };
}

export async function login(email: string, password: string, meta: ClientMeta): Promise<SessionTokens> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  // Never reveal whether the address or password was wrong.
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user?.active || !ok) throw unauthorized("E-mail ou senha inválidos");
  await buildIdentity(user.id);
  const expiresAt = refreshTokenExpiry();
  const { token, tokenHash } = createRefreshToken();
  const [session] = await db.transaction(async tx => {
    const created = await tx.insert(sessions).values({ userId: user.id, expiresAt,
      userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null }).returning({ id: sessions.id });
    await tx.insert(refreshTokens).values({ userId: user.id, sessionId: created[0]!.id,
      tokenHash, expiresAt, userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null });
    return created;
  });
  return issueTokens(user.id, session!.id, token);
}

/** Lock the family first; replay revocation is committed before sending the 401. */
export async function refreshSession(presentedToken: string, meta: ClientMeta): Promise<SessionTokens> {
  const [known] = await db.select({ id: refreshTokens.id, sessionId: refreshTokens.sessionId })
    .from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(presentedToken))).limit(1);
  if (!known?.sessionId) throw unauthorized("Sessão expirada"); // Legacy rows cannot acquire a live family.
  const successor = createRefreshToken();
  const outcome = await db.transaction(async tx => {
    const [family] = await tx.select().from(sessions).where(eq(sessions.id, known.sessionId!)).for("update").limit(1);
    if (!family || family.revokedAt || family.expiresAt.getTime() <= Date.now()) return null;
    const [account] = await tx.execute<{ active: boolean }>(sql`select identity_lock_account_active(${family.userId}) as active`);
    if (!account?.active) {
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "ACCOUNT_INACTIVE" }).where(eq(sessions.id, family.id));
      return null;
    }
    const [stored] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, known.id)).limit(1);
    if (!stored || stored.sessionId !== family.id || stored.userId !== family.userId) return null;
    if (stored.revokedAt) {
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "REPLAY" }).where(eq(sessions.id, family.id));
      return null;
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "EXPIRED" }).where(eq(sessions.id, family.id));
      return null;
    }
    const now = new Date();
    await tx.update(refreshTokens).set({ revokedAt: now, replacedByHash: successor.tokenHash }).where(eq(refreshTokens.id, stored.id));
    await tx.insert(refreshTokens).values({ userId: family.userId, sessionId: family.id,
      tokenHash: successor.tokenHash, expiresAt: family.expiresAt,
      userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null });
    await tx.update(sessions).set({ lastUsedAt: now, userAgent: meta.userAgent ?? family.userAgent,
      ipAddress: meta.ipAddress ?? family.ipAddress }).where(eq(sessions.id, family.id));
    return { userId: family.userId, sessionId: family.id };
  });
  if (!outcome) throw unauthorized("Sessão expirada ou reutilizada");
  return issueTokens(outcome.userId, outcome.sessionId, successor.token);
}

/** Logout accepts any known generation, including one consumed by rotation. */
export async function revokeSession(presentedToken: string): Promise<void> {
  const [known] = await db.select({ sessionId: refreshTokens.sessionId }).from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(presentedToken))).limit(1);
  if (!known?.sessionId) return;
  await db.update(sessions).set({ revokedAt: new Date(), revokedReason: "LOGOUT" })
    .where(and(eq(sessions.id, known.sessionId), isNull(sessions.revokedAt)));
}

export async function listSessions(userId: string, currentSessionId: string) {
  const rows = await db.select({ id: sessions.id, userId: sessions.userId,
    createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, lastUsedAt: sessions.lastUsedAt,
    revokedAt: sessions.revokedAt, revokedReason: sessions.revokedReason,
    userAgent: sessions.userAgent, ipAddress: sessions.ipAddress })
    .from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.createdAt)).limit(100);
  return rows.map(row => ({ ...row, current: row.id === currentSessionId }));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<void> {
  const [own] = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).limit(1);
  if (!own) throw notFound();
  await db.update(sessions).set({ revokedAt: new Date(), revokedReason: "USER_REVOKED" })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date(), revokedReason: "REVOKE_ALL" })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
