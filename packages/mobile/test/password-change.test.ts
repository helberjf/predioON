import test from "node:test";
import assert from "node:assert/strict";
import {
  createPasswordChangeController,
  passwordChangeValidation,
  type PasswordChangeFields,
  type PasswordChangeInput,
} from "../src/password-change.ts";

const fields: PasswordChangeFields = {
  currentPassword: "old-password",
  newPassword: "  Uma senha literal nova  ",
  confirmation: "  Uma senha literal nova  ",
};
function prepared(change: (input: PasswordChangeInput) => Promise<void>) {
  const controller = createPasswordChangeController(change);
  for (const [field, value] of Object.entries(fields))
    controller.setField(field as keyof PasswordChangeFields, value);
  return controller;
}
const empty = {
  currentPassword: "", newPassword: "", confirmation: "",
  pending: false, error: null,
};

test("new passwords count Unicode code points, accept spaces, and retain literal values", async () => {
  for (const newPassword of ["😀".repeat(15), " ".repeat(15), "é".repeat(15)])
    assert.equal(passwordChangeValidation({ ...fields, newPassword, confirmation: newPassword }), null);
  assert.match(passwordChangeValidation({ ...fields, newPassword: "😀".repeat(14) })!, /15 caracteres/);
  const received: PasswordChangeInput[] = [];
  const controller = prepared(async (input) => { received.push(input); });
  await controller.submit();
  assert.deepEqual(received, [{ currentPassword: fields.currentPassword, newPassword: fields.newPassword }]);
  assert.deepEqual(controller.snapshot(), empty);
});

test("UTF-8 bounds reject multibyte overflow and allow exactly 1024 bytes without TextEncoder", () => {
  const valid = "😀".repeat(256);
  assert.equal(passwordChangeValidation({ ...fields, newPassword: valid, confirmation: valid }), null);
  assert.match(passwordChangeValidation({ ...fields, newPassword: valid + "a", confirmation: valid + "a" })!, /1024 bytes/);
  assert.match(passwordChangeValidation({ ...fields, currentPassword: "é".repeat(513) })!, /senha atual.*1024 bytes/);
});

test("isolated high and low surrogates cannot become replacement bytes in new credential or confirmation", async () => {
  let requests = 0;
  for (const invalid of ["\ud800", "\udfff", "ok\ud800wrong", "\ud800\ud800", "\udfff\ud800"]) {
    for (const field of ["newPassword", "confirmation"] as const) {
      const malformed = { ...fields, [field]: invalid + "a".repeat(16) };
      const controller = createPasswordChangeController(async () => { requests++; });
      for (const [name, value] of Object.entries(malformed))
        controller.setField(name as keyof PasswordChangeFields, value);
      await controller.submit();
      assert.match(controller.snapshot().error!, /Unicode inválidos/);
      assert.equal(controller.snapshot().pending, false);
    }
  }
  assert.equal(requests, 0);
  const paired = "😀".repeat(15);
  assert.equal(passwordChangeValidation({ ...fields, newPassword: paired, confirmation: paired }), null);
});

test("legacy current passwords retain malformed UTF-16 literally while enforcing their complete UTF-8 byte limit", async () => {
  for (const currentPassword of ["\ud800old", "old\udfff", "\ud800\ud800\udfff"]) {
    const received: PasswordChangeInput[] = [];
    const controller = prepared(async (input) => { received.push(input); });
    controller.setField("currentPassword", currentPassword);
    await controller.submit();
    assert.deepEqual(received, [{ currentPassword, newPassword: fields.newPassword }]);
    assert.deepEqual(controller.snapshot(), empty);
  }
  assert.equal(Buffer.byteLength("\ud800" + "a".repeat(1022), "utf8"), 1025);
  assert.match(passwordChangeValidation({ ...fields, currentPassword: "\ud800" + "a".repeat(1022) })!, /1024 bytes/);
  const currentPassword = "\ud800" + "a".repeat(16);
  const newPassword = "\ufffd" + "a".repeat(16);
  assert.deepEqual(Buffer.from(currentPassword), Buffer.from(newPassword));
  assert.match(passwordChangeValidation({ currentPassword, newPassword, confirmation: newPassword })!, /diferente da atual/);
});

test("empty current password, reuse, and literal mismatch are rejected before HTTP", async () => {
  let requests = 0;
  for (const invalid of [
    { ...fields, currentPassword: "" },
    { ...fields, currentPassword: fields.newPassword },
    { ...fields, confirmation: fields.newPassword.trim() },
    { ...fields, newPassword: "TooShort", confirmation: "TooShort" },
  ]) {
    const controller = createPasswordChangeController(async () => { requests++; });
    for (const [field, value] of Object.entries(invalid))
      controller.setField(field as keyof PasswordChangeFields, value);
    await controller.submit();
    assert.ok(controller.snapshot().error);
    assert.equal(controller.snapshot().pending, false);
  }
  assert.equal(requests, 0);
});

