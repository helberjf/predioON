import { Router } from "express";
import { decodeJwt } from "jose";
import { buildingRole, currentAuth, inTenantContext } from "../../auth/middleware.js";
import { and, eq } from "drizzle-orm";
import { alerts, users } from "@predioon/db";
import { buildingFeatures, filterSensorRows, observationIsCurrent, sensorFeatureKeys } from "../../auth/features.js";
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

  let closed = false, queued = 0, delivery: Promise<void> = Promise.resolve();
  const unsubscribe = subscribe((event) => {
    const globalChange = event.kind === "features-changed" && event.buildingId === "*";
    if (closed || (!globalChange && !buildingRole(auth, event.buildingId))) return;
    // Serialize authorization and delivery per subscriber. A slow client reconnects instead of retaining an unbounded queue.
    if (++queued > 100) { res.end(); return; }
    delivery = delivery.then(async () => {
      if (closed) return;
      await inTenantContext(req, async tx => {
        const [user] = await tx.select({ active: users.active, admin: users.isPlatformAdmin }).from(users).where(eq(users.id, auth.userId)).limit(1);
        if (!user?.active || (auth.role === "PLATFORM_ADMIN" && !user.admin)) { res.end(); return; }
        if (!globalChange) {
          const features = await buildingFeatures(tx, event.buildingId);
          if (event.kind === "telemetry") {
            const keys = await sensorFeatureKeys(tx, event);
            if (!observationIsCurrent(features, keys, event.time)) return;
          } else if (event.kind === "alert") {
            const rows = await tx.select().from(alerts).where(and(eq(alerts.id, event.alertId), eq(alerts.buildingId, event.buildingId))).limit(1);
            if (!(await filterSensorRows(tx, rows)).length) return;
          } else if (event.kind === "device-status") {
            const keys = await sensorFeatureKeys(tx, event);
            if (keys.length && !keys.some(key => features[key].enabled)) return;
          }
        }
        if (!closed && !res.writableEnded) res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
      });
    }).catch(() => { /* Fail closed; reconnection/polling restores availability after transient errors. */ }).finally(() => { queued--; });
  });

  // Comment frames keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);

  const expiry = setTimeout(() => res.end(), Math.max(1, (decodeJwt(token).exp! * 1000) - Date.now()));
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(expiry);
    unsubscribe();
    res.end();
  });
});
