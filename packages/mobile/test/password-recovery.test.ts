import assert from "node:assert/strict";
import test from "node:test";
import { createPasswordRecoveryController } from "../src/password-recovery.ts";

const create = createPasswordRecoveryController;
function deferred() {
  let resolve!: () => void; let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const blank = { email: "", pending: false, error: null, requested: false };
test("recovery validates bounded email before transport and only submits trimmed normalized email", async () => {
  const calls: string[] = []; const controller = create(async email => { calls.push(email); });
  for (const email of ["", "bad", "a@@example.test", "a b@example.test", "a@b", "x".repeat(245) + "@example.test"]) {
    controller.setEmail(email); await controller.submit();
    assert.equal(controller.snapshot().error, "Informe um e-mail válido.");
  }
  assert.equal(calls.length, 0);
  controller.setEmail(" Person@Example.test "); await controller.submit();
  assert.deepEqual(calls, ["person@example.test"]);
  assert.deepEqual(controller.snapshot(), { ...blank, requested: true });
});
test("the synchronous request guard blocks double submissions and edits while pending", async () => {
  const work = deferred(); let calls = 0;
  const controller = create(() => { calls++; return work.promise; });
  controller.setEmail("person@example.test");
  const first = controller.submit(); const second = controller.submit();
  controller.setEmail("other@example.test");
  assert.equal(calls, 1); assert.equal(controller.snapshot().pending, true);
  assert.equal(controller.snapshot().email, "person@example.test");
  work.resolve(); await Promise.all([first, second]);
  assert.deepEqual(controller.snapshot(), { ...blank, requested: true });
  await controller.submit(); assert.equal(calls, 1, "a confirmed screen cannot resend accidentally");
});
test("cancellation aborts the signal and stale completion cannot affect a new request", async () => {
  const old = deferred(), next = deferred(); const signals: AbortSignal[] = [];
  const controller = create((_email, signal) => { signals.push(signal!); return signals.length === 1 ? old.promise : next.promise; });
  controller.setEmail("old@example.test"); const first = controller.submit();
  controller.setActive(false);
  assert.equal(signals[0]!.aborted, true); assert.deepEqual(controller.snapshot(), blank);
  controller.setEmail("ignored@example.test"); await controller.submit(); assert.equal(signals.length, 1);
  controller.setActive(true); controller.setEmail("next@example.test"); const second = controller.submit();
  old.resolve(); await first;
  assert.equal(controller.snapshot().pending, true); assert.equal(controller.snapshot().email, "next@example.test");
  next.resolve(); await second; assert.equal(controller.snapshot().requested, true);
});
test("background, effect cleanup and StrictMode reactivation clear state without poisoning the controller", async () => {
  const old = deferred(); let calls = 0;
  const controller = create(() => { calls++; return calls === 1 ? old.promise : Promise.resolve(); });
  let notifications = 0; const unsubscribe = controller.subscribe(() => { notifications++; });
  controller.setEmail("person@example.test"); const pending = controller.submit();
  controller.setActive(false); controller.setActive(true);
  assert.deepEqual(controller.snapshot(), blank);
  old.reject(new Error("secret")); await pending; assert.deepEqual(controller.snapshot(), blank);
  controller.setEmail("next@example.test"); await controller.submit();
  assert.equal(controller.snapshot().requested, true); assert.ok(notifications > 0);
  unsubscribe(); const before = notifications; controller.setActive(false); assert.equal(notifications, before);
});
for (const status of [400, 401, 403, 429, 503, 0]) test(`recovery controller sanitizes status${status} and retains email for a deliberate retry`, async () => {
  const controller = create(async () => { throw { status, message: "SQL token person@example.test" }; });
  controller.setEmail("person@example.test"); await controller.submit();
  assert.equal(controller.snapshot().pending, false); assert.equal(controller.snapshot().requested, false);
  assert.equal(controller.snapshot().email, "person@example.test");
  assert.equal(controller.snapshot().error, status === 400 ? "Informe um e-mail válido." : status === 429 ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." : "Não foi possível solicitar a recuperação. Tente novamente mais tarde.");
});
