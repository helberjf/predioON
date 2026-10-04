import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { TelemetrySchema, WaterTelemetrySchema, parseTelemetryTopic, parseWaterTelemetryTopic, type Telemetry } from "@predioon/shared";

// Preserve a leading BOM so JSON still rejects it, while invalid bytes fail
// instead of becoming replacement characters in values or source identities.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A bad field rejects the whole envelope before any database writes. */
export function normalizeTelemetry(topic: string, raw: Buffer): Telemetry[] {
  if (raw.length > 16_384) return [];
  let body: unknown;
  try { body = JSON.parse(utf8.decode(raw)); } catch { return []; }
  const water = parseWaterTelemetryTopic(topic);
  if (water) {
    const parsed = WaterTelemetrySchema.safeParse(body);
    if (!parsed.success || parsed.data.device_id !== water.deviceId) return [];
    const value = parsed.data;
    const timestamp = new Date(value.timestamp).toISOString();
    const readings: Array<[string, number | undefined, string]> = [
      ["water_level_percent", value.nivel_percentual, "%"],
      ["distance_mm", value.distancia_mm, "mm"],
      ["volume_liters", value.volume_litros, "L"],
    ];
    return readings.filter(([, v]) => v !== undefined).map(([metric, v, unit]) => ({
      schemaVersion: 1, ...water, metric, value: v!, unit, quality: "GOOD", timestamp,
      // A timestamp identifies the sensor sample, including retransmissions.
      eventId: createHash("sha256").update(JSON.stringify([water.buildingId, water.deviceId, metric, timestamp])).digest("hex"),
    }));
  }
  const identity = parseTelemetryTopic(topic);
  const parsed = TelemetrySchema.safeParse(body);
  if (!identity || !parsed.success) return [];
  if (parsed.data.buildingId !== identity.buildingId || parsed.data.deviceId !== identity.deviceId) return [];
  return [parsed.data];
}
