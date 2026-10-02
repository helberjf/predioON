import { assertFeature, buildingFeatures, observationIsCurrent } from "../../auth/features.js";
import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { devices, gateways, parkingLots, type AppTransaction } from "@predioon/db/runtime";
import { ParkingConfigSchema, ParkingOccupancySchema, parkingAvailability, parkingFeature } from "@predioon/shared";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole } from "../../auth/middleware.js";
import { badRequest, conflict, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const parkingRouter = Router();
const QuerySchema = z.object({ buildingId: z.string().min(1) });
const EditSchema = ParkingConfigSchema.omit({ buildingId: true, vehicleType: true }).extend({ version: z.number().int().positive() });
const view = (row: typeof parkingLots.$inferSelect) => ({ ...row, ...parkingAvailability(row) });

async function verifySensor(tx: AppTransaction, buildingId: string, sensorId: string | null): Promise<void> {
  if (!sensorId) return;
  const [sensor] = await tx.select().from(devices).where(and(eq(devices.id, sensorId), eq(devices.buildingId, buildingId), eq(devices.enabled, true))).limit(1);
  if (!sensor || sensor.type !== "PARKING_SENSOR") throw badRequest("Selecione um sensor de estacionamento ativo deste prédio");
  if (sensor.gatewayId) {
    const [gateway] = await tx.select().from(gateways).where(and(eq(gateways.id, sensor.gatewayId), eq(gateways.buildingId, buildingId), eq(gateways.enabled, true))).limit(1);
    if (!gateway) throw badRequest("O gateway do sensor precisa estar ativo neste prédio");
  }
}
function rethrowConstraint(error: unknown): never {
  if (pgErrorCode(error) === "23505") throw conflict("Este tipo de vaga já foi cadastrado, ou o sensor já está vinculado a outra contagem");
  throw error;
}

parkingRouter.get("/", validateQuery(QuerySchema), async (req, res) => {
  const { buildingId } = query<z.infer<typeof QuerySchema>>(req);
  assertBuildingAccess(currentAuth(req), buildingId);
  const rows = await inTenantContext(req, async tx => {
    const features = await buildingFeatures(tx, buildingId);
    const lots = await tx.select().from(parkingLots).where(eq(parkingLots.buildingId, buildingId)).orderBy(asc(parkingLots.vehicleType));
    return lots.filter(row => features[parkingFeature(row.vehicleType)].enabled).map(row => view(observationIsCurrent(features, [parkingFeature(row.vehicleType)], row.observedAt) ? row : { ...row, occupied: null, observedAt: null, source: "UNKNOWN" }));
  });
  res.json({ items: rows });
});

parkingRouter.post("/", requireRole("BUILDING_ADMIN"), validateBody(ParkingConfigSchema), async (req, res) => {
  const input = req.body as z.infer<typeof ParkingConfigSchema>;
  const auth = currentAuth(req);
  assertBuildingAccess(auth, input.buildingId, "BUILDING_ADMIN");
  try {
    const row = await inTenantContext(req, async tx => {
      await assertFeature(tx, input.buildingId, parkingFeature(input.vehicleType), true);
      await verifySensor(tx, input.buildingId, input.sensorId);
      const [created] = await tx.insert(parkingLots).values(input).returning();
      await recordAudit(tx, req, { buildingId: input.buildingId, userId: auth.userId, action: "PARKING_CONFIGURED", resourceType: "parking", resourceId: created!.id, metadata: input });
      return created!;
    });
    res.status(201).json(view(row));
  } catch (error) { rethrowConstraint(error); }
});

parkingRouter.patch("/:parkingId", requireRole("BUILDING_ADMIN"), validateBody(EditSchema), async (req, res) => {
  const input = req.body as z.infer<typeof EditSchema>;
  const auth = currentAuth(req);
  try {
    const row = await inTenantContext(req, async tx => {
      const [current] = await tx.select().from(parkingLots).where(eq(parkingLots.id, param(req, "parkingId"))).limit(1).for("update");
      if (!current) throw notFound("Estacionamento não encontrado");
      assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, parkingFeature(current.vehicleType), true);
      if (current.version !== input.version) throw conflict("As vagas foram atualizadas. Recarregue antes de salvar.");
      await verifySensor(tx, current.buildingId, input.sensorId);
      const sensorChanged = current.sensorId !== input.sensorId;
      if (!sensorChanged && current.occupied !== null && current.occupied > input.capacity) throw badRequest("A capacidade não pode ser menor que a ocupação informada");
      const [updated] = await tx.update(parkingLots).set({ capacity: input.capacity, sensorId: input.sensorId, staleAfterSeconds: input.staleAfterSeconds, version: current.version + 1, updatedAt: new Date(), ...(sensorChanged ? { occupied: null, observedAt: null, source: "UNKNOWN" as const } : {}) }).where(eq(parkingLots.id, current.id)).returning();
      await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "PARKING_CONFIGURED", resourceType: "parking", resourceId: current.id, metadata: { previous: { capacity: current.capacity, sensorId: current.sensorId }, ...input } });
      return updated!;
    });
    res.json(view(row));
  } catch (error) { rethrowConstraint(error); }
});

parkingRouter.patch("/:parkingId/occupancy", requireRole("BUILDING_ADMIN"), validateBody(ParkingOccupancySchema), async (req, res) => {
  const input = req.body as z.infer<typeof ParkingOccupancySchema>;
  const auth = currentAuth(req);
  const row = await inTenantContext(req, async tx => {
    const [current] = await tx.select().from(parkingLots).where(eq(parkingLots.id, param(req, "parkingId"))).limit(1).for("update");
    if (!current) throw notFound("Estacionamento não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");
    await assertFeature(tx, current.buildingId, parkingFeature(current.vehicleType), true);
    if (current.version !== input.version) throw conflict("As vagas foram atualizadas. Recarregue antes de salvar.");
    if (input.occupied > current.capacity) throw badRequest("A ocupação não pode ultrapassar a capacidade");
    const now = new Date();
    const [updated] = await tx.update(parkingLots).set({ occupied: input.occupied, source: "MANUAL", observedAt: now, updatedAt: now, version: current.version + 1 }).where(eq(parkingLots.id, current.id)).returning();
    await recordAudit(tx, req, { buildingId: current.buildingId, userId: auth.userId, action: "PARKING_OCCUPANCY_UPDATED", resourceType: "parking", resourceId: current.id, metadata: { previousOccupied: current.occupied, occupied: input.occupied, source: "MANUAL" } });
    return updated!;
  });
  res.json(view(row));
});
