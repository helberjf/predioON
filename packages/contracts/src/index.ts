// Compatibility facade while callers migrate from @predioon/shared.
// shared contains public schemas/helpers only; the boundary check enforces this.
export * from "@predioon/shared";
export type {
  ApiErrorResponse, AuthRole, AuthUser, LoginRequest, LogoutRequest,
  MeResponse, RefreshRequest, Session, SessionMembership, SessionTokens,
} from "./auth.js";
export type * from "./tenancy.js";
export type * from "./overview.js";
export type * from "./reservations.js";
export type * from "./audit.js";
