import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, shown once. Only their SHA-256 is stored. */
export function createOpaqueToken(): { token: string; hash: Buffer } {
  const secret = randomBytes(32);
  return { token: secret.toString("base64url"), hash: createHash("sha256").update(secret).digest() };
}

/** Accepts only the canonical encoding, so one secret has one representation. */
export function hashOpaqueToken(token: string): Buffer | null {
  const secret = Buffer.from(token, "base64url");
  if (secret.length !== 32 || secret.toString("base64url") !== token) return null;
  return createHash("sha256").update(secret).digest();
}
