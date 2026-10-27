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
  OpenGateByQrSchema,
  OpenGateSchema,
  ResolveGateQrSchema,
  accessCapabilityAvailability,
  deviceFeatures,
  gateFeature,
  parseGateQr,
  type FeatureStates,
  type GateTotemView,
  type TotemPairingView,
} from "@predioon/shared";
import { featureDisabled } from "../../auth/features.js";
import { currentAuth, inTenantContext } from "../../auth/middleware.js";
import { requireRecentVerification } from "../../auth/verification.js";
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
  gateQrEnabled,
  lockAccessTarget,
} from "./authorization.js";
import { gateQrSecret, verifyGateQr } from "./qr-code.js";
import { newPairingCode, pairingCodeHash } from "./totem-pairing.js";

export const accessRouter = Router();
/**
 * Row ids as PostgreSQL stores them: any 8-4-4-4-12 hex value. Zod's uuid()
 * also demands an RFC version nibble, which ids created outside
 * gen_random_uuid() (demo data, imports) may not have.
 */
const RowId = z.guid();
function rowId(req: Request, name: string, missing: string): string {
  const parsed = RowId.safeParse(param(req, name));
  if (!parsed.success) throw notFound(missing);
  return parsed.data;
}
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
  if (code === "PQ403")
    return new HttpError(403, "Este portão abre pelo QR do totem, no app do morador", {
      code: "QR_REQUIRED",
    });
  if (code === "PQ404") return qrInvalid();
  return error;
}
const qrInvalid = () =>
  notFound("QR expirado ou inválido. Leia o QR do totem novamente");

async function gateTotems(
  tx: AppTransaction,
  gateId: string,
): Promise<GateTotemView[]> {
  // Explicit columns: the runtime role cannot read the token hash at all.
  const rows = await tx.execute(
    sql`select id,label,paired_at,last_seen_at from gate_totems where gate_id=${gateId}::uuid and revoked_at is null order by paired_at`,
  );
  return rows.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    pairedAt: new Date(row.paired_at as string).toISOString(),
    lastSeenAt: row.last_seen_at
      ? new Date(row.last_seen_at as string).toISOString()
      : null,
  }));
}

/**
 * One gate as this caller may see it, or null when it is not theirs to know
 * about. The list and the QR resolution share this rule.
 */
async function gateView(
  tx: AppTransaction,
  gate: typeof gates.$inferSelect,
  features: FeatureStates,
) {
  if (!features[gateFeature(gate.kind)].enabled) return null;
  const permissions = await accessPermissions(tx, gate);
  if (!permissions.readable) return null;
  // A gate closed to residents, or switched off with its gateway or
  // controller, belongs to whoever manages it. Others are not told it
  // exists, instead of seeing a button they cannot use. Being offline
  // is not switching off: that gate stays listed as unavailable.
  if (!gate.allowResidents && !permissions.manageable) return null;
  const { gateway, device } = await accessHardware(tx, gate);
  if (
    !permissions.manageable &&
    !(gate.enabled && gateway?.enabled && device?.enabled)
  )
    return null;
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
        eq(gateCommands.buildingId, gate.buildingId),
        eq(gateCommands.gateId, gate.id),
      ),
    )
    .orderBy(desc(gateCommands.createdAt))
    .limit(1);
  // The generation is part of the QR key; it stays in the database.
  const { qrGeneration: _generation, ...configuration } = gate;
  const qrOn = gateQrEnabled(features, gate.kind);
  return {
    ...configuration,
    // Outside the add-on the requirement has no effect, so it is not shown.
    requireQr: gate.requireQr && qrOn,
    canManage: permissions.manageable,
    available: !reason,
    unavailableReason: reason,
    latestCommand: latest ? commandView(latest) : null,
    ...(permissions.manageable && qrOn
      ? { qr: { totems: await gateTotems(tx, gate.id) } }
      : {}),
  };
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
      rows.map((gate) => gateView(tx, gate, features)),
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
  const id = rowId(req, "commandId", "Solicitação não encontrada");
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
      const features = await accessFeatures(tx, input.buildingId);
      assertAccessFeature(features, input.kind);
      if (input.requireQr && !gateQrEnabled(features, input.kind))
        throw featureDisabled("GATE_QR_ACCESS");
      // Restrict INSERT to mutable configuration columns; identity/timestamps
      // come from database defaults and are not writable by the runtime role.
      const [inserted] =
        await tx.execute(sql`insert into gates(building_id,name,kind,gateway_id,device_id,enabled,allow_residents,require_qr)
        values(${input.buildingId},${input.name},${input.kind},${input.gatewayId},${input.deviceId},${input.enabled},${input.allowResidents},${input.requireQr}) returning id`);
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
        {
          enabled: input.enabled,
          allowResidents: input.allowResidents,
          requireQr: input.requireQr,
        },
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
    const id = rowId(req, "gateId", "Acesso não encontrado");
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
        // Turning the requirement off stays possible after the add-on is withdrawn.
        if (input.requireQr && !gateQrEnabled(features, input.kind ?? gate.kind))
          throw featureDisabled("GATE_QR_ACCESS");
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

