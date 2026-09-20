import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export const AccessTokenClaimsSchema = z.object({
  sub: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["PLATFORM_ADMIN", "BUILDING_ADMIN", "RESIDENT"]),
  memberships: z.array(
    z.object({ buildingId: z.string(), role: z.enum(["BUILDING_ADMIN", "RESIDENT"]) }),
  ),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

export function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("predioon")
    .setExpirationTime(`${config.JWT_ACCESS_TTL_MINUTES}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: "predioon" });
    const parsed = AccessTokenClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are opaque random strings. Only their SHA-256 hash is stored,
 * so a database dump does not hand over working sessions.
 */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}
