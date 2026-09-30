import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from "jose";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { signAccessToken, verifyAccessToken } from "../src/auth/tokens.js";

const claims = { sub: "resident_demo", sid: "182da407-3cdb-4796-b9d7-303c0304a68e" };

describe("access token cryptography", () => {
  it("rejects missing production keys at startup", () => {
    const env = { ...process.env, NODE_ENV: "production" };
    delete env.JWT_ACTIVE_KID; delete env.JWT_PRIVATE_KEY; delete env.JWT_PUBLIC_KEYS;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./src/auth/tokens.ts')"], {
      cwd: process.cwd(), env, encoding: "utf8",
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /JWT_ACTIVE_KID/);
  });

  it("verifies previous public keys after rotating the active signer", () => {
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const publicKeys = JSON.stringify({
      first: first.publicKey.export({ format: "pem", type: "spki" }),
      second: second.publicKey.export({ format: "pem", type: "spki" }),
    });
    const base = { ...process.env, NODE_ENV: "production", JWT_PUBLIC_KEYS: publicKeys };
    const firstEnv = { ...base, JWT_ACTIVE_KID: "first", JWT_PRIVATE_KEY: first.privateKey.export({ format: "pem", type: "pkcs8" }) as string };
    const signed = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "const {signAccessToken}=await import('./src/auth/tokens.ts'); console.log(await signAccessToken({sub:'resident_demo',sid:'182da407-3cdb-4796-b9d7-303c0304a68e'}))"],
      { cwd: process.cwd(), env: firstEnv, encoding: "utf8" });
    assert.equal(signed.status, 0, signed.stderr);
    const secondEnv = { ...base, JWT_ACTIVE_KID: "second", JWT_PRIVATE_KEY: second.privateKey.export({ format: "pem", type: "pkcs8" }) as string };
    const verified = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "const {verifyAccessToken}=await import('./src/auth/tokens.ts'); console.log(JSON.stringify(await verifyAccessToken(process.argv[1])))", signed.stdout.trim()],
      { cwd: process.cwd(), env: secondEnv, encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout.trim()), claims);
    const rejected = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", [
      "const {verifyAccessToken}=await import('./src/auth/tokens.ts');",
      "const {SignJWT}=await import('jose');",
      "const {createPrivateKey}=await import('node:crypto');",
      "const key=createPrivateKey(process.env.JWT_PRIVATE_KEY);",
      "const payload={sub:'resident_demo',sid:'182da407-3cdb-4796-b9d7-303c0304a68e'};",
      "const sign=(aud,exp)=>new SignJWT(payload).setProtectedHeader({alg:'EdDSA',kid:'second'}).setIssuedAt().setIssuer('predioon-api').setAudience(aud).setExpirationTime(exp).sign(key);",
      "console.log(JSON.stringify([await verifyAccessToken(await sign('another-api','5m')),await verifyAccessToken(await sign('predioon-api','-1s'))]));",
    ].join(" ")], { cwd: process.cwd(), env: secondEnv, encoding: "utf8" });
    assert.equal(rejected.status, 0, rejected.stderr);
    assert.deepEqual(JSON.parse(rejected.stdout.trim()), [null, null]);
  });
  it("signs a short-lived EdDSA token with session, issuer, audience and key id", async () => {
    const token = await signAccessToken(claims);
    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);
    assert.equal(header.alg, "EdDSA");
    assert.equal(typeof header.kid, "string");
    assert.equal(payload.sid, claims.sid);
    assert.equal(payload.iss, "predioon-api");
    assert.equal(payload.aud, "predioon-api");
    assert.ok(typeof payload.exp === "number" && typeof payload.iat === "number");
    assert.ok(payload.exp! - payload.iat! <= 300);
    assert.deepEqual(await verifyAccessToken(token), claims);
  });

  it("rejects a forged signature, unknown key and legacy HS token", async () => {
    const valid = await signAccessToken(claims);
    const { privateKey } = await generateKeyPair("EdDSA");
    const forged = await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: decodeProtectedHeader(valid).kid }).setIssuer("predioon-api").setAudience("predioon-api").setExpirationTime("5m").sign(privateKey);
    const unknown = await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "unknown" }).setIssuer("predioon-api").setAudience("predioon-api").setExpirationTime("5m").sign(privateKey);
    const legacy = await new SignJWT({ sub: claims.sub }).setProtectedHeader({ alg: "HS256" }).setIssuer("predioon").setExpirationTime("5m").sign(new TextEncoder().encode("a-legacy-secret-that-was-long-enough"));
    for (const token of [forged, unknown, legacy]) {
      assert.equal(await verifyAccessToken(token), null);
    }
  });
});