test("one confirmed submission blocks rapid repeats and edits until it settles", async () => {
  let finish!: () => void;
  let requests = 0;
  const controller = prepared(() => {
    requests++;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const first = controller.submit();
  assert.equal(controller.snapshot().pending, true);
  await controller.submit();
  controller.setField("newPassword", "should never replace captured input");
  assert.equal(controller.snapshot().newPassword, fields.newPassword);
  assert.equal(requests, 1);
  finish();
  await first;
  assert.deepEqual(controller.snapshot(), empty);
});

test("incorrect current password keeps the form available for correction without clearing identity", async () => {
  let requests = 0;
  const controller = prepared(async () => {
    requests++;
    throw Object.assign(new Error(`Server must never echo ${fields.currentPassword}`), { status: 400 });
  });
  await controller.submit();
  assert.equal(requests, 1);
  assert.equal(controller.snapshot().pending, false);
  assert.equal(controller.snapshot().newPassword, fields.newPassword);
  assert.match(controller.snapshot().error!, /Confira a senha atual/);
  assert.doesNotMatch(controller.snapshot().error!, /Server must never echo|old-password/);
  controller.setField("currentPassword", "corrected-password");
  assert.equal(controller.snapshot().error, null);
});

test("rate limiting and persistence failure do not automatically resubmit credentials", async () => {
  for (const status of [429, 503]) {
    let requests = 0;
    const controller = prepared(async () => { requests++; throw { status }; });
    await controller.submit();
    assert.equal(requests, 1);
    assert.equal(controller.snapshot().pending, false);
    assert.equal(controller.snapshot().currentPassword, fields.currentPassword);
    assert.match(controller.snapshot().error!, status === 429 ? /Muitas tentativas/ : /Não foi possível confirmar/);
  }
});

test("network failure warns of an uncertain change and exposes no raw transport or password message", async () => {
  const controller = prepared(async () => { throw new Error(`request body ${JSON.stringify(fields)}`); });
  await controller.submit();
  assert.match(controller.snapshot().error!, /a senha pode ter sido alterada/);
  assert.doesNotMatch(controller.snapshot().error!, /request body|literal nova|old-password/);
});

test("leaving the screen clears all secrets and late failure cannot restore them", async () => {
  let fail!: (cause: unknown) => void;
  const controller = prepared(() => new Promise<void>((_, reject) => { fail = reject; }));
  const pending = controller.submit();
  controller.setActive(false);
  assert.deepEqual(controller.snapshot(), empty);
  fail({ status: 400 });
  await pending;
  assert.deepEqual(controller.snapshot(), empty);
});

test("background and resume never restore secrets or accept a second in-flight request", async () => {
  let finish!: () => void;
  let requests = 0;
  const controller = prepared(() => {
    requests++;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const first = controller.submit();
  controller.setActive(false);
  controller.setActive(true);
  assert.equal(controller.snapshot().pending, true);
  assert.equal(controller.snapshot().currentPassword, "");
  controller.setField("currentPassword", "new background password");
  await controller.submit();
  assert.equal(requests, 1);
  finish();
  await first;
  assert.deepEqual(controller.snapshot(), empty);
});

test("an unmounted identity cannot mutate again or clear a replacement identity's form", async () => {
  let finish!: () => void;
  let oldRequests = 0;
  const previous = prepared(() => {
    oldRequests++;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const first = previous.submit();
  previous.dispose();
  let nextRequests = 0;
  const replacement = prepared(async () => { nextRequests++; });
  await previous.submit();
  finish();
  await first;
  assert.deepEqual(previous.snapshot(), empty);
  assert.equal(replacement.snapshot().currentPassword, fields.currentPassword);
  assert.equal(oldRequests, 1);
  assert.equal(nextRequests, 0);
  await replacement.submit();
  assert.equal(nextRequests, 1);
  assert.deepEqual(replacement.snapshot(), empty);
});

test("active lifecycle replay is safe and clearing inactive fields never notifies disposed listeners", async () => {
  const controller = prepared(async () => {});
  controller.setActive(false);
  controller.setActive(true);
  controller.setField("currentPassword", fields.currentPassword);
  controller.setField("newPassword", fields.newPassword);
  controller.setField("confirmation", fields.confirmation);
  let notifications = 0;
  controller.subscribe(() => { notifications++; });
  await controller.submit();
  assert.equal(notifications, 2);
  controller.dispose();
  controller.setField("currentPassword", "ignored");
  controller.setActive(true);
  assert.deepEqual(controller.snapshot(), empty);
  assert.equal(notifications, 2);
});
