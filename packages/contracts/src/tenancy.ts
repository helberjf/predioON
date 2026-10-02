import type { Capability, ResourceType } from "@predioon/shared";

export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export type AuthorizationResponse = { buildingId: string; resourceType?: ResourceType; resourceId?: string; capabilities: Capability[] };
export type BlockView = { id: string; buildingId: string; code: string; name: string };
export type UnitView = { id: string; buildingId: string; blockId: string | null; code: string; floor: number | null };
export type TeamView = { id: string; buildingId: string; name: string; kind: string };
export type MembershipValidity = { startsAt?: string | null; endsAt?: string | null };
export type CreateBlockRequest = { buildingId: string; code: string; name: string };
export type CreateUnitRequest = { buildingId: string; blockId?: string | null; code: string; floor?: number | null };
export type CreateTeamRequest = { buildingId: string; name: string };
export type CreateUnitMembershipRequest = MembershipValidity & { buildingId: string; unitId: string; userId: string; kind: "OWNER" | "OCCUPANT" | "DEPENDENT" };
export type CreateTeamMemberRequest = MembershipValidity & { buildingId: string; teamId: string; userId: string };
export type CreateRoleBindingRequest = MembershipValidity & {
  buildingId: string;
  roleKey: "BUILDING_ADMIN" | "MAINTENANCE_MANAGER" | "MAINTENANCE" | "RESIDENT";
  reason: string;
} & ({ userId: string; teamId?: never } | { userId?: never; teamId: string });
