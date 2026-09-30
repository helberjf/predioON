import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { deviceMetrics, devices } from "@predioon/db/runtime";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";
import { assertDeviceGateway, assertEquipmentCapability, assertEquipmentCreation, assertEquipmentReadScope, equipmentWrite } from "../equipment/authorization.js";

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
  const { buildingId } = query<z.infer<typeof ListQuerySchema>>(req);
  const rows = await inTenantContext(req, async (tx) => {
    if (buildingId) await assertEquipmentReadScope(tx,buildingId,"device");
    return tx.select().from(devices).where(buildingId ? eq(devices.buildingId,buildingId) : undefined).orderBy(asc(devices.name));
  });

  res.json({ items: rows });
});

devicesRouter.get("/:deviceId/metrics", async (req, res) => {
  const rows = await inTenantContext(req, async (tx) => {
    const [device] = await tx.select().from(devices).where(eq(devices.id, param(req, "deviceId"))).limit(1);
    if (!device) throw notFound("Dispositivo não encontrado");
    return tx.select().from(deviceMetrics).where(eq(deviceMetrics.deviceId, device.id)).orderBy(asc(deviceMetrics.key));
  });
  res.json({ items: rows });
});

devicesRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await equipmentWrite(() => inTenantContext(req, async (tx) => {
    await assertEquipmentCreation(tx,input.buildingId);
    await assertDeviceGateway(tx,input.buildingId,null,input.gatewayId ?? null);
    const id = generateId("dev");
    await tx
      .insert(devices)
      .values({ id, ...input, metadata: input.metadata ?? {} });
    // STABLE point authorization sees the inserted row on the next statement.
    const [created] = await tx.select().from(devices).where(eq(devices.id,id)).limit(1);
    if (!created) throw notFound("Dispositivo não encontrado");
    await recordAudit(tx, req, {
      buildingId: created!.buildingId,
      userId: auth.userId,
      action: "DEVICE_CREATED",
      resourceType: "device",
      resourceId: created!.id,
    });
    return created!;
  }));

  res.status(201).json(row);
});

devicesRouter.patch("/:deviceId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await equipmentWrite(() => inTenantContext(req, async (tx) => {
    let [current] = await tx.select().from(devices).where(eq(devices.id, param(req, "deviceId"))).limit(1);
    if (!current) throw notFound("Dispositivo não encontrado");
    await assertEquipmentCapability(tx,current.buildingId,"device",current.id,"devices:configure");
    [current] = await tx.select().from(devices).where(eq(devices.id,current.id)).limit(1).for("update");
    if (!current) throw notFound("Dispositivo não encontrado");
    // A lock wait can outlive a grant. Read again using a fresh RLS snapshot.
    [current] = await tx.select().from(devices).where(eq(devices.id,current.id)).limit(1);
    if (!current) throw notFound("Dispositivo não encontrado");
    await assertEquipmentCapability(tx,current.buildingId,"device",current.id,"devices:configure");
    await assertDeviceGateway(tx,current.buildingId,current.id,input.gatewayId === undefined ? current.gatewayId : input.gatewayId);

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
  }));

  res.json(row);
});

devicesRouter.post("/:deviceId/metrics", validateBody(MetricSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof MetricSchema>;

  const row = await equipmentWrite(() => inTenantContext(req, async (tx) => {
    let [device] = await tx.select().from(devices).where(eq(devices.id, param(req, "deviceId"))).limit(1);
    if (!device) throw notFound("Dispositivo não encontrado");
    await assertEquipmentCapability(tx,device.buildingId,"device",device.id,"devices:configure");
    [device] = await tx.select().from(devices).where(eq(devices.id,device.id)).limit(1).for("update");
    if (!device) throw notFound("Dispositivo não encontrado");
    [device] = await tx.select().from(devices).where(eq(devices.id,device.id)).limit(1);
    if (!device) throw notFound("Dispositivo não encontrado");
    await assertEquipmentCapability(tx,device.buildingId,"device",device.id,"devices:configure");

    const [created] = await tx
      .insert(deviceMetrics)
      .values({ buildingId: device.buildingId, deviceId: device.id, ...input })
      .returning();
    await recordAudit(tx,req,{
      buildingId:device.buildingId,
      userId:auth.userId,
      action:"DEVICE_METRIC_CREATED",
      resourceType:"device_metric",
      resourceId:created!.id,
    });
    return created!;
  }));

  res.status(201).json(row);
});
