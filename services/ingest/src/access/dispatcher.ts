import type { MqttClient } from "mqtt";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  auditLogs,
  gates,
  gateCommands,
  gateways,
  lockFeatures,
  readFeatures,
  type DbTransaction,
} from "@predioon/db";
import {
  AccessAckSchema,
  gateFeature,
  parseAccessTopic,
  validAccessAck,
} from "@predioon/shared";
import { publishAccessCommand } from "./publish.js";
import { permitsFeature } from "../features.js";

type Command = typeof gateCommands.$inferSelect;
async function resultAudit(
  tx: DbTransaction,
  command: Command,
  action: string,
  reason?: string,
) {
  await tx
    .insert(auditLogs)
    .values({
      buildingId: command.buildingId,
      userId: command.requestedBy,
      actorType: "SYSTEM",
      action,
      resourceType: "gate",
      resourceId: command.gateId,
      metadata: { commandId: command.id, ...(reason ? { reason } : {}) },
    });
}
async function fail(tx: DbTransaction, command: Command, reason: string) {
  await tx
    .update(gateCommands)
    .set({ status: "FAILED", failureReason: reason })
    .where(eq(gateCommands.id, command.id));
  await resultAudit(tx, command, "ACCESS_COMMAND_FAILED", reason);
}

// Each dispatch reserves a feature-lock connection and a separate command connection.
// Queue before reserving either so concurrent calls cannot exhaust this process's pool.
let dispatcherTail: Promise<void> = Promise.resolve();
export async function dispatchAccessOnce(
  client: MqttClient,
  connection: Date | (() => Date),
): Promise<void> {
  const result = dispatcherTail.then(() =>
    dispatchWithFeatureLock(client, connection),
  );
  dispatcherTail = result.catch(() => undefined);
  return result;
}

/** SKIP LOCKED claims once across workers; the outer lock survives the SENT commit. */
async function dispatchWithFeatureLock(
  client: MqttClient,
  connection: Date | (() => Date),
): Promise<void> {
  const connectedSince = () =>
    typeof connection === "function" ? connection() : connection;
  await db.transaction(async (tx) => {
    const expired = await tx
      .update(gateCommands)
      .set({
        status: "EXPIRED",
        failureReason: "Prazo de confirmação encerrado",
      })
      .where(
        and(
          inArray(gateCommands.status, ["PENDING", "SENT"]),
          lte(gateCommands.expiresAt, new Date()),
        ),
      )
      .returning();
    for (const command of expired)
      await resultAudit(tx, command, "ACCESS_COMMAND_EXPIRED");
  });
  await db.transaction(async (featureTx) => {
    await lockFeatures(featureTx);
    const command = await db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(gateCommands)
        .where(eq(gateCommands.status, "PENDING"))
        .orderBy(asc(gateCommands.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!pending) return null;
      if (!client.connected || pending.createdAt < connectedSince()) {
        await fail(
          tx,
          pending,
          "Conexão indisponível no momento do pedido; reenvio bloqueado",
        );
        return null;
      }
      const [gate] = await tx
        .select()
        .from(gates)
        .where(eq(gates.id, pending.gateId))
        .limit(1);
      const features = await readFeatures(tx, pending.buildingId);
      if (
        gate &&
        !permitsFeature(features, gateFeature(gate.kind), pending.createdAt)
      ) {
        await fail(
          tx,
          pending,
          "Funcionalidade de acesso pausada; solicite novamente após a retomada",
        );
        return null;
      }
      // Service-only transition derives its actor from the persisted request,
      // locks device → gateway → gate, and checks fresh capabilities/clock in the
      // SENT statement after audit waits. No runtime role can invoke it.
      const [transition] = await tx.execute(
        sql`select app_mark_access_sent(${pending.id}::uuid) as reason`,
      );
      if (!transition || transition.reason !== null) {
        await fail(
          tx,
          pending,
          typeof transition?.reason === "string"
            ? transition.reason
            : "Decisão de envio indisponível",
        );
        return null;
      }
      // Crash between SENT commit and publish may lose an opening, never replay it.
      // Only a correlated gateway ACK confirms the physical result.
      return pending;
    });
    if (!command) return;
    try {
      await publishAccessCommand(client, command, connectedSince());
    } catch (error) {
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(gateCommands)
          .where(eq(gateCommands.id, command.id))
          .for("update");
        if (current?.status === "SENT")
          await fail(
            tx,
            current,
            error instanceof Error ? error.message : "Falha de envio",
          );
      });
    }
  });
}

export function startAccessDispatcher(client: MqttClient): () => void {
  let connectedSince = new Date();
  let running = false;
  const onConnect = () => {
    connectedSince = new Date();
  };
  client.on("connect", onConnect);
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void dispatchAccessOnce(client, () => connectedSince)
      .catch((error) =>
        console.error("Falha no processamento de acessos:", error),
      )
      .finally(() => {
        running = false;
      });
  }, 250);
  return () => {
    clearInterval(timer);
    client.off("connect", onConnect);
  };
}

export async function handleAccessAck(
  topic: string,
  raw: Buffer,
): Promise<void> {
  const parts = parseAccessTopic(topic);
  if (!parts || parts.kind !== "ack" || raw.length > 2048) return;
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    return;
  }
  const parsed = AccessAckSchema.safeParse(value);
  if (!parsed.success) return;
  const ack = parsed.data;
  if (
    parts.buildingId !== ack.buildingId ||
    parts.gatewayId !== ack.gatewayId ||
    parts.gateId !== ack.gateId
  )
    return;
  await db.transaction(async (tx) => {
    const [command] = await tx
      .select()
      .from(gateCommands)
      .where(eq(gateCommands.id, ack.commandId))
      .limit(1)
      .for("update");
    if (!command || !validAccessAck(command, ack)) return;
    const [gateway] = await tx
      .select()
      .from(gateways)
      .where(
        and(
          eq(gateways.id, ack.gatewayId),
          eq(gateways.buildingId, ack.buildingId),
          eq(gateways.enabled, true),
        ),
      )
      .limit(1);
    const [gate] = await tx
      .select()
      .from(gates)
      .where(
        and(
          eq(gates.id, ack.gateId),
          eq(gates.gatewayId, ack.gatewayId),
          eq(gates.deviceId, ack.deviceId),
          eq(gates.buildingId, ack.buildingId),
        ),
      )
      .limit(1);
    if (!gateway || !gate) return;
    const succeeded = ack.result === "EXECUTED";
    await tx
      .update(gateCommands)
      .set({
        status: succeeded ? "ACKNOWLEDGED" : "FAILED",
        acknowledgedAt: new Date(),
        failureReason: succeeded ? null : "Abertura recusada pelo controlador",
      })
      .where(eq(gateCommands.id, command.id));
    await resultAudit(
      tx,
      command,
      succeeded ? "ACCESS_COMMAND_ACKNOWLEDGED" : "ACCESS_COMMAND_REJECTED",
    );
  });
}
