import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, devices, gateways, buildings } from "@predioon/db";
import { TELEMETRY_TOPIC, WATER_TELEMETRY_TOPIC, GATEWAY_STATUS_TOPIC, parseTelemetryTopic, parseWaterTelemetryTopic, parseGatewayStatusTopic } from "@predioon/shared";
import { verifyPassword } from "../../auth/passwords.js";
import { config } from "../../config.js";

export const mqttRouter = Router();
function equalSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// EMQX treats HTTP errors as 'ignore'; always deny explicitly and never log credentials.
mqttRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!equalSecret(req.header("x-mqtt-secret"), config.MQTT_AUTH_SECRET)) return void res.json({ result: "deny" });
  next();
});

const Identity = z.object({ username: z.string().min(1).max(128), clientid: z.string().min(1).max(128) });
const Authn = Identity.extend({ password: z.string().min(1).max(256) });
const Authz = Identity.extend({ action: z.enum(["publish", "subscribe"]), topic: z.string().min(1).max(512) });

async function findGateway(username: string, clientid: string) {
  if (!username.startsWith("gw_")) return null;
  const id = username.slice(3);
  if (clientid !== id) return null;
  const [row] = await db.select({ gateway: gateways }).from(gateways)
    .innerJoin(buildings, eq(buildings.id, gateways.buildingId))
    .where(and(eq(gateways.id, id), eq(gateways.enabled, true), eq(buildings.active, true))).limit(1);
  return row?.gateway.metadata.mqttUsername === username ? row.gateway : null;
}

mqttRouter.post("/authn", async (req, res) => {
  try {
    const parsed = Authn.safeParse(req.body);
    if (!parsed.success) return void res.json({ result: "deny" });
    const { username, password, clientid } = parsed.data;
    let allow = false;
    if (username === config.MQTT_INGEST_USERNAME) {
      allow = equalSecret(password, config.MQTT_INGEST_PASSWORD);
    } else {
      const gateway = await findGateway(username, clientid);
      const hash = gateway?.metadata.mqttPasswordHash;
      allow = typeof hash === "string" && await verifyPassword(password, hash);
    }
    res.json({ result: allow ? "allow" : "deny", is_superuser: false });
  } catch { res.json({ result: "deny" }); }
});

mqttRouter.post("/authz", async (req, res) => {
  try {
    const parsed = Authz.safeParse(req.body);
    if (!parsed.success) return void res.json({ result: "deny" });
    const { username, clientid, action, topic } = parsed.data;
    if (username === config.MQTT_INGEST_USERNAME) {
      return void res.json({ result: action === "subscribe" && [TELEMETRY_TOPIC, WATER_TELEMETRY_TOPIC, GATEWAY_STATUS_TOPIC].includes(topic) ? "allow" : "deny" });
    }
    const gateway = await findGateway(username, clientid);
    if (!gateway || action !== "publish") return void res.json({ result: "deny" });
    const status = parseGatewayStatusTopic(topic);
    if (status) return void res.json({ result: status.buildingId === gateway.buildingId && status.gatewayId === gateway.id ? "allow" : "deny" });
    const reading = parseTelemetryTopic(topic) ?? parseWaterTelemetryTopic(topic);
    if (!reading || reading.buildingId !== gateway.buildingId) return void res.json({ result: "deny" });
    const [device] = await db.select({ id: devices.id }).from(devices).where(and(
      eq(devices.id, reading.deviceId), eq(devices.gatewayId, gateway.id), eq(devices.buildingId, gateway.buildingId), eq(devices.enabled, true),
    )).limit(1);
    res.json({ result: device ? "allow" : "deny" });
  } catch { res.json({ result: "deny" }); }
});
