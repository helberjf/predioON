import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { parkingLots, type AppTransaction } from "@predioon/db/runtime";
import {
  ParkingConfigSchema,
  ParkingOccupancySchema,
  parkingAvailability,
  parkingFeature,
} from "@predioon/shared";
import { observationIsCurrent } from "../../auth/features.js";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import {
  badRequest,
  conflict,
  forbidden,
  HttpError,
  notFound,
  pgErrorCode,
} from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";
import {
  assertParkingFeature,
  assertParkingManagement,
  assertParkingScope,
  assertParkingSensor,
  assertParkingTarget,
  lockParkingTarget,
  parkingFeatures,
} from "./authorization.js";

export const parkingRouter = Router();
parkingRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const QuerySchema = z.object({ buildingId: z.string().min(1) });
const CreateSchema = ParkingConfigSchema.strict();
const EditSchema = z
  .object({
    capacity: ParkingConfigSchema.shape.capacity,
    sensorId: z.string().min(1).nullable().optional(),
    staleAfterSeconds: z.number().int().min(30).max(86400).optional(),
    version: z.number().int().positive(),
  })
  .strict();
const OccupancySchema = ParkingOccupancySchema.strict();
const view = (row: typeof parkingLots.$inferSelect) => ({
  ...row,
  ...parkingAvailability(row),
});
function parkingId(req: Request): string {
  const id = param(req, "parkingId");
  if (!z.string().uuid().safeParse(id).success)
    throw notFound("Estacionamento não encontrado");
  return id;
}
async function inParking<T>(
  req: Request,
  run: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await inTenantContext(req, run);
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === "42501")
      throw forbidden("Sem a capacidade necessária para estas vagas");
    if (["23503", "23514", "22023", "22P02"].includes(code ?? ""))
      throw badRequest("Dados do estacionamento inválidos");
    if (["23505", "40001", "40P01"].includes(code ?? ""))
      throw conflict(
        "As vagas foram atualizadas ou este sensor já está vinculado. Recarregue antes de salvar.",
      );
    if (code)
      throw new HttpError(500, "Não foi possível salvar ou consultar as vagas");
    throw error;
  }
}
async function lockedParking(
  tx: AppTransaction,
  id: string,
  sensorId?: string | null,
) {
  const [visible] = await tx
    .select()
    .from(parkingLots)
    .where(eq(parkingLots.id, id))
    .limit(1);
  if (!visible) throw notFound("Estacionamento não encontrado");
  await assertParkingManagement(tx, visible);
  // Ingestion locks its device first; retargeting must use the same order.
  // Even an explicitly unchanged target can change while this request waits.
  if (sensorId) await lockParkingTarget(tx, visible, sensorId);
  await tx
    .select({ id: parkingLots.id })
    .from(parkingLots)
    .where(eq(parkingLots.id, id))
    .for("no key update");
  const [current] = await tx
    .select()
    .from(parkingLots)
    .where(eq(parkingLots.id, id))
    .limit(1);
  if (!current) throw notFound("Estacionamento não encontrado");
  await assertParkingManagement(tx, current);
  return current;
}

