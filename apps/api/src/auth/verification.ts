import type { Request } from "express";
import { Router } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { sessions, users } from "@predioon/db/runtime";
import { identityDb as db } from "@predioon/db/identity";
import { badRequest, HttpError, unauthorized } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { admitPasswordChange } from "./login-budget.js";
import { authenticate, currentAuth } from "./middleware.js";
import { consumeMfaCode, mfaEnabled, MFA_REQUIRED_MESSAGE } from "./mfa-factor.js";
import { verifyPassword } from "./passwords.js";

/**
 * Recent verification (055). Privileged actions — creating accounts, granting
 * roles or a manager membership, platform support access and gateway secrets —
 * need the session owner to have proved the password (and the second factor)
 * recently. Signing in counts; refreshing the access token does not.
 */
export const RECENT_VERIFICATION_MINUTES = 10;
export const VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED";

export async function requireRecentVerification(req: Request): Promise<void> {
  const auth = currentAuth(req);
  const [row] = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.id, auth.sessionId), eq(sessions.userId, auth.userId), isNull(sessions.revokedAt),
      gt(sessions.verifiedAt, sql`clock_timestamp()-make_interval(mins=>${RECENT_VERIFICATION_MINUTES})`))).limit(1);
  if (!row) throw new HttpError(403, "Confirme sua senha para concluir esta ação.", { reason: VERIFICATION_REQUIRED });
}

const password = z.string().min(1).refine(value => Buffer.byteLength(value, "utf8") <= 1024, "Senha excede 1024 bytes");
const Verify = z.object({ currentPassword: password, code: z.string().trim().min(6).max(16).optional() }).strict();

export const verificationRouter = Router();
verificationRouter.use(authenticate);

verificationRouter.post("/", validateBody(Verify), admitPasswordChange, async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof Verify>;
  const [account] = await db.select({ active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!account?.active || !await verifyPassword(input.currentPassword, account.passwordHash ?? null)) throw badRequest("A senha atual está incorreta");
  if (await mfaEnabled(auth.userId)) {
    if (!input.code) throw badRequest(MFA_REQUIRED_MESSAGE);
    if (!await consumeMfaCode(auth.userId, input.code)) throw badRequest("Código de verificação inválido");
  }
  // Only this session becomes verified; another device keeps its own clock.
  const updated = await db.update(sessions).set({ verifiedAt: sql`clock_timestamp()` })
    .where(and(eq(sessions.id, auth.sessionId), eq(sessions.userId, auth.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .returning({ id: sessions.id });
  if (!updated.length) throw unauthorized("Sessão revogada ou expirada");
  res.status(204).end();
});
