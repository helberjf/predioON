import { z } from "zod";

export const RoleSchema = z.enum(["PLATFORM_ADMIN", "BUILDING_ADMIN", "RESIDENT"]);
export type Role = z.infer<typeof RoleSchema>;

/** Ordered from least to most privileged. Used by `hasAtLeast`. */
const RANK: Record<Role, number> = { RESIDENT: 0, BUILDING_ADMIN: 1, PLATFORM_ADMIN: 2 };

export function hasAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
