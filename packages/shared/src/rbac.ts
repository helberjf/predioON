import { z } from "zod";

/** Capabilities are atomic grants evaluated with tenant/resource scope. */
export const CAPABILITIES = [
  "platform:read-health",
  "buildings:read", "buildings:manage", "buildings:provision", "features:manage",
  "notices:read", "notices:manage", "occurrences:create-own", "occurrences:read-own", "occurrences:manage",
  "common-areas:read", "common-areas:manage",
  "telemetry:read", "telemetry:read-published", "alerts:read", "alerts:acknowledge", "alerts:resolve", "work-orders:read-assigned", "work-orders:assign",
  "work-orders:update-assigned", "devices:read", "devices:configure", "commands:request", "automations:read",
  "automations:manage", "finance:read", "memberships:read", "memberships:manage", "units:read", "units:manage",
  "teams:read", "teams:manage", "support:read", "support:grant", "plans:read", "plans:manage", "rbac:manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CapabilitySchema = z.enum(CAPABILITIES);

export const RESOURCE_TYPES = ["building", "block", "unit", "team", "membership", "device", "gateway", "alert", "work_order", "automation", "finance", "support_grant", "notice", "occurrence", "telemetry", "common_area"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const ResourceTypeSchema = z.enum(RESOURCE_TYPES);

export const RBAC_ROLES = ["PLATFORM_ADMIN", "PLATFORM_SUPPORT", "BUILDING_ADMIN", "MAINTENANCE_MANAGER", "MAINTENANCE", "RESIDENT"] as const;
export type RbacRole = (typeof RBAC_ROLES)[number];
export const RbacRoleSchema = z.enum(RBAC_ROLES);

/** Complete initial role catalogue. Adding a role requires an explicit set. */
export const ROLE_CAPABILITIES: Readonly<Record<RbacRole, readonly Capability[]>> = {
  PLATFORM_ADMIN: ["platform:read-health", "buildings:read", "buildings:manage", "buildings:provision", "features:manage", "plans:read", "plans:manage", "rbac:manage", "support:grant"],
  PLATFORM_SUPPORT: [],
  BUILDING_ADMIN: ["common-areas:read", "common-areas:manage", "buildings:read", "buildings:manage", "notices:read", "notices:manage", "occurrences:create-own", "occurrences:read-own", "occurrences:manage", "telemetry:read", "telemetry:read-published", "alerts:read", "alerts:acknowledge", "alerts:resolve", "work-orders:read-assigned", "work-orders:assign", "work-orders:update-assigned", "devices:read", "devices:configure", "commands:request", "automations:read", "automations:manage", "finance:read", "memberships:read", "memberships:manage", "units:read", "units:manage", "teams:read", "teams:manage", "support:read"],
  MAINTENANCE_MANAGER: ["common-areas:read", "buildings:read", "notices:read", "occurrences:create-own", "occurrences:read-own", "occurrences:manage", "telemetry:read", "telemetry:read-published", "alerts:read", "alerts:acknowledge", "alerts:resolve", "work-orders:read-assigned", "work-orders:assign", "work-orders:update-assigned", "devices:read", "automations:read", "teams:read", "units:read"],
  MAINTENANCE: ["common-areas:read", "buildings:read", "notices:read", "occurrences:create-own", "occurrences:read-own", "telemetry:read", "telemetry:read-published", "alerts:read", "alerts:acknowledge", "work-orders:read-assigned", "work-orders:update-assigned", "devices:read", "automations:read", "units:read"],
  RESIDENT: ["buildings:read", "notices:read", "occurrences:create-own", "occurrences:read-own", "telemetry:read-published", "units:read", "common-areas:read"],
};

export type AuthorizationBinding = {
  role: RbacRole;
  buildingId: string | null;
  resourceType?: ResourceType | null;
  resourceId?: string | null;
  active: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
};
export type SupportGrant = {
  buildingId: string;
  capability: Capability;
  resourceType?: ResourceType | null;
  resourceId?: string | null;
  active: boolean;
  reason: string;
  expiresAt: Date | string;
};
export type AuthorizationSubject = { userId: string; active: boolean; bindings: readonly AuthorizationBinding[]; supportGrants: readonly SupportGrant[] };
export type AuthorizationScope = { buildingId: string; resourceType?: ResourceType | null; resourceId?: string | null };

export const SUPPORT_CAPABILITIES: readonly Capability[] = ["telemetry:read", "alerts:read", "devices:read", "work-orders:read-assigned", "support:read"];

function at(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return time;
}
function currentlyActive(active: boolean, startsAt: Date | string | null | undefined, endsAt: Date | string | null | undefined, now: number): boolean {
  if (active !== true || !Number.isFinite(now)) return false;
  const starts = at(startsAt), ends = at(endsAt);
  return (starts === null || (Number.isFinite(starts) && starts <= now)) &&
    (ends === null || (Number.isFinite(ends) && ends > now)) &&
    (starts === null || ends === null || ends > starts);
}
function validResource(resourceType: ResourceType | null | undefined, resourceId: string | null | undefined): boolean {
  if (resourceType == null && resourceId == null) return true;
  return ResourceTypeSchema.safeParse(resourceType).success && typeof resourceId === "string" && resourceId.trim().length > 0;
}
function scopeMatches(scope: AuthorizationScope, buildingId: string | null, resourceType: ResourceType | null | undefined, resourceId: string | null | undefined): boolean {
  return typeof buildingId === "string" && buildingId.length > 0 && buildingId === scope.buildingId && validResource(resourceType, resourceId) &&
    (resourceType == null || (resourceType === scope.resourceType && resourceId === scope.resourceId));
}
export function allowsCapability(subject: AuthorizationSubject, capability: Capability, scope: AuthorizationScope, now = new Date()): boolean {
  if (subject.active !== true || !CapabilitySchema.safeParse(capability).success || !scope.buildingId || !validResource(scope.resourceType, scope.resourceId)) return false;
  const nowMs = now.getTime();
  if (subject.bindings.some(binding => binding.role !== "PLATFORM_ADMIN" && binding.role !== "PLATFORM_SUPPORT" && currentlyActive(binding.active, binding.startsAt, binding.endsAt, nowMs) && roleGrants(binding.role, capability) && scopeMatches(scope, binding.buildingId, binding.resourceType, binding.resourceId))) return true;
  const hasSupportRole = subject.bindings.some(binding => binding.role === "PLATFORM_SUPPORT" && binding.buildingId === null && binding.resourceType == null && binding.resourceId == null && currentlyActive(binding.active, binding.startsAt, binding.endsAt, nowMs));
  return hasSupportRole && SUPPORT_CAPABILITIES.includes(capability) && subject.supportGrants.some(grant => grant.expiresAt != null && currentlyActive(grant.active, undefined, grant.expiresAt, nowMs) && grant.capability === capability && typeof grant.reason === "string" && grant.reason.trim().length > 0 && scopeMatches(scope, grant.buildingId, grant.resourceType, grant.resourceId));
}
export function roleGrants(role: RbacRole, capability: Capability): boolean { return RbacRoleSchema.safeParse(role).success && ROLE_CAPABILITIES[role].includes(capability); }
