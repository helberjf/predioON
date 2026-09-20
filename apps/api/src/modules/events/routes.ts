import { Router } from "express";
import { buildingRole, currentAuth } from "../../auth/middleware.js";
import { verifyAccessToken } from "../../auth/tokens.js";
import { unauthorized } from "../../http/errors.js";
import { subscribe } from "./bus.js";

export const eventsRouter = Router();

/**
 * EventSource cannot send an Authorization header, so the SSE route also accepts
 * ?access_token=. It is the only route that does, and only short-lived access tokens work.
 */
eventsRouter.get("/stream", async (req, res) => {
  const headerToken = req.header("authorization")?.replace("Bearer ", "");
  const token = headerToken ?? (typeof req.query.access_token === "string" ? req.query.access_token : null);
  if (!token) throw unauthorized("Token ausente");

  const claims = await verifyAccessToken(token);
  if (!claims) throw unauthorized("Token inválido ou expirado");

  req.auth = {
    userId: claims.sub,
    name: claims.name,
    email: claims.email,
    role: claims.role,
    memberships: claims.memberships,
  };
  const auth = currentAuth(req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 5000\n\n`);

  const unsubscribe = subscribe((event) => {
    // Fan-out happens in memory, so the building filter is applied per subscriber.
    if (!buildingRole(auth, event.buildingId)) return;
    res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  // Comment frames keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});
