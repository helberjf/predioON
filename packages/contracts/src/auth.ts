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
/** Browser renewal credentials are delivered only in an HttpOnly cookie. */
export type WebSession = { accessToken: string; user: AuthUser };
export type LoginRequest = { email: string; password: string };
/** The authenticated account/session are server-derived, never body selectors. */
export type PasswordChangeRequest = { currentPassword: string; newPassword: string };
export type RefreshRequest = { refreshToken: string };
export type LogoutRequest = RefreshRequest;
export type MeResponse = AuthUser;
/** Own session metadata; credentials are never part of this response. */
export type SessionView = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
};
export type ApiErrorResponse = { error: string };
