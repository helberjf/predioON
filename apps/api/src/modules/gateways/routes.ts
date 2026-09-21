import { randomBytes } from "node:crypto";
import { Router } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { gateways } from "@predioon/db";
import { assertBuildingAccess, currentAuth, inTenantContext, requireRole, scopedBuildingIds } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import { generateId } from "../../http/ids.js";
import { validateBody } from "../../http/validate.js";
import { hashPassword } from "../../auth/passwords.js";
import { recordAudit } from "../audit/repo.js";
import { param } from "../../http/params.js";

export const gatewaysRouter = Router();

function publicGateway(row: typeof gateways.$inferSelect) {
  const { mqttPasswordHash: _password, mqttUsername: _username, ...metadata } = row.metadata;
  return { ...row, metadata };
}

const MetadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => !("mqttUsername" in value) && !("mqttPasswordHash" in value),
  "Credenciais MQTT são alteradas apenas pela emissão de credencial",
);

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  name: z.string().min(2).max(120),
  serialNumber: z.string().min(3).max(80),
  model: z.string().max(120).optional(),
  firmwareVersion: z.string().max(60).optional(),
  metadata: MetadataSchema.optional(),
});
const UpdateSchema = CreateSchema.partial().omit({ buildingId: true }).extend({ enabled: z.boolean().optional() });

gatewaysRouter.get("/", async (req, res) => {
  const scope = scopedBuildingIds(currentAuth(req));
  const rows = await inTenantContext(req, (tx) => {
    const base = tx.select().from(gateways);
    return scope ? base.where(inArray(gateways.buildingId, scope.length ? scope : [""])).orderBy(asc(gateways.name))
                 : base.orderBy(asc(gateways.name));
  });
  res.json({ items: rows.map(publicGateway) });
});

gatewaysRouter.post("/", requireRole("PLATFORM_ADMIN"), validateBody(CreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const auth = currentAuth(req);

  const row = await inTenantContext(req, async (tx) => {
    const [created] = await tx
      .insert(gateways)
      .values({ id: generateId("gw"), ...input, metadata: input.metadata ?? {} })
      .returning();
    await recordAudit(tx, req, {
      buildingId: created!.buildingId,
      userId: auth.userId,
      action: "GATEWAY_CREATED",
      resourceType: "gateway",
      resourceId: created!.id,
    });
    return created!;
  });

  res.status(201).json(publicGateway(row));
});

gatewaysRouter.patch("/:gatewayId", validateBody(UpdateSchema), async (req, res) => {
  const auth = currentAuth(req);
  const input = req.body as z.infer<typeof UpdateSchema>;

  const row = await inTenantContext(req, async (tx) => {
    const [current] = await tx.select().from(gateways).where(eq(gateways.id, param(req, "gatewayId"))).limit(1);
    if (!current) throw notFound("Gateway não encontrado");
    assertBuildingAccess(auth, current.buildingId, "BUILDING_ADMIN");

    const [updated] = await tx
      .update(gateways)
      .set({ ...input, ...(input.metadata ? { metadata: { ...current.metadata, ...input.metadata } } : {}), updatedAt: new Date() })
      .where(eq(gateways.id, current.id))
      .returning();
    await recordAudit(tx, req, {
      buildingId: current.buildingId,
      userId: auth.userId,
      action: "GATEWAY_UPDATED",
      resourceType: "gateway",
      resourceId: current.id,
      metadata: input,
    });
    return updated!;
  });

  res.json(publicGateway(row));
});

/**
 * Provisioning: issues the MQTT credential the installer configures in the field.
 * The password is shown ONCE and stored only as a hash — the platform cannot recover it later.
 * EMQX validates this credential through the internal authentication endpoint.
 */
gatewaysRouter.post("/:gatewayId/credentials", requireRole("PLATFORM_ADMIN"), async (req, res) => {
  const auth = currentAuth(req);
  const password = randomBytes(24).toString("base64url");

  const payload = await inTenantContext(req, async (tx) => {
    const [gateway] = await tx.select().from(gateways).where(eq(gateways.id, param(req, "gatewayId"))).limit(1);
    if (!gateway) throw notFound("Gateway não encontrado");

    const username = `gw_${gateway.id}`;
    await tx
      .update(gateways)
      .set({
        metadata: { ...gateway.metadata, mqttUsername: username, mqttPasswordHash: await hashPassword(password) },
        status: gateway.status === "PROVISIONING" ? "PROVISIONING" : gateway.status,
        updatedAt: new Date(),
      })
      .where(eq(gateways.id, gateway.id));

    await recordAudit(tx, req, {
      buildingId: gateway.buildingId,
      userId: auth.userId,
      action: "GATEWAY_CREDENTIALS_ISSUED",
      resourceType: "gateway",
      resourceId: gateway.id,
    });

    return {
      gatewayId: gateway.id,
      buildingId: gateway.buildingId,
      mqttUsername: username,
      mqttPassword: password,
      mqttClientId: gateway.id,
      mqttPort: 8883,
      mqttTls: true,
      telemetryTopic: `predio/${gateway.buildingId}/device/{deviceId}/telemetry`,
      waterTelemetryTopic: `predio/${gateway.buildingId}/caixa_agua/{deviceId}/telemetria`,
      statusTopic: `predio/${gateway.buildingId}/gateway/${gateway.id}/status`,
    };
  });

  res.status(201).json(payload);
});
