import { z } from "zod";

export const TelemetryValueSchema = z.union([z.number(), z.boolean(), z.string().max(500)]);
export type TelemetryValue = z.infer<typeof TelemetryValueSchema>;

export const TelemetryQualitySchema = z.enum(["GOOD", "UNCERTAIN", "BAD"]);
export type TelemetryQuality = z.infer<typeof TelemetryQualitySchema>;

/**
 * Payload published by the gateway on every reading.
 * `eventId` is the idempotency key: MQTT QoS 1 is at-least-once, so the same event may arrive twice.
 */
export const TelemetrySchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(8).max(128),
  buildingId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(64),
  metric: z.string().min(1).max(64),
  value: TelemetryValueSchema,
  unit: z.string().min(1).max(16).optional(),
  quality: TelemetryQualitySchema.default("GOOD"),
  timestamp: z.string().datetime(),
});
export type Telemetry = z.infer<typeof TelemetrySchema>;

/** Gateway liveness, published retained and also used as the MQTT last will. */
export const GatewayStatusSchema = z.object({
  schemaVersion: z.literal(1),
  buildingId: z.string().min(1).max(64),
  gatewayId: z.string().min(1).max(64),
  state: z.enum(["ONLINE", "OFFLINE"]),
  firmwareVersion: z.string().max(64).optional(),
  timestamp: z.string().datetime(),
});
export type GatewayStatus = z.infer<typeof GatewayStatusSchema>;
