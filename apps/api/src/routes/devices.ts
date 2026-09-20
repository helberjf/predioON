import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, devices, telemetry } from "@predioon/db";

export const devicesRouter = Router();

devicesRouter.get("/", async (req, res) => {
  const auth = req.auth!;
  const rows = auth.role === "PLATFORM_ADMIN"
    ? await db.select().from(devices)
    : await db.select().from(devices).where(eq(devices.buildingId, auth.buildingId!));
  res.json(rows);
});

devicesRouter.get("/:deviceId/telemetry", async (req, res) => {
  const auth = req.auth!;
  const deviceRows = await db.select().from(devices).where(eq(devices.id, req.params.deviceId)).limit(1);
  const device = deviceRows[0];
  if (!device) return res.status(404).json({ error: "Device not found" });

  if (auth.role !== "PLATFORM_ADMIN" && device.buildingId !== auth.buildingId) {
    return res.status(403).json({ error: "Device outside tenant scope" });
  }

  const rows = await db.select().from(telemetry)
    .where(and(eq(telemetry.deviceId, device.id), eq(telemetry.buildingId, device.buildingId)))
    .orderBy(desc(telemetry.time)).limit(100);
  res.json(rows);
});
