import assert from "node:assert/strict";
import { test } from "node:test";
import { loginBudgetKeys } from "../src/auth/login-budget-keys.js";

const secret = "isolated-login-budget-key-for-tests-only";
const hex = (value: Buffer) => value.toString("hex");

test("the account budget uses the same exact lowercase identity as login across clients", () => {
  const first = loginBudgetKeys(secret, "Alice@Example.Invalid", "192.0.2.1");
  const second = loginBudgetKeys(secret, "alice@example.invalid", "192.0.2.2");
  assert.equal(hex(first.account), hex(second.account));
  assert.notEqual(hex(first.network), hex(second.network));
  assert.notEqual(hex(first.account), hex(loginBudgetKeys(secret, "bob@example.invalid", "192.0.2.1").account));
  assert.notEqual(hex(first.account), hex(loginBudgetKeys(secret, " alice@example.invalid", "192.0.2.1").account), "do not add normalization absent from the login identity");
});

test("mapped IPv4 spellings share a budget and native IPv6 uses its network64 prefix", () => {
  const key = (address: string) => hex(loginBudgetKeys(secret, "a@example.invalid", address).network);
  for (const address of ["::ffff:192.0.2.1", "::ffff:c000:201", "0:0:0:0:0:ffff:c000:0201"])
    assert.equal(key(address), key("192.0.2.1"));
  assert.notEqual(key("192.0.2.1"), key("192.0.2.2"));
  for (const address of ["2001:0DB8:ABCD:0012::1", "2001:db8:abcd:12:1234:5678:abcd:efab", "2001:db8:abcd:12::192.0.2.1"])
    assert.equal(key(address), key("2001:db8:abcd:12::"));
  assert.notEqual(key("2001:db8:abcd:12::1"), key("2001:db8:abcd:13::1"));
});

test("invalid or missing network strings cannot create unlimited distinct buckets", () => {
  const missing = hex(loginBudgetKeys(secret, "a@example.invalid", undefined).network);
  for (const value of [null, "", "unknown", "garbage", "[::1]", "::1%eth0", "192.0.2.1:80", "192.000.2.1", "x".repeat(5000)])
    assert.equal(hex(loginBudgetKeys(secret, "a@example.invalid", value).network), missing);
});

test("keys are private fixed-size HMACs and secret rotation changes every namespace", () => {
  const keys = loginBudgetKeys(secret, "alice@example.invalid", "192.0.2.1");
  for (const value of Object.values(keys)) {
    assert.equal(value.length, 32);
    assert.equal(value.includes("alice@example.invalid"), false);
    assert.equal(value.includes("192.0.2.1"), false);
  }
  assert.notEqual(hex(keys.account), hex(keys.network));
  const rotated = loginBudgetKeys(secret + "-rotated", "alice@example.invalid", "192.0.2.1");
  assert.notEqual(hex(keys.account), hex(rotated.account));
  assert.notEqual(hex(keys.network), hex(rotated.network));
  assert.throws(() => loginBudgetKeys("short", "a@example.invalid", "192.0.2.1"), /AUTH_RATE_LIMIT_KEY/);
});
