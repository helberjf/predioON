import { z } from "zod";

const boundedPassword = z.string().min(1).refine(value => Buffer.byteLength(value, "utf8") <= 1024, "Senha excede 1024 bytes");
export const PasswordChangeSchema = z.object({
  currentPassword: boundedPassword,
  newPassword: boundedPassword
    .refine(value => !/[\uD800-\uDFFF]/u.test(value), "A nova senha contém Unicode inválido")
    .refine(value => [...value].length >= 15, "A nova senha precisa de pelo menos 15 caracteres"),
}).strict();
