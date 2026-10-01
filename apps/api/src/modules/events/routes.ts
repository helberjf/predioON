import { Router } from "express";
import { decodeJwt } from "jose";
import { inTenantContext } from "../../auth/middleware.js";
import { verifyAccessToken } from "../../auth/tokens.js";
import { resolveIdentity } from "../../auth/service.js";
import { unauthorized } from "../../http/errors.js";
import { subscribe } from "./bus.js";
import { projectTelemetryEvent } from "./telemetry.js";
import { projectAlertEvent } from "./alerts.js";
import { projectDeviceStatusEvent, projectGatewayStatusEvent } from "./equipment.js";
import { projectFeatureEvent } from "./features.js";

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

  req.auth = { ...(await resolveIdentity(claims)), sessionId: claims.sid };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 5000\n\n`);

  let closed = false, queued = 0, delivery: Promise<void> = Promise.resolve();
  const unsubscribe = subscribe((event) => {
    if (closed) return;
    // Serialize authorization and delivery per subscriber. A slow client reconnects instead of retaining an unbounded queue.
    if (++queued > 100) { res.end(); return; }
    delivery = delivery.then(async () => {
      if (closed) return;
      req.auth = { ...(await resolveIdentity(claims)), sessionId: claims.sid };
      if (event.kind === "telemetry") {
        await inTenantContext(req, async tx => {
          const projected = await projectTelemetryEvent(tx, event);
          if (projected && !closed && !res.writableEnded) res.write(`event: telemetry\ndata: ${JSON.stringify(projected)}\n\n`);
        });
        return;
      }
      if (event.kind === "alert") {
        await inTenantContext(req, async tx => {
          const projected = await projectAlertEvent(tx, event);
          if (projected && !closed && !res.writableEnded) res.write(`event: alert\ndata: ${JSON.stringify(projected)}\n\n`);
        });
        return;
      }
      if (event.kind === "device-status") {
        await inTenantContext(req, async tx => {
          const projected = await projectDeviceStatusEvent(tx, event);
          if (projected && !closed && !res.writableEnded) res.write(`event: device-status\ndata: ${JSON.stringify(projected)}\n\n`);
        });
        return;
      }
      if (event.kind === "gateway-status") {
        await inTenantContext(req, async tx => {
          const projected = await projectGatewayStatusEvent(tx, event);
          if (projected && !closed && !res.writableEnded) res.write(`event: gateway-status\ndata: ${JSON.stringify(projected)}\n\n`);
        });
        return;
      }
      if (event.kind === "features-changed") {
        await inTenantContext(req, async tx => {
          const projected = await projectFeatureEvent(tx, event);
          if (projected && !closed && !res.writableEnded) res.write(`event: features-changed\ndata: ${JSON.stringify(projected)}\n\n`);
        });
      }
    }).catch(() => { res.end(); }).finally(() => { queued--; });
  });

  // Comment frames keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => {
    void resolveIdentity(claims).then(identity => {
      if (closed || res.writableEnded) return;
      req.auth = { ...identity, sessionId: claims.sid };
      res.write(`: ping\n\n`);
    }).catch(() => res.end());
  }, 25_000);

  const expiry = setTimeout(() => res.end(), Math.max(1, (decodeJwt(token).exp! * 1000) - Date.now()));
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(expiry);
    unsubscribe();
    res.end();
  });
});
