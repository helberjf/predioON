import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@predioon/db/runtime";
import { identityDb as db } from "@predioon/db/identity";
import { config } from "../config.js";
import { HttpError, badRequest } from "../http/errors.js";
import { validateBody } from "../http/validate.js";
import { actionMail, sendMail } from "../mail/mailer.js";
import { takeLoginBudget } from "./login-budget.js";
import { PasswordChangeSchema } from "./password-change-schema.js";
import { hashPassword } from "./passwords.js";

const LIFETIME_MINUTES = 60;
const invalid = () => badRequest("Link inválido, expirado ou já utilizado. Solicite um novo.");

function hashToken(token: string): Buffer | null {
  const secret = Buffer.from(token, "base64url");
  if (secret.length !== 32 || secret.toString("base64url") !== token) return null;
  return createHash("sha256").update(secret).digest();
}

async function admit(res: Response, key: string, address: string | null | undefined): Promise<void> {
  const retryAfter = await takeLoginBudget(key, address);
  if (retryAfter <= 0) return;
  res.setHeader("Retry-After", String(retryAfter));
  throw new HttpError(429, "Muitas tentativas. Aguarde e tente novamente.");
}

/**
 * The link opens the portal the person asked from, when that origin is one of
 * ours; otherwise the configured default. A request can never choose an
 * arbitrary destination for the e-mail.
 */
function portalFor(req: Request): string | null {
  const origin = req.header("origin");
  if (origin && config.corsOrigins.includes(origin)) return origin;
  return config.passwordResetUrl;
}

const Forgot = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const Reset = z.object({ token: z.string().min(1).max(64), newPassword: PasswordChangeSchema.shape.newPassword }).strict();

export const recoveryRouter = Router();

/** Always 204: the answer never tells whether the address has an account. */
recoveryRouter.post("/forgot", validateBody(Forgot), async (req, res) => {
  const { email } = req.body as z.infer<typeof Forgot>;
  // Its own bucket: asking for links never spends the budget of the account's sign-in.
  await admit(res, `password-forgot:${email}`, req.ip);
  const portal = portalFor(req);
  res.status(204).end();
  // Everything below runs after the answer: its duration and outcome are invisible to the requester.
  try {
  const [account] = await db.select({ id: users.id, name: users.name, active: users.active }).from(users).where(eq(users.email, email)).limit(1);
  if (account?.active && portal) {
    const secret = randomBytes(32), token = secret.toString("base64url");
    const rows = await db.execute<{ issued: boolean }>(sql`select public.identity_issue_password_reset(${account.id},${createHash("sha256").update(secret).digest()},make_interval(mins => ${LIFETIME_MINUTES})) as issued`);
    if (rows[0]?.issued) {
      // The secret travels in the fragment, which browsers do not send to servers.
      const url = `${portal}/redefinir-senha#${token}`;
      const result = await sendMail(actionMail(email, "Redefinição de senha — Prédio ON",
        [`Olá, ${account.name}.`, "Recebemos um pedido para redefinir a senha da sua conta no Prédio ON."],
        { label: "Criar nova senha", url },
        `O link vale por ${LIFETIME_MINUTES} minutos e funciona uma única vez. Se você não fez este pedido, ignore esta mensagem: sua senha continua a mesma.`));
      // Local development has no provider; print the link so the flow can be exercised.
      if (!result.sent && config.NODE_ENV === "development") console.info(`[mail] e-mail não enviado (${result.reason}); link de redefinição para ${email}: ${url}`);
    }
  }
  } catch { console.error("[recovery] could not issue a password reset link"); }
});

recoveryRouter.post("/reset", validateBody(Reset), async (req, res) => {
  const { token, newPassword } = req.body as z.infer<typeof Reset>;
  const hash = hashToken(token);
  if (!hash) throw invalid();
  await admit(res, `password-reset:${hash.toString("hex")}`, req.ip);
  let changed: boolean;
  try {
    const replacement = await hashPassword(newPassword);
    const rows = await db.execute<{ changed: boolean }>(sql`select public.identity_reset_password(${hash},${replacement}) as changed`);
    changed = rows[0]?.changed === true;
  } catch {
    // Driver diagnostics may contain the new hash.
    throw new HttpError(503, "Não foi possível redefinir a senha agora. Tente novamente em instantes.");
  }
  if (!changed) throw invalid();
  res.status(204).end();
});
