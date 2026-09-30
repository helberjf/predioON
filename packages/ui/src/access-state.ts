import type { AccessCommandView } from "@predioon/shared";

export function isAccessRequestSettled(requestId: string | undefined, command: AccessCommandView | null | undefined): boolean {
  return !!requestId && command?.requestId === requestId && !["PENDING", "SENT"].includes(command.status);
}

export function reconcileAccessCommand(local: AccessCommandView | null | undefined, remote: AccessCommandView | null | undefined): AccessCommandView | null {
  if (!local) return remote ?? null;
  if (!remote) return local;
  if (local.id !== remote.id) return Date.parse(remote.createdAt) >= Date.parse(local.createdAt) ? remote : local;
  const stage = { PENDING: 0, SENT: 1, ACKNOWLEDGED: 3, FAILED: 2, EXPIRED: 2 };
  // Overlapping requests can return out of order; confirmed states never regress to waiting.
  return stage[remote.status] >= stage[local.status] ? remote : local;
}
