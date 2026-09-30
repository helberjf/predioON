import { and, eq, lt, ne } from "drizzle-orm";
import { alerts, db, devices, gateways, lockFeatures, readFeatures } from "@predioon/db";
import { permitsDeviceAlert } from "./features.js";
import { config } from "./config.js";
import { notifyAlert } from "./notify/index.js";
import { publishRealtime } from "./realtime.js";

function cutoff(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

/**
 * A device that stops publishing is NOT the same as a device reporting a constant value.
 * Without this sweep the panel would happily show the last reading forever and nobody
 * would notice that the gateway died — the classic failure mode of this kind of system.
 */
export async function sweepOffline(): Promise<void> {
  const staleGateways = await db
    .update(gateways)
    .set({ status: "OFFLINE", updatedAt: new Date() })
    .where(
      and(
        ne(gateways.status, "OFFLINE"),
        ne(gateways.status, "DISABLED"),
        eq(gateways.enabled, true),
        lt(gateways.lastSeenAt, cutoff(config.GATEWAY_OFFLINE_TIMEOUT_SECONDS)),
      ),
    )
    .returning({ id: gateways.id, buildingId: gateways.buildingId, name: gateways.name });

  for (const gateway of staleGateways) {
    await publishRealtime({
      kind: "gateway-status",
      buildingId: gateway.buildingId,
      gatewayId: gateway.id,
      status: "OFFLINE",
    });
    await raiseCommunicationAlert({
      buildingId: gateway.buildingId,
      gatewayId: gateway.id,
      message: `${gateway.name} sem comunicação`,
    });
  }

  const staleDevices = await db
    .select()
    .from(devices)
    .where(
      and(
        ne(devices.status, "DISABLED"),
        eq(devices.enabled, true),
        lt(devices.lastSeenAt, cutoff(config.DEVICE_OFFLINE_TIMEOUT_SECONDS)),
      ),
    );

  for (const device of staleDevices) {
    if (device.status !== "OFFLINE") {
    await db.update(devices).set({ status: "OFFLINE", updatedAt: new Date() }).where(and(eq(devices.id, device.id), lt(devices.lastSeenAt, cutoff(config.DEVICE_OFFLINE_TIMEOUT_SECONDS))));
    await publishRealtime({
      kind: "device-status",
      buildingId: device.buildingId,
      deviceId: device.id,
      status: "OFFLINE",
    });
    }
    await raiseCommunicationAlert({
      buildingId: device.buildingId,
      deviceId: device.id,
      message: `${device.name} sem comunicação`,
    });
  }

  if (staleGateways.length || staleDevices.length) {
    console.log(`[offline] ${staleGateways.length} gateway(s) e ${staleDevices.length} dispositivo(s) marcados OFFLINE.`);
  }
}

/** Communication alerts have no rule behind them: they are produced by the platform itself. */
type CommunicationAlert = { buildingId: string; message: string; deviceId?: string; gatewayId?: string };

export async function raiseCommunicationAlert(input: CommunicationAlert): Promise<void> {
  const created = await db.transaction(async tx => {
    await lockFeatures(tx);
    if (input.deviceId) {
      const [device] = await tx.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.buildingId, input.buildingId))).limit(1).for("update");
      if (!device?.enabled || (device.lastSeenAt && device.lastSeenAt >= cutoff(config.DEVICE_OFFLINE_TIMEOUT_SECONDS)) || !await permitsDeviceAlert(tx, await readFeatures(tx, input.buildingId), input.buildingId, device)) return null;
      const [open] = await tx.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.deviceId, input.deviceId), eq(alerts.type, "COMMUNICATION_LOST"), ne(alerts.status, "RESOLVED"))).limit(1);
      if (open) return null;
    }
    const [row] = await tx
    .insert(alerts)
    .values({
      buildingId: input.buildingId,
      deviceId: input.deviceId ?? null,
      gatewayId: input.gatewayId ?? null,
      severity: "HIGH",
      type: "COMMUNICATION_LOST",
      message: input.message,
      triggeredAt: new Date(),
    })
    .returning({ id: alerts.id });
    return row;
  });

  if (!created) return;

  await publishRealtime({
    kind: "alert",
    buildingId: input.buildingId,
    alertId: created.id,
    deviceId: input.deviceId ?? null,
    gatewayId: input.gatewayId ?? null,
    severity: "HIGH",
    type: "COMMUNICATION_LOST",
    message: input.message,
    status: "OPEN",
  });

  await notifyAlert({
    alertId: created.id,
    buildingId: input.buildingId,
    deviceId: input.deviceId ?? input.gatewayId ?? "",
    severity: "HIGH",
    type: "COMMUNICATION_LOST",
    message: input.message,
    triggeredAt: new Date().toISOString(),
  });
}

export function startOfflineSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepOffline().catch((error) => console.error("Falha na varredura de offline:", error));
  }, config.OFFLINE_SWEEP_INTERVAL_SECONDS * 1000);
  timer.unref();
  return timer;
}
