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
export type LoginRequest = { email: string; password: string; /** TOTP or recovery code, for accounts with two-step verification. */ code?: string };
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
/** What the bearer of a valid invitation secret may see before accepting. */
export type InvitationPreview = { email: string; name: string; buildingName: string; accountExists: boolean; expiresAt: string };
export type InvitationPreviewRequest = { token: string };
/** For a new account `password` becomes the credential; for an existing one it only proves ownership. */
export type InvitationAcceptRequest = { token: string; password: string };

/** The login answer (401) for an account with two-step verification when no code was sent. Clients then ask for it. */
export const MFA_REQUIRED_MESSAGE = "Informe o código de verificação do seu aplicativo autenticador.";
export type MfaStatus = { enabled: boolean; pending: boolean; recoveryCodesRemaining: number; /** False when the server has no MFA key configured. */ available: boolean };
/** Returned once when enrolment starts; the factor is enforced only after confirmation. */
export type MfaEnrollResponse = { secret: string; otpauthUri: string };
/** Recovery codes are shown only here. */
export type MfaConfirmResponse = { recoveryCodes: string[] };
/** Always answered with 204, whether or not the address has an account. */
export type PasswordForgotRequest = { email: string };
export type PasswordResetRequest = { token: string; newPassword: string };

