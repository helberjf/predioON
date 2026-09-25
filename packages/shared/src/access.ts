import { z } from "zod";

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
}).strict();
export const GatePatchSchema = GateConfigSchema.omit({ buildingId: true }).partial();
export const OpenGateSchema = z.object({ requestId: z.string().uuid() }).strict();
export const AccessAckSchema = z.object({
  commandId: z.string().uuid(), buildingId: TopicId, gatewayId: TopicId,
  gateId: TopicId, deviceId: TopicId, result: z.enum(["EXECUTED", "REJECTED"]),
}).strict();
export const AccessCommandSchema = AccessAckSchema.omit({ result: true }).extend({
  action: z.literal("OPEN"), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export type AccessAck = z.infer<typeof AccessAckSchema>;
export type AccessRole = "PLATFORM_ADMIN" | "BUILDING_ADMIN" | "RESIDENT";
export type AccessCommandStatus = "PENDING" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "EXPIRED";
type Membership = { active: boolean; role: "BUILDING_ADMIN" | "RESIDENT"; startsAt: Date | null; endsAt: Date | null };
export function accessRole(user: { active: boolean; isPlatformAdmin: boolean } | null | undefined, membership: Membership | null | undefined, now = new Date()): AccessRole | null {
  if (!user?.active) return null;
  if (user.isPlatformAdmin) return "PLATFORM_ADMIN";
  if (!membership?.active || (membership.startsAt && membership.startsAt > now) || (membership.endsAt && membership.endsAt <= now)) return null;
  return membership.role;
}
type Hardware = { enabled: boolean; status: string; lastSeenAt: Date | null };
export function accessAvailability(gate: { enabled: boolean; allowResidents: boolean }, gateway: Hardware | null | undefined, device: Hardware | null | undefined, role: AccessRole | null, now = new Date()): string | null {
  if (!role) return "Você não tem permissão para este acesso";
  if (!gate.enabled) return "Acesso desativado pela administração";
  if (role === "RESIDENT" && !gate.allowResidents) return "Abertura por moradores não autorizada";
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
export type AccessGateView = { id: string; buildingId: string; name: string; kind: "GARAGE" | "PEDESTRIAN"; gatewayId: string; deviceId: string; enabled: boolean; allowResidents: boolean; available: boolean; unavailableReason: string | null; latestCommand: AccessCommandView | null };
export type AccessList = { items: AccessGateView[]; canManage: boolean; gateways: Array<{ id: string; name: string }>; devices: Array<{ id: string; name: string; gatewayId: string | null; type: string }> };
