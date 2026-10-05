/** Commercial data requires a global organizations:read capability. */
export type OrganizationView = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type CreateOrganizationRequest = { name: string; slug: string; metadata?: Record<string, unknown> };
export type UpdateOrganizationRequest = Partial<CreateOrganizationRequest> & { active?: boolean };
