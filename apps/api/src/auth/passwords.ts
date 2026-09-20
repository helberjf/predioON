import { hash, verify } from "@node-rs/argon2";

/** Argon2id with the library defaults, which follow the OWASP recommendation. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(plain: string, passwordHash: string | null): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await verify(passwordHash, plain);
  } catch {
    // A malformed hash in the database must read as "wrong password", never as a crash.
    return false;
  }
}
