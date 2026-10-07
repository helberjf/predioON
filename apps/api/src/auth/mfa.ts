import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@predioon/db/runtime";
import { identityDb as db } from "@predioon/db/identity";
import { config } from "../config.js";
import { badRequest, conflict, unauthorized } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { admitPasswordChange } from "./login-budget.js";
import { authenticate, currentAuth } from "./middleware.js";
import { consumeMfaCode, factorOf, newRecoveryCode, open, RECOVERY_CODES, recoveryHash, seal, secretKey } from "./mfa-factor.js";
import { verifyPassword } from "./passwords.js";
import { base32Encode, matchTotp, otpauthUri } from "./totp.js";

async function requirePassword(userId: string, password: string): Promise<{ email: string }> {
  const [account] = await db.select({ email: users.email, active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!await verifyPassword(password, account?.passwordHash ?? null) || !account?.active) throw badRequest("A senha atual está incorreta");
  return { email: account.email };
}

const password = z.string().min(1).refine(value => Buffer.byteLength(value, "utf8") <= 1024, "Senha excede 1024 bytes");
const code = z.string().trim().min(6).max(16);
const Enroll = z.object({ currentPassword: password }).strict();
const Confirm = z.object({ code }).strict();
const Disable = z.object({ currentPassword: password, code: code.optional() }).strict();

export const mfaRouter = Router();
mfaRouter.use(authenticate);

mfaRouter.get("/", async (req, res) => {
  const userId = currentAuth(req).userId;
  const factor = await factorOf(userId);
  const [remaining] = await db.execute<{ count: number }>(sql`select count(*)::int as count from mfa_recovery_codes where user_id=${userId} and used_at is null`);
  res.json({ enabled: Boolean(factor?.confirmed_at), pending: Boolean(factor && !factor.confirmed_at), recoveryCodesRemaining: factor?.confirmed_at ? remaining!.count : 0,
    available: Boolean(config.mfaEncryptionKey) });
});

/** Starts (or restarts) enrolment. Nothing is enforced until the first code is confirmed. */
mfaRouter.post("/enroll", validateBody(Enroll), admitPasswordChange, async (req, res) => {
  const userId = currentAuth(req).userId;
  secretKey();
  const { email } = await requirePassword(userId, (req.body as z.infer<typeof Enroll>).currentPassword);
  const secret = randomBytes(20);
  // A pending enrolment is replaced; a confirmed factor is never overwritten.
  const stored = await db.transaction(async tx => {
    await tx.execute(sql`delete from mfa_factors where user_id=${userId} and confirmed_at is null`);
    return tx.execute(sql`insert into mfa_factors(user_id,secret_ciphertext) values(${userId},${seal(secret, userId)}) on conflict (user_id) do nothing returning user_id`);
  });
  if (!stored.length) throw conflict("A verificação em duas etapas já está ativa nesta conta.");
  res.json({ secret: base32Encode(secret), otpauthUri: otpauthUri("Prédio ON", email, secret) });
});

mfaRouter.post("/confirm", validateBody(Confirm), admitPasswordChange, async (req, res) => {
  const userId = currentAuth(req).userId;
  const factor = await factorOf(userId);
  if (!factor) throw conflict("Inicie a configuração antes de confirmar o código.");
  if (factor.confirmed_at) throw conflict("A verificação em duas etapas já está ativa nesta conta.");
  const step = matchTotp(open(Buffer.from(factor.secret_ciphertext), userId), (req.body as z.infer<typeof Confirm>).code, Date.now());
  if (step === null) throw badRequest("Código de verificação inválido. Confira o horário do aparelho e tente o código atual.");
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  const confirmed = await db.transaction(async tx => {
    const rows = await tx.execute(sql`update mfa_factors set confirmed_at=clock_timestamp(), last_used_step=${step} where user_id=${userId} and confirmed_at is null returning user_id`);
    if (!rows.length) return false;
    await tx.execute(sql`delete from mfa_recovery_codes where user_id=${userId}`);
    for (const item of codes) await tx.execute(sql`insert into mfa_recovery_codes(user_id,code_hash) values(${userId},${recoveryHash(item)})`);
    return true;
  });
  if (!confirmed) throw conflict("A verificação em duas etapas já está ativa nesta conta.");
  res.json({ recoveryCodes: codes });
});

/** Turning the factor off needs both the password and a valid code. */
mfaRouter.post("/disable", validateBody(Disable), admitPasswordChange, async (req, res) => {
  const userId = currentAuth(req).userId;
  const input = req.body as z.infer<typeof Disable>;
  await requirePassword(userId, input.currentPassword);
  const factor = await factorOf(userId);
  if (!factor) { res.status(204).end(); return; }
  if (factor.confirmed_at && !(input.code && await consumeMfaCode(userId, input.code))) throw unauthorized("Código de verificação inválido");
  await db.execute(sql`delete from mfa_factors where user_id=${userId}`);
  res.status(204).end();
});
