import { and, eq, lt, ne } from "drizzle-orm";
import { alerts, db, devices, gateways } from "@predioon/db";
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
      message: `Gateway ${gateway.name} sem comunicação`,
    });
  }

  const staleDevices = await db
    .update(devices)
    .set({ status: "OFFLINE", updatedAt: new Date() })
    .where(
      and(
        ne(devices.status, "OFFLINE"),
        ne(devices.status, "DISABLED"),
        eq(devices.enabled, true),
        lt(devices.lastSeenAt, cutoff(config.DEVICE_OFFLINE_TIMEOUT_SECONDS)),
      ),
    )
    .returning({ id: devices.id, buildingId: devices.buildingId, name: devices.name });

  for (const device of staleDevices) {
    await publishRealtime({
      kind: "device-status",
      buildingId: device.buildingId,
      deviceId: device.id,
      status: "OFFLINE",
    });
    await raiseCommunicationAlert({
      buildingId: device.buildingId,
      deviceId: device.id,
      message: `Sensor ${device.name} sem comunicação`,
    });
  }

  if (staleGateways.length || staleDevices.length) {
    console.log(`[offline] ${staleGateways.length} gateway(s) e ${staleDevices.length} dispositivo(s) marcados OFFLINE.`);
  }
}

/** Communication alerts have no rule behind them: they are produced by the platform itself. */
type CommunicationAlert = { buildingId: string; message: string; deviceId?: string; gatewayId?: string };

async function raiseCommunicationAlert(input: CommunicationAlert): Promise<void> {
  const [created] = await db
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
