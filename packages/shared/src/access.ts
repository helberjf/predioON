import { z } from "zod";
import { parseGateQr } from "./gate-qr.js";

export * from "./gate-qr.js";

export const ACCESS_COMMAND_TTL_MS = 15_000;
export const ACCESS_LIVE_MAX_AGE_MS = 60_000;
export const ACCESS_THROTTLE_MS = 5_000;
export const ACCESS_ACK_TOPIC = "predio/+/gateway/+/access/+/ack";
const TopicId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const GateConfigSchema = z.object({
  buildingId: TopicId,
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["GARAGE", "PEDESTRIAN"]),
  gatewayId: TopicId,
  deviceId: TopicId,
  enabled: z.boolean().default(false),
  allowResidents: z.boolean().default(false),
  requireQr: z.boolean().default(false),
}).strict();
// Zod defaults inside partial() still materialize omitted booleans. A PATCH
// must not disable a gate or change its resident policy when only naming it.
export const GatePatchSchema = GateConfigSchema.omit({ buildingId: true }).extend({
  enabled: z.boolean(), allowResidents: z.boolean(), requireQr: z.boolean(),
}).partial();
export const OpenGateSchema = z.object({ requestId: z.string().uuid() }).strict();

const GateQrContentSchema = z.string().max(128).refine(value => parseGateQr(value) !== null);
export const ResolveGateQrSchema = z.object({ content: GateQrContentSchema }).strict();
export const OpenGateByQrSchema = z.object({ content: GateQrContentSchema, requestId: z.string().uuid() }).strict();
export const TotemPairSchema = z.object({
  pairingCode: z.string().trim().min(10).max(16),
  label: z.string().trim().min(2).max(60),
}).strict();
export const AccessAckSchema = z.object({
  commandId: z.string().uuid(), buildingId: TopicId, gatewayId: TopicId,
  gateId: TopicId, deviceId: TopicId, result: z.enum(["EXECUTED", "REJECTED"]),
}).strict();
export const AccessCommandSchema = AccessAckSchema.omit({ result: true }).extend({
  action: z.literal("OPEN"), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export type AccessAck = z.infer<typeof AccessAckSchema>;
export type AccessCommandStatus = "PENDING" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "EXPIRED";
type Hardware = { enabled: boolean; status: string; lastSeenAt: Date | null };
/** Permission is evaluated from current scoped grants by the API, never a role. */
export function accessCapabilityAvailability(gate: { enabled: boolean }, gateway: Hardware | null | undefined, device: Hardware | null | undefined, requestPermitted: boolean, now = new Date()): string | null {
  if (!requestPermitted) return "Você não tem permissão para este acesso. A administração do condomínio pode liberá-lo.";
  if (!gate.enabled) return "Acesso desativado pela administração";
  for (const hardware of [gateway, device]) {
    if (!hardware?.enabled || hardware.status !== "ONLINE" || !hardware.lastSeenAt || now.getTime() - hardware.lastSeenAt.getTime() > ACCESS_LIVE_MAX_AGE_MS || hardware.lastSeenAt.getTime() > now.getTime() + 5000) return "Equipamento sem conexão recente. Tente novamente quando estiver online";
  }
  return null;
}
export type AccessTopic = { buildingId: string; gatewayId: string; gateId: string; kind: "command" | "ack" };
export function parseAccessTopic(topic: string): AccessTopic | null {
  const match = /^predio\/([a-zA-Z0-9_-]+)\/gateway\/([a-zA-Z0-9_-]+)\/access\/([a-zA-Z0-9_-]+)\/(command|ack)$/.exec(topic);
  return match ? { buildingId: match[1]!, gatewayId: match[2]!, gateId: match[3]!, kind: match[4] as AccessTopic["kind"] } : null;
}
export function accessTopic(buildingId: string, gatewayId: string, gateId: string, kind: AccessTopic["kind"]): string {
  for (const id of [buildingId, gatewayId, gateId]) TopicId.parse(id);
  return `predio/${buildingId}/gateway/${gatewayId}/access/${gateId}/${kind}`;
}
type CommandIdentity = { id: string; buildingId: string; gatewayId: string; gateId: string; deviceId: string; status: string; expiresAt: Date };
export function validAccessAck(command: CommandIdentity, ack: AccessAck, now = new Date()): boolean {
  return command.status === "SENT" && command.expiresAt > now && command.id === ack.commandId &&
    command.buildingId === ack.buildingId && command.gatewayId === ack.gatewayId && command.gateId === ack.gateId && command.deviceId === ack.deviceId;
}
export type AccessCommandView = { id: string; requestId: string; gateId: string; status: AccessCommandStatus; expiresAt: string; createdAt: string; failureReason: string | null };
export type GateTotemView = { id: string; label: string; pairedAt: string; lastSeenAt: string | null };
export type AccessGateView = { id: string; buildingId: string; name: string; kind: "GARAGE" | "PEDESTRIAN"; gatewayId: string; deviceId: string; enabled: boolean; allowResidents: boolean; requireQr: boolean; canManage?: boolean; available: boolean; unavailableReason: string | null; latestCommand: AccessCommandView | null;
  /** Managers only, and only while the QR add-on is enabled for this gate. */
  qr?: { totems: GateTotemView[] } };
export type TotemPairingView = { pairingCode: string; expiresAt: string };
export type TotemDisplay = {
  gate: { id: string; name: string; kind: "GARAGE" | "PEDESTRIAN" }; building: { name: string };
  current: { content: string; validUntil: string }; next: { content: string; validFrom: string }; serverTime: string;
};
export type AccessList = { items: AccessGateView[]; canManage: boolean; gateways: Array<{ id: string; name: string }>; devices: Array<{ id: string; name: string; gatewayId: string | null; type: string }> };
