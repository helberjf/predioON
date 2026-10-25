import { createHash, randomBytes } from "node:crypto";
import { base32Encode } from "../../auth/totp.js";

const CODE = /^[A-Z2-7]{10}$/;

/** 50 bits typed once on the tablet within 10 minutes, behind the sign-in attempt budget. */
export function newPairingCode(): string {
  const text = base32Encode(randomBytes(7)).slice(0, 10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

/** Tolerates case, spaces and the dash; anything else is not a code. */
export function pairingCodeHash(input: string): Buffer | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(code) ? createHash("sha256").update(code).digest() : null;
}
