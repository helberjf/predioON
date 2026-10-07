import { z } from "zod";

// Byte limits bound KDF input even for Unicode. Preserve passwords exactly;
// lowercasing of email remains in the existing identity service.
export const LoginSchema = z.object({
  email: z.string().email().refine(value => Buffer.byteLength(value, "utf8") <= 254, "E-mail excede 254 bytes"),
  password: z.string().min(1).refine(value => Buffer.byteLength(value, "utf8") <= 1024, "Senha excede 1024 bytes"),
  // Second factor: a six-digit TOTP code or a recovery code. Required only for accounts that enabled it.
  code: z.string().trim().min(6).max(16).regex(/^[0-9A-Za-z-]+$/).optional(),
}).strict();
