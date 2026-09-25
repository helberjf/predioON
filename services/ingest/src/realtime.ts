import { and, eq, sql } from "drizzle-orm";
import { db, devices, lockFeatures, readFeatures } from "@predioon/db";
import { REALTIME_CHANNEL, type RealtimeEvent } from "@predioon/shared";
import { permitsAlert, permitsDeviceAlert, permitsReading } from "./features.js";

/**
 * Publishes to the API through PostgreSQL NOTIFY. Using the database the data already
 * lives in avoids a second broker just to refresh a dashboard.
 * NOTIFY payloads are limited to 8000 bytes, which these envelopes never approach.
 */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  try {
    await db.transaction(async tx => {
      await lockFeatures(tx);
      if (event.kind === "alert" && !await permitsAlert(tx, event.buildingId, event.alertId)) return;
      if (event.kind === "telemetry" || event.kind === "device-status") {
        const [device] = await tx.select().from(devices).where(and(eq(devices.id, event.deviceId), eq(devices.buildingId, event.buildingId))).limit(1);
        if (!device) return;
        const features = await readFeatures(tx, event.buildingId);
        if (event.kind === "telemetry") {
          if (!await permitsReading(tx, features, event.buildingId, device, event.metric, new Date(event.time))) return;
        } else if (!await permitsDeviceAlert(tx, features, event.buildingId, device)) return;
      }
      await tx.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(event)})`);
    });
  } catch (error) {
    // Realtime is a convenience: losing a frame must never fail the ingestion that produced it.
    console.error("Falha ao publicar evento de tempo real:", error);
  }
}