parkingRouter.get("/", validateQuery(QuerySchema), async (req, res) => {
  const { buildingId } = query<z.infer<typeof QuerySchema>>(req);
  const rows = await inParking(req, async (tx) => {
    const features = await parkingFeatures(tx, buildingId);
    const candidates = await tx
      .select()
      .from(parkingLots)
      .where(eq(parkingLots.buildingId, buildingId))
      .orderBy(asc(parkingLots.vehicleType));
    const visible = candidates.filter(
      (row) => features[parkingFeature(row.vehicleType)].enabled,
    );
    await assertParkingScope(tx, buildingId);
    if (!visible.length) return [];
    const current = await tx
      .select({ id: parkingLots.id })
      .from(parkingLots)
      .where(
        inArray(
          parkingLots.id,
          visible.map((row) => row.id),
        ),
      );
    const allowed = new Set(current.map((row) => row.id));
    return visible
      .filter((row) => allowed.has(row.id))
      .map((row) =>
        view(
          observationIsCurrent(
            features,
            [parkingFeature(row.vehicleType)],
            row.observedAt,
          )
            ? row
            : { ...row, occupied: null, observedAt: null, source: "UNKNOWN" },
        ),
      );
  });
  res.json({ items: rows });
});
parkingRouter.post("/", validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>,
    auth = currentAuth(req);
  const row = await inParking(req, async (tx) => {
    await assertParkingTarget(tx, input.buildingId, input.sensorId);
    assertParkingFeature(
      await parkingFeatures(tx, input.buildingId),
      input.vehicleType,
    );
    await assertParkingSensor(tx, input.buildingId, input.sensorId);
    const id = randomUUID();
    await tx.execute(sql`insert into parking_lots(id,building_id,vehicle_type,capacity,sensor_id,stale_after_seconds)
      values(${id}::uuid,${input.buildingId},${input.vehicleType},${input.capacity},${input.sensorId},${input.staleAfterSeconds})`);
    const [created] = await tx
      .select()
      .from(parkingLots)
      .where(eq(parkingLots.id, id))
      .limit(1);
    if (!created)
      throw forbidden("Sem a capacidade necessária para estas vagas");
    // INSERT may wait on the sensor foreign key. Read its current state and
    // authority in a new statement before making configuration/audit durable.
    await assertParkingManagement(tx, created);
    await assertParkingSensor(tx, input.buildingId, input.sensorId, created.id);
    await recordAudit(tx, req, {
      buildingId: input.buildingId,
      userId: auth.userId,
      action: "PARKING_CONFIGURED",
      resourceType: "parking",
      resourceId: id,
      metadata: input,
    });
    return created;
  });
  res.status(201).json(view(row));
});
parkingRouter.patch(
  "/:parkingId",
  validateBody(EditSchema),
  async (req, res) => {
    const id = parkingId(req),
      input = req.body as z.infer<typeof EditSchema>,
      auth = currentAuth(req);
    const row = await inParking(req, async (tx) => {
      const current = await lockedParking(tx, id, input.sensorId);
      assertParkingFeature(
        await parkingFeatures(tx, current.buildingId),
        current.vehicleType,
      );
      if (current.version !== input.version)
        throw conflict(
          "As vagas foram atualizadas. Recarregue antes de salvar.",
        );
      const sensorId =
        input.sensorId === undefined ? current.sensorId : input.sensorId;
      const sensorChanged = current.sensorId !== sensorId;
      if (sensorChanged)
        await assertParkingTarget(tx, current.buildingId, sensorId);
      await assertParkingSensor(tx, current.buildingId, sensorId, current.id);
      if (
        !sensorChanged &&
        current.occupied !== null &&
        current.occupied > input.capacity
      )
        throw badRequest(
          "A capacidade não pode ser menor que a ocupação informada",
        );
      const [updated] = await tx
        .update(parkingLots)
        .set({
          capacity: input.capacity,
          sensorId,
          staleAfterSeconds:
            input.staleAfterSeconds ?? current.staleAfterSeconds,
          version: current.version + 1,
          updatedAt: sql`clock_timestamp()`,
          ...(sensorChanged
            ? { occupied: null, observedAt: null, source: "UNKNOWN" as const }
            : {}),
        })
        .where(eq(parkingLots.id, id))
        .returning();
      if (!updated)
        throw forbidden("Sem a capacidade necessária para estas vagas");
      await recordAudit(tx, req, {
        buildingId: current.buildingId,
        userId: auth.userId,
        action: "PARKING_CONFIGURED",
        resourceType: "parking",
        resourceId: id,
        metadata: {
          previous: { capacity: current.capacity, sensorId: current.sensorId },
          ...input,
        },
      });
      return updated;
    });
    res.json(view(row));
  },
);
parkingRouter.patch(
  "/:parkingId/occupancy",
  validateBody(OccupancySchema),
  async (req, res) => {
    const id = parkingId(req),
      input = req.body as z.infer<typeof OccupancySchema>,
      auth = currentAuth(req);
    const row = await inParking(req, async (tx) => {
      const current = await lockedParking(tx, id);
      assertParkingFeature(
        await parkingFeatures(tx, current.buildingId),
        current.vehicleType,
      );
      if (current.version !== input.version)
        throw conflict(
          "As vagas foram atualizadas. Recarregue antes de salvar.",
        );
      if (input.occupied > current.capacity)
        throw badRequest("A ocupação não pode ultrapassar a capacidade");
      const [updated] = await tx
        .update(parkingLots)
        .set({
          occupied: input.occupied,
          source: "MANUAL",
          observedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
          version: current.version + 1,
        })
        .where(eq(parkingLots.id, id))
        .returning();
      if (!updated)
        throw forbidden("Sem a capacidade necessária para estas vagas");
      await recordAudit(tx, req, {
        buildingId: current.buildingId,
        userId: auth.userId,
        action: "PARKING_OCCUPANCY_UPDATED",
        resourceType: "parking",
        resourceId: id,
        metadata: {
          previousOccupied: current.occupied,
          occupied: input.occupied,
          source: "MANUAL",
        },
      });
      return updated;
    });
    res.json(view(row));
  },
);