// The QR routes come before "/:gateId/..." so "qr" is never read as a gate id.
// The QR content travels in the body, never in a URL that proxies would log.
accessRouter.post("/qr/resolve", async (req, res) => {
  gateQrSecret();
  const parsed = ResolveGateQrSchema.safeParse(req.body);
  if (!parsed.success) throw qrInvalid();
  const qr = parseGateQr(parsed.data.content)!;
  const view = await inTenantContext(req, async (tx) => {
    // RLS returns the gate only to whoever may read it.
    const [gate] = await tx
      .select()
      .from(gates)
      .where(eq(gates.id, qr.gateId))
      .limit(1);
    if (!gate) throw qrInvalid();
    const features = await accessFeatures(tx, gate.buildingId);
    if (
      !gateQrEnabled(features, gate.kind) ||
      !verifyGateQr(qr, gate.qrGeneration, Date.now())
    )
      throw qrInvalid();
    const item = await gateView(tx, gate, features);
    if (!item) throw qrInvalid();
    return item;
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(view);
});

accessRouter.post("/qr/open", async (req, res) => {
  const auth = currentAuth(req);
  const parsed = OpenGateByQrSchema.safeParse(req.body);
  const qr = parsed.success ? parseGateQr(parsed.data.content) : null;
  try {
    gateQrSecret();
    if (!parsed.success || !qr)
      throw badRequest("Solicitação inválida. Leia o QR do totem novamente");
    const result = await inTenantContext(req, async (tx) => {
      const [gate] = await tx
        .select({ id: gates.id, qrGeneration: gates.qrGeneration })
        .from(gates)
        .where(eq(gates.id, qr.gateId))
        .limit(1);
      // The admission compares this generation again under the gate lock.
      if (!gate || !verifyGateQr(qr, gate.qrGeneration, Date.now()))
        throw qrInvalid();
      const [row] = await tx.execute(
        sql`select * from app_request_access_by_qr(${gate.id}::uuid,${gate.qrGeneration}::integer,${parsed.data.requestId}::uuid,${req.ip ?? null},${req.get("user-agent") ?? null})`,
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
    if (!(error instanceof HttpError && error.status === 503))
      await inTenantContext(req, (tx) =>
        recordAudit(tx, req, {
          userId: auth.userId,
          action: "ACCESS_REQUEST_REJECTED",
          resourceType: "gate",
          // The gate id is public (it is in MQTT topics); the code itself is never stored.
          resourceId: qr?.gateId ?? "qr",
          metadata: {
            via: "QR",
            reason: error instanceof HttpError ? error.message : "Falha interna",
          },
        }),
      );
    throw error;
  }
});

accessRouter.post("/:gateId/qr/renew", async (req, res) => {
  const id = rowId(req, "gateId", "Acesso não encontrado");
  await requireRecentVerification(req);
  try {
    await inTenantContext(req, (tx) =>
      tx.execute(sql`select app_gate_qr_renew(${id}::uuid)`),
    );
  } catch (error) {
    throw mapAccessError(error);
  }
  res.status(204).end();
});

accessRouter.post("/:gateId/totems/pairing", async (req, res) => {
  const id = rowId(req, "gateId", "Acesso não encontrado");
  await requireRecentVerification(req);
  const pairingCode = newPairingCode();
  try {
    const expiresAt = await inTenantContext(req, async (tx) => {
      const [row] = await tx.execute(
        sql`select app_gate_totem_pairing_create(${id}::uuid,${pairingCodeHash(pairingCode)}) as expires_at`,
      );
      return new Date(row!.expires_at as string);
    });
    const body: TotemPairingView = {
      pairingCode,
      expiresAt: expiresAt.toISOString(),
    };
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(body);
  } catch (error) {
    throw mapAccessError(error);
  }
});

accessRouter.delete("/:gateId/totems/:totemId", async (req, res) => {
  const gateId = rowId(req, "gateId", "Acesso não encontrado");
  const totemId = rowId(req, "totemId", "Tablet não encontrado ou já despareado");
  let revoked = false;
  try {
    revoked = await inTenantContext(req, async (tx) => {
      const [row] = await tx.execute(
        sql`select app_gate_totem_revoke(${gateId}::uuid,${totemId}::uuid) as revoked`,
      );
      return row?.revoked === true;
    });
  } catch (error) {
    throw mapAccessError(error);
  }
  if (!revoked) throw notFound("Tablet não encontrado ou já despareado");
  res.status(204).end();
});

accessRouter.post("/:gateId/open", async (req, res) => {
  const auth = currentAuth(req);
  try {
    const parsed = OpenGateSchema.safeParse(req.body);
    const gateId = RowId.safeParse(param(req, "gateId"));
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
