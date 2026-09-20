import { Router } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { deviceMetrics, devices } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole, scopedBuildingIds } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const devicesRouter = Router();

const ListQuerySchema = z.object({ buildingId: z.string().optional() });

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  gatewayId: z.string().min(1).nullable().optional(),
  name: z.string().min(2).max(120),
  type: z.string().min(2).max(60),
  hardwareAddress: z.string().max(120).optional(),
  /** Modbus map of the specific sensor model: slave id, register, scale, unit. Never hard-coded. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const UpdateSchema = CreateSchema.partial().omit({ buildingId: true }).extend({ enabled: z.boolean().optional() });

const MetricSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  unit: z.string().max(16).optional(),
  dataType: z.enum(["number", "boolean", "string"]).default("number"),
  minExpected: z.number().optional(),
  maxExpected: z.number().optional(),
  decimals: z.number().int().min(0).max(6).default(2),
});

devicesRouter.get("/", validateQuery(ListQuerySchema), async (req, res) => {
  const auth = currentAuth(req);
  const { buildingId } = query<z.infer<typeof ListQuerySchema>>(req);
  if (buildingId) assertBuildingAccess(auth, buildingId);
  const scope = scopedBuildingIds(auth);

  const rows = await inTenantContext(req, (tx) => {
    const filters = [
      buildingId ? eq(devices.buildingId, buildingId) : undefined,
      scope && !buildingId ? inArray(devices.buildingId, scope.length ? scope : [""]) : undefined,
    ].filter(Boolean);
    return tx.select().from(devices).where(filters.length ? and(...filters) : undefined).orderBy(asc(devices.name));
  });

  res.json({ items: rows });
});

devicesRouter.get("/:deviceId/metrics", async (req, res) => {
  const auth = currentAuth(req);
  const rows = await inTenantContext(req, async (tx) => {
    const [device] = await tx.select().from(devices).where(eq(devices.id, param(req, "deviceId"))).limit(1);
    if (!device) throw notFound("Dispositivo não encontrado");
    assertBuildingAccess(auth, device.buildingId);
    return tx.select().from(deviceMetrics).where(eq(deviceMetrics.deviceId, device.id)).orderBy(asc(deviceMetrics.key));
  });
  res.json({ items: rows });
});

devicesRouter.post("/", requireRole("PLATFORM_ADMIN"), validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx
      .insert(devices)
      .values({ id: generateId("dev"), ...input, metadata: input.metadata ?? {} })
      .returning();
    await recordAudit(tx, req, {
      buildingId: created!.buildingId,
      userId: auth.userId,
      action: "DEVICE_CREATED",
      resourceType: "device",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(row);
});

devicesRouter.patch("/:deviceId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(devices).where(eq(devices.id, param(req, "deviceId"))).limit(1);
    if (!current) throw notFound("Dispositivo não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");

    const [updated] = await tx
      .update(devices)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(devices.id, current.id))
      .returning();
    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "DEVICE_UPDATED",
      resourceType: "device",
      resourceId: current.id,
      metadata: input,
    });
    return updated!;
  });

  res.json(row);
});

devicesRouter.post("/:deviceId/metrics", requireRole("BUILDING_ADMIN"), validateBody(MetricSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof MetricSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [device] = await tx.select().from(devices).where(eq(devices.id, param(req, "deviceId"))).limit(1);
    if (!device) throw notFound("Dispositivo não encontrado");
    assertBuildingAccess(auth, device.buildingId, "BUILDING_ADMIN");

    const [created] = await tx
      .insert(deviceMetrics)
      .values({ buildingId: device.buildingId, deviceId: device.id, ...input })
      .returning();
    return created!;
  });

  res.status(201).json(row);
});
