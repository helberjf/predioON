import type { Capability, ResourceType } from "@predioon/shared";

export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export type AuthorizationResponse = { buildingId: string; resourceType?: ResourceType; resourceId?: string; capabilities: Capability[] };
/** Finite commercial projection; it does not enumerate tenants or authorize other admin modules. */
export type PlatformAuthorizationResponse = { capabilities: Array<Extract<Capability, "organizations:read" | "organizations:manage">> };
export type BlockView = { id: string; buildingId: string; code: string; name: string; active: boolean };
export type UnitView = { id: string; buildingId: string; blockId: string | null; code: string; floor: number | null; active: boolean };
export type TeamView = { id: string; buildingId: string; name: string; kind: string; active: boolean };
export type MembershipValidity = { startsAt?: string | null; endsAt?: string | null };
export type CreateBlockRequest = { buildingId: string; code: string; name: string };
export type CreateUnitRequest = { buildingId: string; blockId?: string | null; code: string; floor?: number | null };
export type CreateTeamRequest = { buildingId: string; name: string };
/** Edits keep the condominium and the active state; send only the fields to change. */
export type UpdateBlockRequest = { code?: string; name?: string };
export type UpdateUnitRequest = { blockId?: string | null; code?: string; floor?: number | null };
export type UpdateTeamRequest = { name?: string };
/** Deactivation preserves the record; access derived from it ends until it is reactivated. */
export type UpdateTenancyStatusRequest = { active: boolean };
export type CreateUnitMembershipRequest = MembershipValidity & { buildingId: string; unitId: string; userId: string; kind: "OWNER" | "OCCUPANT" | "DEPENDENT" };
export type CreateTeamMemberRequest = MembershipValidity & { buildingId: string; teamId: string; userId: string };
export type CreateRoleBindingRequest = MembershipValidity & {
  buildingId: string;
  roleKey: "BUILDING_ADMIN" | "MAINTENANCE_MANAGER" | "MAINTENANCE" | "RESIDENT";
  reason: string;
} & ({ userId: string; teamId?: never } | { userId?: never; teamId: string });
