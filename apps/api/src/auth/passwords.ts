import { hash, verify } from "@node-rs/argon2";

/** Argon2id with the library defaults, which follow the OWASP recommendation. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

type PasswordComparison = (passwordHash: string, plain: string) => Promise<boolean>;

// Generated from random bytes with the current hashPassword defaults. This is
// comparison work for absent/corrupt credentials, never an account credential.
// The test compares its parameters with a fresh hash to detect policy drift.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$Aqqb2Qq9GEaugDrDme9YUw$fCv6WakSTrKiD9N9ebbvji7xAdOEjz2c0n0kAfAcbHI";

export function createPasswordVerifier(compare: PasswordComparison) {
  return async (plain: string, passwordHash: string | null): Promise<boolean> => {
    try {
      const matches = await compare(passwordHash || DUMMY_HASH, plain);
      return Boolean(passwordHash) && matches;
    } catch {
      // Invalid PHC strings can fail before doing any KDF work. Perform one
      // normal-cost comparison, then deny even if that comparison succeeds.
      if (passwordHash) {
        try { await compare(DUMMY_HASH, plain); }
        catch { /* Provider failure also denies authentication. */ }
      }
      return false;
    }
  };
}

export const verifyPassword = createPasswordVerifier(verify);
