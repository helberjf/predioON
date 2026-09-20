import { Router } from "express";
import { desc } from "drizzle-orm";
import {
  alerts,
  auditLogs,
  buildings,
  db,
  devices,
  gateways,
  organizations,
  telemetry,
  users,
} from "@predioon/db";

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  if (req.auth?.role !== "PLATFORM_ADMIN") {
    return res.status(403).json({ error: "Platform administrator access required" });
  }
  next();
});

adminRouter.get("/snapshot", async (_req, res) => {
  const [
    organizationRows,
    buildingRows,
    gatewayRows,
    deviceRows,
    alertRows,
    userRows,
    auditRows,
    telemetryRows,
  ] = await Promise.all([
    db.select().from(organizations).orderBy(organizations.name),
    db.select().from(buildings).orderBy(buildings.name),
    db.select().from(gateways).orderBy(desc(gateways.lastSeenAt)),
    db.select().from(devices).orderBy(devices.name),
    db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(100),
    db.select().from(users).orderBy(users.name),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
    db.select().from(telemetry).orderBy(desc(telemetry.time)).limit(100),
  ]);

  res.json({
    organizations: organizationRows,
    buildings: buildingRows,
    gateways: gatewayRows,
    devices: deviceRows,
    alerts: alertRows,
    users: userRows,
    auditLogs: auditRows,
    telemetry: telemetryRows,
    generatedAt: new Date().toISOString(),
  });
});
