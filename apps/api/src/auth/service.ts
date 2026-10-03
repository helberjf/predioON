import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { buildings, memberships, organizations, refreshTokens, sessions, users } from "@predioon/db/runtime";
import { identityDb as db } from "@predioon/db/identity";
import type { Role } from "@predioon/shared";
import { HttpError, badRequest, notFound, unauthorized } from "../http/errors.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiry, signAccessToken, type AccessTokenClaims } from "./tokens.js";

type ClientMeta = { userAgent?: string | null; ipAddress?: string | null };
export type Identity = { userId: string; name: string; email: string; role: Role; memberships: Array<{ buildingId: string; role: "BUILDING_ADMIN" | "RESIDENT" }> };
export type SessionTokens = { accessToken: string; refreshToken: string; identity: Identity; expiresAt: Date };
type IdentityTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function revokeLockedFamilies(tx: IdentityTransaction, families: Array<{ id: string; userId: string }>, reason: string): Promise<void> {
  if (!families.length) return;
  const [clock] = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  const revokedAt = new Date(clock!.now), ids = families.map(family => family.id), owners = new Map(families.map(family => [family.id, family.userId]));
  const correct = (rows: Array<typeof sessions.$inferSelect>) => rows.length === families.length && rows.every(row => owners.get(row.id) === row.userId
    && row.revokedAt?.getTime() === revokedAt.getTime() && row.revokedReason === reason);
  const changed = await tx.update(sessions).set({ revokedAt, revokedReason: reason }).where(and(inArray(sessions.id, ids), isNull(sessions.revokedAt))).returning();
  if (!correct(changed)) throw new Error("Session revocation was not persisted");
  const persisted = await tx.select().from(sessions).where(inArray(sessions.id, ids));
  if (!correct(persisted)) throw new Error("Session revocation was not persisted");
}

function sessionPersistenceFailure(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(503, "Não foi possível encerrar a sessão. Tente novamente em instantes.");
}

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

async function issueTokens(userId: string, sessionId: string, refreshToken: string, expiresAt: Date): Promise<SessionTokens> {
  const identity = await buildIdentity(userId);
  return { accessToken: await signAccessToken({ sub: userId, sid: sessionId }), refreshToken, identity, expiresAt };
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
    const [locked] = await tx.execute<{ active: boolean }>(sql`select identity_lock_account_active(${user.id}) as active`);
    const [current] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!locked?.active || current?.passwordHash !== user.passwordHash) throw unauthorized("E-mail ou senha inválidos");
    const created = await tx.insert(sessions).values({ userId: user.id, expiresAt,
      userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null }).returning({ id: sessions.id });
    await tx.insert(refreshTokens).values({ userId: user.id, sessionId: created[0]!.id,
      tokenHash, expiresAt, userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null });
    return created;
  });
  return issueTokens(user.id, session!.id, token, expiresAt);
}

/** Account -> family -> generation; revocations are committed before sending401. */
export async function refreshSession(presentedToken: string, meta: ClientMeta): Promise<SessionTokens> {
  const [known] = await db.select({ id: refreshTokens.id, sessionId: refreshTokens.sessionId, userId: refreshTokens.userId })
    .from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(presentedToken))).limit(1);
  if (!known?.sessionId) throw unauthorized("Sessão expirada"); // Legacy rows cannot acquire a live family.
  const successor = createRefreshToken();
  const outcome = await db.transaction(async tx => {
    const [account] = await tx.execute<{ active: boolean }>(sql`select identity_lock_account_active(${known.userId}) as active`);
    const [family] = await tx.select().from(sessions).where(eq(sessions.id, known.sessionId!)).for("update").limit(1);
    if (!family || family.userId !== known.userId || family.revokedAt) return null;
    async function revokeFamily(reason: string, revokedAt: Date) {
      const changed = await tx.update(sessions).set({ revokedAt, revokedReason: reason }).where(eq(sessions.id, family!.id)).returning();
      if (changed.length !== 1 || changed[0]!.revokedAt?.getTime() !== revokedAt.getTime() || changed[0]!.revokedReason !== reason) throw new Error("Session revocation was not persisted");
      const [persisted] = await tx.select().from(sessions).where(eq(sessions.id, family!.id)).limit(1);
      if (persisted?.revokedAt?.getTime() !== revokedAt.getTime() || persisted.revokedReason !== reason) throw new Error("Session revocation was not persisted");
    }
    const [observed] = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    const now = new Date(observed!.now);
    if (family.expiresAt.getTime() <= now.getTime()) return null;
    if (!account?.active) {
      await revokeFamily("ACCOUNT_INACTIVE", now);
      return null;
    }
    const [stored] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, known.id)).for("update").limit(1);
    if (!stored || stored.sessionId !== family.id || stored.userId !== family.userId) return null;
    if (stored.revokedAt) {
      await revokeFamily("REPLAY", now);
      return null;
    }
    const [evaluated] = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    const rotatedAt = new Date(evaluated!.now);
    if (stored.expiresAt.getTime() <= rotatedAt.getTime() || family.expiresAt.getTime() <= rotatedAt.getTime()) {
      await revokeFamily("EXPIRED", rotatedAt);
      return null;
    }
    const consumed = await tx.update(refreshTokens).set({ revokedAt: rotatedAt, replacedByHash: successor.tokenHash }).where(eq(refreshTokens.id, stored.id)).returning();
    const validConsumption = (row: typeof stored | undefined) => row?.id === stored.id && row.sessionId === family.id && row.userId === family.userId
      && row.revokedAt?.getTime() === rotatedAt.getTime() && row.replacedByHash === successor.tokenHash;
    if (consumed.length !== 1 || !validConsumption(consumed[0])) throw new Error("Refresh generation was not consumed");
    const created = await tx.insert(refreshTokens).values({ userId: family.userId, sessionId: family.id,
      tokenHash: successor.tokenHash, expiresAt: family.expiresAt,
      userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null }).returning();
    const validSuccessor = (row: typeof stored | undefined) => row?.userId === family.userId && row.sessionId === family.id
      && row.tokenHash === successor.tokenHash && row.expiresAt.getTime() === family.expiresAt.getTime() && !row.revokedAt;
    if (created.length !== 1 || !validSuccessor(created[0])) throw new Error("Refresh successor was not persisted");
    const updated = await tx.update(sessions).set({ lastUsedAt: rotatedAt, userAgent: meta.userAgent ?? family.userAgent,
      ipAddress: meta.ipAddress ?? family.ipAddress }).where(eq(sessions.id, family.id)).returning();
    const validFamily = (row: typeof family | undefined) => row?.id === family.id && row.userId === family.userId && !row.revokedAt
      && row.expiresAt.getTime() === family.expiresAt.getTime() && row.lastUsedAt.getTime() === rotatedAt.getTime();
    if (updated.length !== 1 || !validFamily(updated[0])) throw new Error("Refresh family was not persisted");
    // AFTER triggers can rewrite a row after RETURNING captures its value.
    const [persistedConsumption] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, stored.id)).limit(1);
    const [persistedSuccessor] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, created[0]!.id)).limit(1);
    const [persistedFamily] = await tx.select().from(sessions).where(eq(sessions.id, family.id)).limit(1);
    if (!validConsumption(persistedConsumption) || !validSuccessor(persistedSuccessor) || !validFamily(persistedFamily)) throw new Error("Refresh rotation was not persisted");
    return { userId: family.userId, sessionId: family.id, expiresAt: family.expiresAt };
  }).catch(() => { throw new HttpError(503, "Renovação temporariamente indisponível. Tente novamente em instantes."); });
  if (!outcome) throw unauthorized("Sessão expirada ou reutilizada");
  return issueTokens(outcome.userId, outcome.sessionId, successor.token, outcome.expiresAt);
}

