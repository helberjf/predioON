import assert from "node:assert/strict";
import { it } from "node:test";
import { base32Decode, base32Encode, matchTotp, otpauthUri, totpCode, totpStep } from "../src/auth/totp.js";

// RFC 6238 appendix B, SHA-1 rows, truncated to the six digits authenticator apps show.
const secret = Buffer.from("12345678901234567890");
const vectors: Array<[number, string]> = [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]];

it("produces the RFC 6238 reference codes", () => {
  for (const [seconds, code] of vectors) assert.equal(totpCode(secret, totpStep(seconds * 1000)), code, String(seconds));
});

it("accepts one step of drift either way and nothing beyond it", () => {
  const now = 1111111109 * 1000, step = totpStep(now);
  assert.equal(matchTotp(secret, totpCode(secret, step), now), step);
  assert.equal(matchTotp(secret, totpCode(secret, step - 1), now), step - 1);
  assert.equal(matchTotp(secret, totpCode(secret, step + 1), now), step + 1);
  assert.equal(matchTotp(secret, totpCode(secret, step + 2), now), null);
  assert.equal(matchTotp(secret, totpCode(secret, step - 2), now), null);
  for (const malformed of ["", "12345", "1234567", "12345a", " 081804", "081804 "]) assert.equal(matchTotp(secret, malformed, now), null, JSON.stringify(malformed));
});

it("round-trips base32 and rejects characters outside the alphabet", () => {
  assert.equal(base32Encode(secret), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), secret);
  assert.deepEqual(base32Decode("gezdgnbvgy3tqojqgezdgnbvgy3tqojq"), secret);
  for (const length of [1, 2, 3, 4, 5, 19, 20, 21]) {
    const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 11) & 255));
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes, String(length));
  }
  assert.equal(base32Decode("GEZD1"), null);
});

it("builds an otpauth URI that authenticator apps accept", () => {
  const uri = new URL(otpauthUri("Prédio ON", "pessoa+teste@example.invalid", secret));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(decodeURIComponent(uri.pathname), "/Prédio ON:pessoa+teste@example.invalid");
  assert.deepEqual(Object.fromEntries(uri.searchParams), { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", issuer: "Prédio ON", algorithm: "SHA1", digits: "6", period: "30" });
});
