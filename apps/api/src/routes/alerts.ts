import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { alerts, auditLogs, db } from "@predioon/db";

export const alertsRouter = Router();

alertsRouter.get("/", async (req, res) => {
  const auth = req.auth!;
  const rows = auth.role === "PLATFORM_ADMIN"
    ? await db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(100)
    : await db.select().from(alerts).where(eq(alerts.buildingId, auth.buildingId!)).orderBy(desc(alerts.createdAt)).limit(100);
  res.json(rows);
});

alertsRouter.post("/:alertId/acknowledge", async (req, res) => {
  const auth = req.auth!;
  if (auth.role === "RESIDENT") return res.status(403).json({ error: "Residents cannot acknowledge alerts" });

  const rows = await db.select().from(alerts).where(eq(alerts.id, req.params.alertId)).limit(1);
  const alert = rows[0];
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  if (auth.role !== "PLATFORM_ADMIN" && alert.buildingId !== auth.buildingId) {
    return res.status(403).json({ error: "Alert outside tenant scope" });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(alerts).set({
      status: "ACKNOWLEDGED",
      acknowledgedBy: auth.userId,
      acknowledgedAt: now,
    }).where(eq(alerts.id, alert.id));

    await tx.insert(auditLogs).values({
      buildingId: alert.buildingId,
      userId: auth.userId,
      actorType: "USER",
      action: "ALERT_ACKNOWLEDGED",
      resourceType: "alert",
      resourceId: alert.id,
      ipAddress: req.ip,
      userAgent: req.header("user-agent") ?? null,
    });
  });

  res.json({ id: alert.id, status: "ACKNOWLEDGED" });
});

alertsRouter.post("/:alertId/resolve", async (req, res) => {
  const auth = req.auth!;
  if (auth.role === "RESIDENT") return res.status(403).json({ error: "Residents cannot resolve alerts" });

  const rows = await db.select().from(alerts).where(eq(alerts.id, req.params.alertId)).limit(1);
  const alert = rows[0];
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  if (auth.role !== "PLATFORM_ADMIN" && alert.buildingId !== auth.buildingId) {
    return res.status(403).json({ error: "Alert outside tenant scope" });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(alerts).set({
      status: "RESOLVED",
      resolvedBy: auth.userId,
      resolvedAt: now,
    }).where(eq(alerts.id, alert.id));

    await tx.insert(auditLogs).values({
      buildingId: alert.buildingId,
      userId: auth.userId,
      actorType: "USER",
      action: "ALERT_RESOLVED",
      resourceType: "alert",
      resourceId: alert.id,
      ipAddress: req.ip,
      userAgent: req.header("user-agent") ?? null,
    });
  });

  res.json({ id: alert.id, status: "RESOLVED" });
});
