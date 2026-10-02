/** Public JSON contracts only: these types have no database or runtime dependency. */
export type AuthRole = "PLATFORM_ADMIN" | "BUILDING_ADMIN" | "RESIDENT";

export type SessionMembership = {
  buildingId: string;
  role: "BUILDING_ADMIN" | "RESIDENT";
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  memberships: SessionMembership[];
};

export type SessionTokens = { accessToken: string; refreshToken: string };
export type Session = SessionTokens & { user: AuthUser };
export type LoginRequest = { email: string; password: string };
export type RefreshRequest = { refreshToken: string };
export type LogoutRequest = RefreshRequest;
export type MeResponse = AuthUser;
export type ApiErrorResponse = { error: string };