/** Admission and both KDF operations finish before the helper obtains locks.
 * The fixed SQL helper revalidates the observed credential and caller's session,
 * then updates the credential and revokes every family in one transaction. */
export async function changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<void> {
  const [account] = await db.select({ active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!await verifyPassword(currentPassword, account?.passwordHash ?? null)) throw badRequest("A senha atual está incorreta");
  if (!account?.active) throw unauthorized("Usuário inativo ou inexistente");
  // JSON may contain distinct lone UTF16 surrogates that encode to the same
  // replacement UTF8 bytes. Compare the exact input representation used by KDF.
  if (Buffer.from(currentPassword, "utf8").equals(Buffer.from(newPassword, "utf8"))) throw badRequest("A nova senha precisa ser diferente da senha atual");
  let changed: boolean;
  try {
    const replacementHash = await hashPassword(newPassword);
    const rows = await db.execute<{ changed: boolean }>(sql`select public.identity_replace_password(${userId},${sessionId}::uuid,${account.passwordHash},${replacementHash}) as changed`);
    changed = rows[0]?.changed === true;
  } catch {
    // Driver diagnostics can contain both password hashes. Keep all credential
    // persistence failures generic and leave authentication recovery intact.
    throw new HttpError(503, "Não foi possível alterar a senha. Tente novamente em instantes.");
  }
  if (!changed) throw unauthorized("A sessão ou a credencial mudou. Entre novamente.");
}

/** Logout accepts any known generation, including one consumed by rotation. */
export async function revokeSession(presentedToken: string): Promise<void> {
  const [known] = await db.select({ sessionId: refreshTokens.sessionId, userId: refreshTokens.userId }).from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(presentedToken))).limit(1);
  if (!known?.sessionId) return;
  await db.transaction(async tx => {
    const family = await tx.select().from(sessions).where(and(eq(sessions.id, known.sessionId!), eq(sessions.userId, known.userId), isNull(sessions.revokedAt))).for("update");
    await revokeLockedFamilies(tx, family, "LOGOUT");
  }).catch(sessionPersistenceFailure);
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
  await db.transaction(async tx => {
    const [own] = await tx.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).for("update").limit(1);
    if (!own) throw notFound();
    if (own.revokedAt) return;
    await revokeLockedFamilies(tx, [own], "USER_REVOKED");
  }).catch(sessionPersistenceFailure);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db.transaction(async tx => {
    const [account] = await tx.execute<{ active: boolean }>(sql`select identity_lock_account_active(${userId}) as active`);
    if (!account?.active) throw unauthorized("Usuário inativo ou inexistente");
    const families = await tx.select().from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).orderBy(asc(sessions.id)).for("update");
    await revokeLockedFamilies(tx, families, "REVOKE_ALL");
    const [remaining] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).limit(1);
    if (remaining) throw new Error("All-session revocation was not persisted");
  }).catch(sessionPersistenceFailure);
}
