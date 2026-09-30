import { assertFeature, buildingFeatures, filterFeatureRows } from "../../auth/features.js";
import { Router, type Request } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { buildings, devices, gateways, users, memberships, gates, gateCommands, type AppTransaction } from "@predioon/db/runtime";
import { ACCESS_COMMAND_TTL_MS, GateConfigSchema, GatePatchSchema, OpenGateSchema, accessAvailability, accessRole, deviceFeatures, gateFeature } from "@predioon/shared";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { badRequest, conflict, forbidden, HttpError, notFound, pgErrorCode } from "../../http/errors.js";
import { param } from "../../http/params.js";
import { query, validateBody, validateQuery } from "../../http/validate.js";
import { recordAudit } from "../audit/repo.js";

export const accessRouter = Router();
const ListQuery = z.object({ buildingId: z.string().min(1).max(128) });

/** JWT identifies the person; current database records decide physical access. */
async function freshRole(tx: AppTransaction, req: Request, buildingId: string, manage = false) {
  const userId = currentAuth(req).userId;
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  const [membership] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.buildingId, buildingId))).limit(1);
  const role = accessRole(user, membership);
  if (!role || (manage && role === "RESIDENT")) throw forbidden("Sem permissão atual para este acesso");
  const [building] = await tx.select({ active: buildings.active }).from(buildings).where(eq(buildings.id, buildingId)).limit(1);
  if (!building?.active) throw forbidden("Prédio fora do seu escopo");
  return role;
}

async function hardware(tx: AppTransaction, input: { buildingId: string; gatewayId: string; deviceId: string }) {
  const [gateway] = await tx.select().from(gateways).where(and(eq(gateways.id, input.gatewayId), eq(gateways.buildingId, input.buildingId))).limit(1);
  const [device] = await tx.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.buildingId, input.buildingId), eq(devices.gatewayId, input.gatewayId))).limit(1);
  return { gateway, device };
}
/** Gate-bound status projection preserves physical access without inventory access. */
async function accessHardware(tx: AppTransaction, gate: { buildingId: string; id: string }) {
  const [row] = await tx.execute(sql`select * from app_access_hardware_state(${gate.buildingId},${gate.id}::uuid)`);
  if (!row) return { gateway: null, device: null };
  const state = row as unknown as {
    gateway_enabled: boolean; gateway_status: string; gateway_last_seen_at: Date | string | null;
    device_enabled: boolean; device_status: string; device_last_seen_at: Date | string | null;
  };
  return {
    gateway: { enabled: state.gateway_enabled, status: state.gateway_status, lastSeenAt: state.gateway_last_seen_at ? new Date(state.gateway_last_seen_at) : null },
    device: { enabled: state.device_enabled, status: state.device_status, lastSeenAt: state.device_last_seen_at ? new Date(state.device_last_seen_at) : null },
  };
}
function commandView(command: typeof gateCommands.$inferSelect) {
  const expired = ["PENDING", "SENT"].includes(command.status) && command.expiresAt <= new Date();
  return { ...command, status: expired ? "EXPIRED" : command.status, failureReason: expired ? "Prazo de confirmação encerrado" : command.failureReason };
}
async function audit(req: Request, tx: AppTransaction, buildingId: string, gateId: string, action: string, metadata: Record<string, unknown> = {}) {
  await recordAudit(tx, req, { userId: currentAuth(req).userId, buildingId, resourceType: "gate", resourceId: gateId, action, metadata });
}

accessRouter.get("/", validateQuery(ListQuery), async (req, res) => {
  const { buildingId } = query<z.infer<typeof ListQuery>>(req);
  const result = await inTenantContext(req, async (tx) => {
    const role = await freshRole(tx, req, buildingId);
    const features = await buildingFeatures(tx, buildingId);
    const rows = await tx.select().from(gates).where(eq(gates.buildingId, buildingId)).orderBy(gates.name);
    const commands = await tx.select().from(gateCommands).where(eq(gateCommands.buildingId, buildingId)).orderBy(desc(gateCommands.createdAt)).limit(200);
    const items = await Promise.all(rows.filter(gate => features[gateFeature(gate.kind)].enabled).map(async gate => {
      const { gateway, device } = await accessHardware(tx, gate);
      const reason = accessAvailability(gate, gateway, device, role);
      const latest = commands.find(command => command.gateId === gate.id);
      return { ...gate, available: !reason, unavailableReason: reason, latestCommand: latest ? commandView(latest) : null };
    }));
    const canManage = role !== "RESIDENT";
    return { items, canManage,
      gateways: canManage ? await tx.select({ id: gateways.id, name: gateways.name }).from(gateways).where(eq(gateways.buildingId, buildingId)) : [],
      devices: canManage ? (await filterFeatureRows(tx, await tx.select().from(devices).where(eq(devices.buildingId, buildingId)), device => deviceFeatures(device.type), { any: true, manage: true })).map(({ id, name, gatewayId, type }) => ({ id, name, gatewayId, type })) : [],
    };
  });
  res.setHeader("Cache-Control", "no-store"); res.json(result);
});

accessRouter.get("/commands/:commandId", async (req, res) => {
  const id = z.string().uuid().parse(param(req, "commandId"));
  const command = await inTenantContext(req, async tx => {
    const [row] = await tx.select().from(gateCommands).where(eq(gateCommands.id, id)).limit(1);
    if (!row) throw notFound("Solicitação não encontrada");
    await freshRole(tx, req, row.buildingId);
    const [gate] = await tx.select().from(gates).where(eq(gates.id, row.gateId)).limit(1);
    if (!gate) throw notFound("Acesso não encontrado");
    await assertFeature(tx, row.buildingId, gateFeature(gate.kind));
    return commandView(row);
  });
  res.setHeader("Cache-Control", "no-store"); res.json(command);
});

