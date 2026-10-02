import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions, verify } from "@node-rs/argon2";
import { createPasswordVerifier, hashPassword, verifyPassword } from "../src/auth/passwords.js";

test("missing credentials still await a real-cost comparison and can never authenticate", async () => {
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const check = createPasswordVerifier(async (encoded, plain) => {
    assert.equal(plain, "attempt");
    calls.push(encoded);
    return pending;
  });
  let settled = false;
  const result = check("attempt", null).then(value => { settled = true; return value; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, "missing users must not skip the password KDF");
  assert.equal(settled, false, "the negative response waits for the KDF");
  const current = parseOptions(await hashPassword("comparison-policy"));
  assert.deepEqual(parseOptions(calls[0]!), current, "dummy and current hashes use identical cost parameters");
  finish(true);
  assert.equal(await result, false, "even a positive dummy comparison is never authentication");
});

test("malformed stored credentials perform fallback work without accepting its result", async () => {
  const calls: string[] = [];
  const check = createPasswordVerifier(async encoded => {
    calls.push(encoded);
    if (encoded === "malformed") throw new Error("invalid PHC");
    return true;
  });
  assert.equal(await check("attempt", "malformed"), false);
  assert.equal(calls.length, 2);
  assert.equal(parseOptions(calls[1]!).memoryCost, 19456);
});

test("valid stored credentials keep the exact submitted value and compare only once", async () => {
  const encoded = await hashPassword("  sênha\u0000 longa 🔑  ");
  let count = 0;
  const check = createPasswordVerifier(async (hash, plain) => { count++; return verify(hash, plain); });
  assert.equal(await check("  sênha\u0000 longa 🔑  ", encoded), true);
  assert.equal(count, 1);
  assert.equal(await check("sênha\u0000 longa 🔑", encoded), false);
  assert.equal(count, 2);
});

test("the actual verifier rejects missing, empty and malformed hashes", async () => {
  for (const encoded of [null, "", "not-an-argon-hash"]) {
    assert.equal(await verifyPassword("attempt", encoded), false);
  }
});

test("a failing comparison provider fails closed without retrying indefinitely", async () => {
  let calls = 0;
  const check = createPasswordVerifier(async () => { calls++; throw new Error("provider unavailable"); });
  assert.equal(await check("attempt", null), false);
  assert.equal(calls, 1);
  calls = 0;
  assert.equal(await check("attempt", "invalid"), false);
  assert.equal(calls, 2);
});
