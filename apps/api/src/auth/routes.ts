import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../http/validate.js";
import { badRequest } from "../http/errors.js";
import { authenticate, currentAuth } from "./middleware.js";
import { login, refreshSession, revokeSession } from "./service.js";
import type { SessionTokens } from "./service.js";

export const authRouter = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(10) });

function sessionResponse(session: SessionTokens) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: {
      id: session.claims.sub,
      name: session.claims.name,
      email: session.claims.email,
      role: session.claims.role,
      memberships: session.claims.memberships,
    },
  };
}

authRouter.post("/login", validateBody(LoginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof LoginSchema>;
  const session = await login(email, password, {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
  });
  res.json(sessionResponse(session));
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
  if (!refreshToken) throw badRequest("refreshToken é obrigatório");
  await revokeSession(refreshToken);
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
