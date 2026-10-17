import type { MqttClient } from "mqtt";
import {
  accessServiceDb,
  applyAccessAck,
  expireAccessCommands,
  failAccessPublish,
  failPendingAccess,
  lockFeatures,
  markAccessSent,
  nextPendingAccess,
  readFeatures,
} from "@predioon/db/access-service";
import {
  AccessAckSchema,
  gateFeature,
  parseAccessTopic,
} from "@predioon/shared";
import { publishAccessCommand, publishFailureCode } from "./publish.js";
import { permitsFeature } from "../features.js";

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

/**
 * SKIP LOCKED claims once across workers; the outer lock survives the SENT commit.
 * Every state change goes through a private helper that derives its audit and
 * actor from the persisted request; this role has no DML on commands or audit.
 */
async function dispatchWithFeatureLock(
  client: MqttClient,
  connection: Date | (() => Date),
): Promise<void> {
  const connectedSince = () =>
    typeof connection === "function" ? connection() : connection;
  await accessServiceDb.transaction(expireAccessCommands);
  await accessServiceDb.transaction(async (featureTx) => {
    await lockFeatures(featureTx);
    const command = await accessServiceDb.transaction(async (tx) => {
      const pending = await nextPendingAccess(tx);
      if (!pending) return null;
      if (!client.connected) {
        await failPendingAccess(tx, pending.id, "NO_LIVE_CONNECTION");
        return null;
      }
      if (pending.createdAt < connectedSince()) {
        await failPendingAccess(tx, pending.id, "BEFORE_CONNECTION");
        return null;
      }
      const features = await readFeatures(tx, pending.buildingId);
      if (
        pending.gateKind &&
        !permitsFeature(features, gateFeature(pending.gateKind), pending.createdAt)
      ) {
        await failPendingAccess(tx, pending.id, "FEATURE_PAUSED");
        return null;
      }
      // A refusal reason means the helper already recorded FAILED + audit.
      // Crash between SENT commit and publish may lose an opening, never replay it.
      // Only a correlated gateway ACK confirms the physical result.
      return (await markAccessSent(tx, pending.id)) === null ? pending : null;
    });
    if (!command) return;
    try {
      await publishAccessCommand(client, command, connectedSince());
    } catch (error) {
      // No retry: the helper fails only a still-SENT command, so an ACK that
      // already won the race is never replaced by FAILED.
      await accessServiceDb.transaction((tx) =>
        failAccessPublish(tx, command.id, publishFailureCode(error)),
      );
    }
  });
}

export function startAccessDispatcher(client: MqttClient): () => Promise<void> {
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
  // Stopping waits for an in-flight dispatch, so it can still record a publish
  // failure before MQTT and the database pools close.
  return () => {
    clearInterval(timer);
    client.off("connect", onConnect);
    return dispatcherTail;
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
  // The helper locks the command and its parents, checks correlation, SENT and
  // the deadline with the database clock, and audits once.
  await accessServiceDb.transaction((tx) => applyAccessAck(tx, ack));
}
