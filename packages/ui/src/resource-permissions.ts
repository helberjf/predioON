import type { AuthorizationResponse } from "@predioon/contracts/tenancy";

export type AuthorizationTarget = Omit<AuthorizationResponse, "capabilities">;

export function authorizationPath(target: AuthorizationTarget): string {
  const params = new URLSearchParams({ buildingId: target.buildingId });
  if (target.resourceType && target.resourceId) {
    params.set("resourceType", target.resourceType);
    params.set("resourceId", target.resourceId);
  }
  return `/v1/authorization?${params}`;
}

/** A late response for a previous item or tenant never authorizes this item. */
function capabilitiesFor(target: AuthorizationTarget, response?: AuthorizationResponse | null) {
  return response && response.buildingId === target.buildingId
    && response.resourceType === target.resourceType && response.resourceId === target.resourceId
    ? response.capabilities : [];
}

type AlertSubject = { id: string; buildingId: string; deviceId: string | null; gatewayId: string | null };
export function alertAuthorizationTargets(alert: AlertSubject): AuthorizationTarget[] {
  return [
    { buildingId: alert.buildingId, resourceType: "alert", resourceId: alert.id },
    ...(alert.deviceId ? [{ buildingId: alert.buildingId, resourceType: "device" as const, resourceId: alert.deviceId }] : []),
    ...(alert.gatewayId ? [{ buildingId: alert.buildingId, resourceType: "gateway" as const, resourceId: alert.gatewayId }] : []),
  ];
}

export function alertPermissions(buildingId: string, alert: AlertSubject, responses: readonly (AuthorizationResponse | null | undefined)[]) {
  // SQL accepts the alert's actual parents. Inventory access is a separate right.
  const targets = alert.buildingId === buildingId ? alertAuthorizationTargets(alert) : [];
  const capabilities = new Set(targets.flatMap(target => responses.flatMap(response => capabilitiesFor(target, response))));
  const read = capabilities.has("alerts:read");
  return { read, acknowledge: read && capabilities.has("alerts:acknowledge"), resolve: read && capabilities.has("alerts:resolve") };
}

export function occurrenceWorkspacePermissions(buildingId: string, response?: AuthorizationResponse | null) {
  const capabilities = capabilitiesFor({ buildingId }, response);
  return {
    create: capabilities.includes("occurrences:create-own") && capabilities.includes("occurrences:read-own"),
    manageGroup: capabilities.includes("occurrences:manage"),
  };
}

export function occurrencePermissions(buildingId: string, userId: string | undefined, row: { id: string; buildingId: string; openedBy: string | null; status: string }, response?: AuthorizationResponse | null) {
  const capabilities = row.buildingId === buildingId
    ? capabilitiesFor({ buildingId, resourceType: "occurrence", resourceId: row.id }, response) : [];
  const manage = capabilities.includes("occurrences:manage");
  const own = row.openedBy === userId && capabilities.includes("occurrences:read-own");
  return { read: manage || own, manage, comment: manage || own, cancelOwn: own && !manage && !["DONE", "CANCELLED"].includes(row.status) };
}
