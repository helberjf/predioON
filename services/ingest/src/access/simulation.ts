import { ACCESS_COMMAND_TTL_MS, AccessCommandSchema, type AccessAck } from "@predioon/shared";
type Identity = { buildingId: string; gatewayId: string; gateId: string; deviceId: string };
/** Protocol-only simulator: never drives GPIO, relays, Modbus, or a physical controller. */
export function createGateSimulator(identity: Identity, connectedSince: Date) {
  const executed = new Map<string, number>();
  return (value: unknown, now = new Date(), retained = false): AccessAck | null => {
    const parsed = AccessCommandSchema.safeParse(value);
    if (!parsed.success || retained) return null;
    const command = parsed.data;
    const issued = new Date(command.issuedAt).getTime(); const expires = new Date(command.expiresAt).getTime();
    if (issued < connectedSince.getTime() || issued > now.getTime() + 1000 || expires <= now.getTime() || expires <= issued || expires - issued > ACCESS_COMMAND_TTL_MS) return null;
    if (Object.entries(identity).some(([key, val]) => command[key as keyof Identity] !== val)) return null;
    for (const [id, expiry] of executed) if (expiry <= now.getTime()) executed.delete(id);
    if (executed.has(command.commandId)) return null;
    executed.set(command.commandId, expires);
    return { ...identity, commandId: command.commandId, result: "EXECUTED" };
  };
}
