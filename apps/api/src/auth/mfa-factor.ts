// Factor storage and verification. Kept free of the HTTP middleware so the
// login service can depend on it without an import cycle; routes live in mfa.ts.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { identityDb as db } from "@predioon/db/identity";
import { config } from "../config.js";
import { HttpError } from "../http/errors.js";
import { base32Encode, matchTotp } from "./totp.js";

/** Shown by clients to ask for the code; keep in sync with @predioon/contracts/auth. */
export const MFA_REQUIRED_MESSAGE = "Informe o código de verificação do seu aplicativo autenticador.";
export const RECOVERY_CODES = 10;

/** AES-256-GCM key derived from the configured secret; the database never sees it. */
export function secretKey(): Buffer {
  if (!config.mfaEncryptionKey) throw new HttpError(503, "A verificação em duas etapas não está configurada neste ambiente.");
  return Buffer.from(hkdfSync("sha256", config.mfaEncryptionKey, "predioon-mfa", "totp-secret-v1", 32));
}
/** iv(12) | tag(16) | ciphertext, bound to the account so a row cannot be moved to another user. */
export function seal(secret: Buffer, userId: string): Buffer {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function open(sealed: Buffer, userId: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}
export const recoveryHash = (code: string) => createHash("sha256").update(code.replaceAll("-", "").toUpperCase()).digest();
export function newRecoveryCode(): string {
  const text = base32Encode(randomBytes(7)).slice(0, 10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

type Factor = { secret_ciphertext: Buffer; confirmed_at: Date | null; last_used_step: string | number };
export async function factorOf(userId: string): Promise<Factor | null> {
  const rows = await db.execute<Factor>(sql`select secret_ciphertext, confirmed_at, last_used_step from mfa_factors where user_id=${userId}`);
  return rows[0] ?? null;
}

/** True when a login for this account must present a code. */
export async function mfaEnabled(userId: string): Promise<boolean> {
  return Boolean((await factorOf(userId))?.confirmed_at);
}

/**
 * Accepts a current TOTP code once, or an unused recovery code once. Both are
 * consumed by a conditional UPDATE, so two concurrent logins cannot share one.
 */
export async function consumeMfaCode(userId: string, presented: string): Promise<boolean> {
  const factor = await factorOf(userId);
  if (!factor?.confirmed_at) return false;
  const code = presented.trim();
  const step = matchTotp(open(Buffer.from(factor.secret_ciphertext), userId), code, Date.now());
  if (step !== null) {
    const used = await db.execute(sql`update mfa_factors set last_used_step=${step} where user_id=${userId} and confirmed_at is not null and last_used_step<${step} returning user_id`);
    return used.length === 1;
  }
  if (!/^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$/.test(code)) return false;
  const spent = await db.execute(sql`update mfa_recovery_codes set used_at=clock_timestamp() where user_id=${userId} and code_hash=${recoveryHash(code)} and used_at is null returning id`);
  return spent.length === 1;
}
