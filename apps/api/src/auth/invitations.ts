import { Router, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@predioon/db/runtime";
import { identityDb as db } from "@predioon/db/identity";
import { HttpError, notFound, unauthorized } from "../http/errors.js";
import { generateId } from "../http/ids.js";
import { validateBody } from "../http/validate.js";
import { takeLoginBudget } from "./login-budget.js";
import { createOpaqueToken, hashOpaqueToken } from "./opaque-token.js";
import { PasswordChangeSchema } from "./password-change-schema.js";
import { hashPassword, verifyPassword } from "./passwords.js";

/** 32 random bytes, shown once to the manager. Only its SHA-256 is stored. */
export const createInvitationToken = createOpaqueToken;
export const hashInvitationToken = hashOpaqueToken;

type Preview = { email: string; name: string; building_name: string; account_exists: boolean; expires_at: Date };
const unavailable = () => notFound("Convite inválido, expirado ou já utilizado");
const failure = () => new HttpError(503, "Convite temporariamente indisponível. Tente novamente em instantes.");

async function admit(res: Response, key: string, address: string | null | undefined): Promise<void> {
  const retryAfter = await takeLoginBudget(key, address);
  if (retryAfter <= 0) return;
  res.setHeader("Retry-After", String(retryAfter));
  throw new HttpError(429, "Muitas tentativas. Aguarde e tente novamente.");
}

async function preview(hash: Buffer): Promise<Preview | null> {
  try {
    const rows = await db.execute<Preview>(sql`select * from public.identity_invitation_preview(${hash})`);
    return rows[0] ?? null;
  } catch { throw failure(); }
}

const TokenSchema = z.object({ token: z.string().min(1).max(64) }).strict();
// The existing account's password is only compared; a new one follows the
// same policy as a password change.
const AcceptSchema = z.object({ token: TokenSchema.shape.token, password: PasswordChangeSchema.shape.currentPassword }).strict();

export const invitationAuthRouter = Router();

/** Budgets are keyed by the presented secret and by the network, never by a body-selected account. */
async function resolve(res: Response, token: string, address: string | null | undefined): Promise<{ hash: Buffer; invitation: Preview }> {
  const hash = hashInvitationToken(token);
  if (!hash) throw unavailable();
  await admit(res, `invitation:${hash.toString("hex")}`, address);
  const invitation = await preview(hash);
  if (!invitation) throw unavailable();
  return { hash, invitation };
}

invitationAuthRouter.post("/preview", validateBody(TokenSchema), async (req, res) => {
  const { invitation } = await resolve(res, (req.body as z.infer<typeof TokenSchema>).token, req.ip);
  res.json({ email: invitation.email, name: invitation.name, buildingName: invitation.building_name,
    accountExists: invitation.account_exists, expiresAt: new Date(invitation.expires_at).toISOString() });
});

invitationAuthRouter.post("/accept", validateBody(AcceptSchema), async (req, res) => {
  const { token, password } = req.body as z.infer<typeof AcceptSchema>;
  const { hash, invitation } = await resolve(res, token, req.ip);
  let existingId: string | null = null, newId: string | null = null, replacementHash: string | null = null;
  if (invitation.account_exists) {
    // The address already has a credential: the bearer must prove it, under
    // the same budget as a login, and that credential is never replaced here.
    await admit(res, invitation.email, req.ip);
    const [account] = await db.select({ id: users.id, active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.email, invitation.email)).limit(1);
    if (!await verifyPassword(password, account?.passwordHash ?? null) || !account?.active) throw unauthorized("Senha incorreta para a conta deste e-mail");
    existingId = account.id;
  } else {
    const policy = PasswordChangeSchema.shape.newPassword.safeParse(password);
    if (!policy.success) throw new HttpError(400, policy.error.issues[0]?.message ?? "Senha inválida");
    newId = generateId("usr");
    replacementHash = await hashPassword(password);
  }
  let accepted: string | null;
  try {
    const rows = await db.execute<{ accepted: string | null }>(sql`select public.identity_accept_invitation(${hash},${newId},${replacementHash},${existingId}) as accepted`);
    accepted = rows[0]?.accepted ?? null;
  } catch {
    // Driver diagnostics may contain the new hash; a concurrent registration of
    // the same address also lands here. The invitation stays usable for a retry.
    throw failure();
  }
  if (!accepted) throw unavailable();
  res.status(204).end();
});
