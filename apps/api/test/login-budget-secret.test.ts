import assert from "node:assert/strict";
import { test } from "node:test";
import { loginBudgetSecret } from "../src/auth/login-budget-secret.js";
import { LoginSchema } from "../src/auth/login-schema.js";

test("production requires an explicit private budget secret and never accepts the development key", () => {
  const development = loginBudgetSecret(undefined, "development");
  assert.equal(loginBudgetSecret(undefined, "test"), development);
  for (const value of [undefined, "", "x".repeat(31), "x".repeat(513), " " + "x".repeat(32), development]) {
    assert.throws(() => loginBudgetSecret(value, "production"), /AUTH_RATE_LIMIT_KEY/);
  }
  const privateKey = "a-distinct-32-byte-plus-private-key";
  assert.equal(loginBudgetSecret(privateKey, "production"), privateKey);
  assert.throws(() => loginBudgetSecret("bad", "test"), /AUTH_RATE_LIMIT_KEY/);
});

test("login schemas bound UTF8 work and preserve the literal password", () => {
  const password = "  Senha\u0000 exata \ud83d\udd11  ";
  assert.equal(LoginSchema.parse({ email: "Case@example.invalid", password }).password, password);
  assert.equal(LoginSchema.parse({ email: "Case@example.invalid", password }).email, "Case@example.invalid");
  assert.ok(LoginSchema.safeParse({ email: "a@example.invalid", password: "a".repeat(1024) }).success);
  for (const value of ["a".repeat(1025), "\u00e9".repeat(513)]) assert.equal(LoginSchema.safeParse({ email: "a@example.invalid", password: value }).success, false);
  assert.equal(LoginSchema.safeParse({ email: "x".repeat(244) + "@example.invalid", password }).success, false);
  assert.equal(LoginSchema.safeParse({ email: "a@example.invalid", password, other: "unused" }).success, false);
});
