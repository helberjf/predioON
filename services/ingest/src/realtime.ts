import { sql } from "drizzle-orm";
import { db } from "@predioon/db";
import { REALTIME_CHANNEL, type RealtimeEvent } from "@predioon/shared";

/**
 * Publishes to the API through PostgreSQL NOTIFY. Using the database the data already
 * lives in avoids a second broker just to refresh a dashboard.
 * NOTIFY payloads are limited to 8000 bytes, which these envelopes never approach.
 */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  try {
    await db.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(event)})`);
  } catch (error) {
    // Realtime is a convenience: losing a frame must never fail the ingestion that produced it.
    console.error("Falha ao publicar evento de tempo real:", error);
  }
}
