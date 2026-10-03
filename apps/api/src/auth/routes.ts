import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../http/validate.js";
import { authenticate, currentAuth } from "./middleware.js";
import { changePassword, listSessions, login, refreshSession, revokeAllSessions, revokeSession, revokeSessionById } from "./service.js";
import type { SessionTokens } from "./service.js";
import { webAuthRouter } from "./web-routes.js";
import { LoginSchema } from "./login-schema.js";
import { admitLogin, admitPasswordChange } from "./login-budget.js";
import { PasswordChangeSchema } from "./password-change-schema.js";

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
authRouter.use("/web", webAuthRouter);

const RefreshSchema = z.object({ refreshToken: z.string().min(10) });

function sessionResponse(session: SessionTokens) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: {
      id: session.identity.userId,
      name: session.identity.name,
      email: session.identity.email,
      role: session.identity.role,
      memberships: session.identity.memberships,
    },
  };
}

authRouter.post("/login", validateBody(LoginSchema), admitLogin, async (req, res) => {
  const { email, password } = req.body as z.infer<typeof LoginSchema>;
  const session = await login(email, password, {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
  });
  res.json(sessionResponse(session));
});

authRouter.post("/password", authenticate, validateBody(PasswordChangeSchema), admitPasswordChange, async (req, res) => {
  const auth = currentAuth(req);
  await changePassword(auth.userId, auth.sessionId, req.body.currentPassword, req.body.newPassword);
  res.status(204).end();
});

authRouter.post("/refresh", validateBody(RefreshSchema), async (req, res) => {
  const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;
  const session = await refreshSession(refreshToken, {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
  });
  res.json(sessionResponse(session));
});

authRouter.post("/logout", validateBody(RefreshSchema), async (req, res) => {
  const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;
  await revokeSession(refreshToken);
  res.status(204).end();
});

authRouter.get("/sessions", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  res.json({ items: await listSessions(auth.userId, auth.sessionId) });
});

authRouter.delete("/sessions/:id", authenticate, async (req, res) => {
  const auth = currentAuth(req);
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(404).end(); return; }
  await revokeSessionById(auth.userId, id.data);
  res.status(204).end();
});

authRouter.post("/sessions/revoke-all", authenticate, async (req, res) => {
  await revokeAllSessions(currentAuth(req).userId);
  res.status(204).end();
});

authRouter.get("/me", authenticate, (req, res) => {
  const auth = currentAuth(req);
  res.json({
    id: auth.userId,
    name: auth.name,
    email: auth.email,
    role: auth.role,
    memberships: auth.memberships,
  });
});
