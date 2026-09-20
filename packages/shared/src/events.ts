import { z } from "zod";

/**
 * Realtime envelope. Ingest emits it through PostgreSQL NOTIFY and the API relays it over SSE,
 * so no extra broker is needed between the two processes.
 */
export const RealtimeEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("telemetry"),
    buildingId: z.string(),
    deviceId: z.string(),
    metric: z.string(),
    value: z.union([z.number(), z.boolean(), z.string()]),
    unit: z.string().nullable().optional(),
    time: z.string(),
  }),
  z.object({
    kind: z.literal("alert"),
    buildingId: z.string(),
    alertId: z.string(),
    deviceId: z.string().nullable(),
    gatewayId: z.string().nullable().optional(),
    severity: z.string(),
    type: z.string(),
    message: z.string(),
    status: z.string(),
  }),
  z.object({
    kind: z.literal("device-status"),
    buildingId: z.string(),
    deviceId: z.string(),
    status: z.string(),
  }),
  z.object({
    kind: z.literal("gateway-status"),
    buildingId: z.string(),
    gatewayId: z.string(),
    status: z.string(),
  }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

export const REALTIME_CHANNEL = "predioon_events";
