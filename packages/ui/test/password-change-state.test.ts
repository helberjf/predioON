import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@predioon/api-client";
import { passwordChangeError, passwordChangeValidation } from "../src/password-change-state.ts";

test("new passwords count Unicode code points rather than UTF-16 units", () => {
  const short = "🔐".repeat(14), valid = "🔐".repeat(15);
  assert.match(passwordChangeValidation("old", short, short)!, /15 caracteres/);
  assert.equal(passwordChangeValidation("old", valid, valid), null);
});

test("new passwords accept the UTF-8 boundary and reject an extra multibyte character", () => {
  const boundary = "🔐".repeat(256);
  assert.equal(passwordChangeValidation("old", boundary, boundary), null);
  assert.match(passwordChangeValidation("old", boundary + "é", boundary + "é")!, /1024 bytes/);
});

test("current passwords, new passwords and confirmation remain literal", () => {
  const literal = "  senha nova literal  ";
  assert.equal(passwordChangeValidation(" ", literal, literal), null);
  assert.match(passwordChangeValidation("", literal, literal)!, /senha atual/);
  assert.match(passwordChangeValidation(literal, literal, literal)!, /diferente/);
  assert.match(passwordChangeValidation("old", literal, literal.trim())!, /confirmação/);
  assert.equal(passwordChangeValidation("old", literal, literal), null);
});

test("legacy current passwords share the login byte bound without requiring the modern minimum", () => {
  const next = "uma nova senha literal";
  assert.equal(passwordChangeValidation("🔐".repeat(256), next, next), null);
  assert.equal(passwordChangeValidation("x", next, next), null);
  assert.match(passwordChangeValidation("🔐".repeat(257), next, next)!, /senha atual.*1024 bytes/);
});

test("isolated UTF-16 surrogates cannot become replacement credentials, while valid astral pairs remain literal", () => {
  const next = "  senha🔐nova🔑literal🧩  ";
  for (const malformed of ["\ud800", "\udbff", "\udc00", "\udfff", "\udc00\ud800", "\ud800x"]) {
    assert.equal(passwordChangeValidation(`old${malformed}`, next, next), null, "legacy current credentials stay verifiable");
    assert.match(passwordChangeValidation("old", next + malformed, next + malformed)!, /Unicode válidos/);
    assert.match(passwordChangeValidation("old", next, next + malformed)!, /Unicode válidos/);
  }
  assert.equal(passwordChangeValidation(" 🔐 ", next, next), null);
  assert.match(passwordChangeValidation("old", next, next.trim())!, /confirmação/);
});

test("failure messages never expose server or network text that might contain a credential", () => {
  const secret = "credential-do-not-echo";
  for (const failure of [new ApiError(400, secret), new ApiError(429, secret), new ApiError(503, secret), new Error(secret)]) {
    const message = passwordChangeError(failure);
    assert.ok(message);
    assert.equal(message.includes(secret), false);
  }
  assert.match(passwordChangeError(new ApiError(429, secret))!, /Aguarde/);
  assert.equal(passwordChangeError(new ApiError(0, secret, "SESSION_CHANGED")), null);
});
