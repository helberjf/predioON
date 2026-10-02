import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { config } from "../config.js";

const issuer = "predioon-api";
const audience = "predioon-api";
const algorithm = "EdDSA";

function pem(value: string): string { return value.replace(/\\n/g, "\n"); }

function loadKeys(): { activeKid: string; privateKey: KeyObject; publicKeys: Map<string, KeyObject> } {
  if (!config.JWT_PRIVATE_KEY) {
    // Development only: restarting the process invalidates its access tokens.
    const pair = generateKeyPairSync("ed25519");
    return { activeKid: "dev-ephemeral", privateKey: pair.privateKey, publicKeys: new Map([["dev-ephemeral", pair.publicKey]]) };
  }
  const privateKey = createPrivateKey(pem(config.JWT_PRIVATE_KEY));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("JWT_PRIVATE_KEY deve ser Ed25519");
  let entries: unknown;
  try { entries = JSON.parse(config.JWT_PUBLIC_KEYS!); } catch { throw new Error("JWT_PUBLIC_KEYS deve ser JSON válido"); }
  const parsed = z.record(z.string().min(1), z.string().min(1)).safeParse(entries);
  if (!parsed.success) throw new Error("JWT_PUBLIC_KEYS deve mapear kid para chave pública PEM");
  const publicKeys = new Map<string, KeyObject>();
  for (const [kid, keyPem] of Object.entries(parsed.data)) {
    const publicKey = createPublicKey(pem(keyPem));
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error(`JWT_PUBLIC_KEYS[${kid}] deve ser Ed25519`);
    publicKeys.set(kid, publicKey);
  }
  const activeKid = config.JWT_ACTIVE_KID!;
  const activePublic = publicKeys.get(activeKid);
  if (!activePublic || !createPublicKey(privateKey).equals(activePublic)) throw new Error("Chave pública ativa não corresponde à chave privada");
  return { activeKid, privateKey, publicKeys };
}

const keys = loadKeys();

export const AccessTokenClaimsSchema = z.object({ sub: z.string().min(1), sid: z.string().uuid() });
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

export function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sub: claims.sub, sid: claims.sid })
    .setProtectedHeader({ alg: algorithm, kid: keys.activeKid })
    .setIssuedAt().setIssuer(issuer).setAudience(audience)
    .setExpirationTime(`${config.JWT_ACCESS_TTL_MINUTES}m`)
    .sign(keys.privateKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, (header) => {
      if (header.alg !== algorithm || !header.kid) throw new Error("Algoritmo ou kid inválido");
      const key = keys.publicKeys.get(header.kid);
      if (!key) throw new Error("kid desconhecido");
      return key;
    }, { issuer, audience, algorithms: [algorithm], requiredClaims: ["sub", "sid", "iat", "exp"] });
    const parsed = AccessTokenClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque; only SHA-256 hashes are persisted. */
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