accessRouter.post("/", validateBody(GateConfigSchema), async (req, res) => {
  const input = req.body as z.infer<typeof GateConfigSchema>;
  try {
    const row = await inTenantContext(req, async tx => {
      await freshRole(tx, req, input.buildingId, true);
      await assertFeature(tx, input.buildingId, gateFeature(input.kind), true);
      const { gateway, device } = await hardware(tx, input);
      if (!gateway || !device || !["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(device.type)) throw badRequest("Selecione um controlador de portão e seu gateway neste prédio");
      const [created] = await tx.insert(gates).values(input).returning();
      await audit(req, tx, input.buildingId, created!.id, "ACCESS_CONFIG_CREATED", { enabled: input.enabled, allowResidents: input.allowResidents });
      return created!;
    });
    res.status(201).json(row);
  } catch (error) { if (pgErrorCode(error) === "23505") throw conflict("Este controlador já está associado a um acesso"); throw error; }
});

accessRouter.patch("/:gateId", validateBody(GatePatchSchema), async (req, res) => {
  const id = z.string().uuid().parse(param(req, "gateId"));
  const input = req.body as z.infer<typeof GatePatchSchema>;
  try {
    const updated = await inTenantContext(req, async tx => {
      const [gate] = await tx.select().from(gates).where(eq(gates.id, id)).limit(1);
      if (!gate) throw forbidden("Sem permissão atual para este acesso");
      await freshRole(tx, req, gate.buildingId, true);
      await assertFeature(tx, gate.buildingId, gateFeature(gate.kind), true);
      if (input.kind) await assertFeature(tx, gate.buildingId, gateFeature(input.kind), true);
      const next = { ...gate, ...input };
      const { gateway, device } = await hardware(tx, next);
      if (!gateway || !device || !["GARAGE_GATE", "PEDESTRIAN_GATE", "GATE_CONTROLLER"].includes(device.type)) throw badRequest("Controlador e gateway precisam pertencer a este prédio");
      const [row] = await tx.update(gates).set({ ...input, updatedAt: new Date() }).where(eq(gates.id, id)).returning();
      await audit(req, tx, gate.buildingId, id, "ACCESS_CONFIG_UPDATED", input);
      return row!;
    });
    res.json(updated);
  } catch (error) { if (pgErrorCode(error) === "23505") throw conflict("Este controlador já está associado a um acesso"); throw error; }
});

accessRouter.post("/:gateId/open", async (req, res) => {
  const auth = currentAuth(req);
  try {
    const parsed = OpenGateSchema.safeParse(req.body);
    const gateId = z.string().uuid().safeParse(param(req, "gateId"));
    if (!parsed.success || !gateId.success) throw badRequest("Solicitação inválida. Atualize a página e tente novamente");
    const { requestId } = parsed.data;
    const result = await inTenantContext(req, async tx => {
      // Serializes both double clicks and independent API workers without resident UPDATE rights.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`access:user:${auth.userId}`}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`access:gate:${gateId.data}`}, 0))`);
      const [gate] = await tx.select().from(gates).where(eq(gates.id, gateId.data)).limit(1);
      if (!gate) throw forbidden("Sem permissão atual para este acesso");
      const role = await freshRole(tx, req, gate.buildingId);
      await assertFeature(tx, gate.buildingId, gateFeature(gate.kind));
      const [existing] = await tx.select().from(gateCommands).where(and(eq(gateCommands.requestedBy, auth.userId), eq(gateCommands.requestId, requestId))).limit(1);
      if (existing) {
        if (existing.gateId !== gate.id) throw conflict("Identificador de solicitação já utilizado em outro acesso");
        await audit(req, tx, gate.buildingId, gate.id, "ACCESS_REQUEST_REPEATED", { commandId: existing.id, requestId });
        return { command: commandView(existing), repeated: true };
      }
      const { gateway, device } = await accessHardware(tx, gate);
      const reason = accessAvailability(gate, gateway, device, role);
      if (reason) throw conflict(reason);
      // Security-definer boolean includes other residents' requests without exposing them.
      const [limit] = await tx.select({ throttled: sql<boolean>`app_access_request_throttled(${gate.id}::uuid)` }).from(gates).where(eq(gates.id, gate.id)).limit(1);
      if (limit?.throttled) throw new HttpError(429, "Aguarde a confirmação e alguns segundos antes de solicitar outra abertura");
      const createdAt = new Date();
      const [command] = await tx.insert(gateCommands).values({ requestId, gateId: gate.id, buildingId: gate.buildingId, gatewayId: gate.gatewayId, deviceId: gate.deviceId, requestedBy: auth.userId, createdAt, expiresAt: new Date(createdAt.getTime() + ACCESS_COMMAND_TTL_MS) }).returning();
      await audit(req, tx, gate.buildingId, gate.id, "ACCESS_OPEN_REQUESTED", { commandId: command!.id, requestId });
      return { command: commandView(command!), repeated: false };
    });
    res.setHeader("Cache-Control", "no-store"); res.status(result.repeated ? 200 : 202).json(result.command);
  } catch (error) {
    // This separate transaction survives rollback; no inaccessible building is disclosed.
    await inTenantContext(req, tx => recordAudit(tx, req, { userId: auth.userId, action: "ACCESS_REQUEST_REJECTED", resourceType: "gate", resourceId: param(req, "gateId").slice(0, 128), metadata: { reason: error instanceof HttpError ? error.message : "Falha interna" } }));
    throw error;
  }
});
