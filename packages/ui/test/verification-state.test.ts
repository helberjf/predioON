import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { askForVerification, needsRecentVerification, setVerificationPrompt, withRecentVerification } from "../src/verification-state.ts";

const required = Object.assign(new Error("Confirme sua senha para concluir esta ação."), { status: 403, reason: "VERIFICATION_REQUIRED" });
afterEach(() => setVerificationPrompt(null));

test("only a 403 carrying VERIFICATION_REQUIRED asks for the password", () => {
  assert.equal(needsRecentVerification(required), true);
  assert.equal(needsRecentVerification({ status: 403 }), false);
  assert.equal(needsRecentVerification({ status: 400, reason: "VERIFICATION_REQUIRED" }), false);
  assert.equal(needsRecentVerification(null), false);
});

test("repeats the request once after the person confirms", async () => {
  let calls = 0;
  const result = await withRecentVerification(async () => { if (++calls === 1) throw required; return "ok"; }, async () => true);
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("a cancelled prompt or a second refusal surfaces the original error", async () => {
  let calls = 0;
  await assert.rejects(withRecentVerification(async () => { calls++; throw required; }, async () => false), required);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withRecentVerification(async () => { calls++; throw required; }, async () => true), required);
  assert.equal(calls, 2, "never loops asking again");
});

test("other errors pass through without asking", async () => {
  let asked = false;
  const other = Object.assign(new Error("Sem permissão"), { status: 403 });
  await assert.rejects(withRecentVerification(async () => { throw other; }, async () => { asked = true; return true; }), other);
  assert.equal(asked, false);
});

test("without a mounted dialog nothing asks; concurrent requests share one prompt", async () => {
  assert.equal(await askForVerification(), false);
  let prompts = 0;
  let release!: (value: boolean) => void;
  setVerificationPrompt(() => { prompts++; return new Promise(resolve => { release = resolve; }); });
  const first = askForVerification(), second = askForVerification();
  release(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(prompts, 1);
  setVerificationPrompt(async () => { throw new Error("closed"); });
  assert.equal(await askForVerification(), false, "a failing prompt counts as cancelled");
});
