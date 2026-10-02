import { Router, type Request } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  devices,
  gateways,
  gates,
  gateCommands,
  type AppTransaction,
} from "@predioon/db/runtime";
import {
  GateConfigSchema,
  GatePatchSchema,
  OpenGateSchema,
  accessCapabilityAvailability,
  deviceFeatures,
  gateFeature,
} from "@predioon/shared";
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
  accessFeatures,
  accessPermissions,
  assertAccessFeature,
  assertAccessManagement,
  lockAccessTarget,
} from "./authorization.js";

export const accessRouter = Router();
const ListQuery = z.object({ buildingId: z.string().min(1).max(128) });

/** Gate-bound status projection never requires or grants inventory access. */
async function accessHardware(
  tx: AppTransaction,
  gate: { buildingId: string; id: string },
) {
  const [row] = await tx.execute(
    sql`select * from app_access_hardware_state(${gate.buildingId},${gate.id}::uuid)`,
  );
  if (!row) return { gateway: null, device: null };
  const state = row as unknown as {
    gateway_enabled: boolean;
    gateway_status: string;
    gateway_last_seen_at: Date | string | null;
    device_enabled: boolean;
    device_status: string;
    device_last_seen_at: Date | string | null;
  };
  return {
    gateway: {
      enabled: state.gateway_enabled,
      status: state.gateway_status,
      lastSeenAt: state.gateway_last_seen_at
        ? new Date(state.gateway_last_seen_at)
        : null,
    },
    device: {
      enabled: state.device_enabled,
      status: state.device_status,
      lastSeenAt: state.device_last_seen_at
        ? new Date(state.device_last_seen_at)
        : null,
    },
  };
}
function commandView(command: typeof gateCommands.$inferSelect) {
  const expired =
    ["PENDING", "SENT"].includes(command.status) &&
    command.expiresAt <= new Date();
  return {
    ...command,
    status: expired ? "EXPIRED" : command.status,
    failureReason: expired
      ? "Prazo de confirmação encerrado"
      : command.failureReason,
  };
}
/** Controlled SQL returns a receipt even when subsequent history is not granted. */
function receipt(
  value: Record<string, unknown>,
): typeof gateCommands.$inferSelect {
  const date = (key: string) => new Date(value[key] as string);
  return {
    id: value.id as string,
    requestId: value.request_id as string,
    gateId: value.gate_id as string,
    buildingId: value.building_id as string,
    gatewayId: value.gateway_id as string,
    deviceId: value.device_id as string,
    requestedBy: value.requested_by as string,
    status: value.status as (typeof gateCommands.$inferSelect)["status"],
    createdAt: date("created_at"),
    expiresAt: date("expires_at"),
    sentAt: value.sent_at ? date("sent_at") : null,
    acknowledgedAt: value.acknowledged_at ? date("acknowledged_at") : null,
    failureReason: value.failure_reason as string | null,
  };
}
async function audit(
  req: Request,
  tx: AppTransaction,
  buildingId: string,
  gateId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await recordAudit(tx, req, {
    userId: currentAuth(req).userId,
    buildingId,
    resourceType: "gate",
    resourceId: gateId,
    action,
    metadata,
  });
}
function mapAccessError(error: unknown): unknown {
  const code = pgErrorCode(error);
  if (code === "23505")
    return conflict("Este controlador já está associado a um acesso");
  if (code === "42501")
    return forbidden("Sem permissão atual para este acesso");
  if (code === "23514")
    return badRequest("Controlador e gateway precisam pertencer a este prédio");
  if (code === "PF001")
    return new HttpError(403, "Funcionalidade de acesso pausada", {
      code: "FEATURE_DISABLED",
    });
  if (code === "P0429")
    return new HttpError(
      429,
      "Aguarde a confirmação e alguns segundos antes de solicitar outra abertura",
    );
  if (code === "P0001")
    return conflict(
      "Configuração, conexão ou solicitação alterada. Atualize antes de continuar",
    );
  return error;
}

accessRouter.get("/", validateQuery(ListQuery), async (req, res) => {
  const { buildingId } = query<z.infer<typeof ListQuery>>(req);
  const result = await inTenantContext(req, async (tx) => {
    const features = await accessFeatures(tx, buildingId);
    const rows = await tx
      .select()
      .from(gates)
      .where(eq(gates.buildingId, buildingId))
      .orderBy(gates.name);
    const items = await Promise.all(
      rows
        .filter((gate) => features[gateFeature(gate.kind)].enabled)
        .map(async (gate) => {
          const permissions = await accessPermissions(tx, gate);
          if (!permissions.readable) return null;
          const { gateway, device } = await accessHardware(tx, gate);
          const reason = accessCapabilityAvailability(
            gate,
            gateway,
            device,
            permissions.requestable,
          );
          const [latest] = await tx
            .select()
            .from(gateCommands)
            .where(
              and(
                eq(gateCommands.buildingId, buildingId),
                eq(gateCommands.gateId, gate.id),
              ),
            )
            .orderBy(desc(gateCommands.createdAt))
            .limit(1);
          return {
            ...gate,
            canManage: permissions.manageable,
            available: !reason,
            unavailableReason: reason,
            latestCommand: latest ? commandView(latest) : null,
          };
        }),
    );
    const [whole] = await tx.execute(
      sql`select app_has_capability(${buildingId},'gates:read') and app_has_capability(${buildingId},'gates:manage') as allowed`,
    );
    const canManage = whole?.allowed === true;
    return {
      items: items.filter((item) => item !== null),
      canManage,
      gateways: canManage
        ? await tx
            .select({ id: gateways.id, name: gateways.name })
            .from(gateways)
            .where(eq(gateways.buildingId, buildingId))
        : [],
      devices: canManage
        ? (
            await tx
              .select()
              .from(devices)
              .where(eq(devices.buildingId, buildingId))
          )
            .filter((device) =>
              deviceFeatures(device.type).some((key) => features[key].enabled),
            )
            .map(({ id, name, gatewayId, type }) => ({
              id,
              name,
              gatewayId,
              type,
            }))
        : [],
    };
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(result);
});

accessRouter.get("/commands/:commandId", async (req, res) => {
  const id = z.string().uuid().parse(param(req, "commandId"));
  const command = await inTenantContext(req, async (tx) => {
    const [row] = await tx
      .select()
      .from(gateCommands)
      .where(eq(gateCommands.id, id))
      .limit(1);
    if (!row) throw notFound("Solicitação não encontrada");
    const [gate] = await tx
      .select()
      .from(gates)
      .where(eq(gates.id, row.gateId))
      .limit(1);
    if (!gate) throw notFound("Solicitação não encontrada");
    assertAccessFeature(await accessFeatures(tx, row.buildingId), gate.kind);
    return commandView(row);
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(command);
});

accessRouter.post("/", validateBody(GateConfigSchema), async (req, res) => {
  const input = req.body as z.infer<typeof GateConfigSchema>;
  try {
    const row = await inTenantContext(req, async (tx) => {
      await lockAccessTarget(
        tx,
        input.buildingId,
        null,
        input.gatewayId,
        input.deviceId,
      );
      assertAccessFeature(
        await accessFeatures(tx, input.buildingId),
        input.kind,
      );
      // Restrict INSERT to mutable configuration columns; identity/timestamps
      // come from database defaults and are not writable by the runtime role.
      const [inserted] =
        await tx.execute(sql`insert into gates(building_id,name,kind,gateway_id,device_id,enabled,allow_residents)
        values(${input.buildingId},${input.name},${input.kind},${input.gatewayId},${input.deviceId},${input.enabled},${input.allowResidents}) returning id`);
      const [created] = inserted
        ? await tx
            .select()
            .from(gates)
            .where(eq(gates.id, inserted.id as string))
            .limit(1)
        : [];
      if (!created)
        throw forbidden("Sem permissão atual para configurar este acesso");
      await assertAccessManagement(tx, created);
      await audit(
        req,
        tx,
        input.buildingId,
        created.id,
        "ACCESS_CONFIG_CREATED",
        { enabled: input.enabled, allowResidents: input.allowResidents },
      );
      await assertAccessManagement(tx, created);
      return created;
    });
    res.status(201).json(row);
  } catch (error) {
    throw mapAccessError(error);
  }
});

accessRouter.patch(
  "/:gateId",
  validateBody(GatePatchSchema),
  async (req, res) => {
    const id = z.string().uuid().parse(param(req, "gateId"));
    const input = req.body as z.infer<typeof GatePatchSchema>;
    try {
      const updated = await inTenantContext(req, async (tx) => {
        const [initial] = await tx
          .select()
          .from(gates)
          .where(eq(gates.id, id))
          .limit(1);
        if (!initial) throw forbidden("Sem permissão atual para este acesso");
        await assertAccessManagement(tx, initial);
        await lockAccessTarget(
          tx,
          initial.buildingId,
          id,
          input.gatewayId ?? initial.gatewayId,
          input.deviceId ?? initial.deviceId,
        );
        const [gate] = await tx
          .select()
          .from(gates)
          .where(eq(gates.id, id))
          .limit(1)
          .for("update");
        if (!gate) throw forbidden("Sem permissão atual para este acesso");
        if (
          initial.deviceId !== gate.deviceId ||
          initial.gatewayId !== gate.gatewayId
        )
          throw conflict("Configuração alterada. Atualize antes de continuar");
        await assertAccessManagement(tx, gate);
        const features = await accessFeatures(tx, gate.buildingId);
        assertAccessFeature(features, gate.kind);
        assertAccessFeature(features, input.kind ?? gate.kind);
        const [row] = await tx
          .update(gates)
          .set({ ...input, updatedAt: sql`clock_timestamp()` })
          .where(eq(gates.id, id))
          .returning();
        if (!row)
          throw forbidden("Sem permissão atual para configurar este acesso");
        await audit(
          req,
          tx,
          gate.buildingId,
          id,
          "ACCESS_CONFIG_UPDATED",
          input,
        );
        await assertAccessManagement(tx, row);
        return row;
      });
      res.json(updated);
    } catch (error) {
      throw mapAccessError(error);
    }
  },
);

accessRouter.post("/:gateId/open", async (req, res) => {
  const auth = currentAuth(req);
  try {
    const parsed = OpenGateSchema.safeParse(req.body);
    const gateId = z.string().uuid().safeParse(param(req, "gateId"));
    if (!parsed.success || !gateId.success)
      throw badRequest(
        "Solicitação inválida. Atualize a página e tente novamente",
      );
    const result = await inTenantContext(req, async (tx) => {
      const [row] = await tx.execute(
        sql`select * from app_request_access(${gateId.data}::uuid,${parsed.data.requestId}::uuid,${req.ip ?? null},${req.get("user-agent") ?? null})`,
      );
      if (!row) throw new Error("Missing controlled access receipt");
      return {
        command: commandView(receipt(row.command as Record<string, unknown>)),
        repeated: row.repeated === true,
      };
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(result.repeated ? 200 : 202).json(result.command);
  } catch (cause) {
    const error = mapAccessError(cause);
    await inTenantContext(req, (tx) =>
      recordAudit(tx, req, {
        userId: auth.userId,
        action: "ACCESS_REQUEST_REJECTED",
        resourceType: "gate",
        resourceId: param(req, "gateId").slice(0, 128),
        metadata: {
          reason: error instanceof HttpError ? error.message : "Falha interna",
        },
      }),
    );
    throw error;
  }
});
