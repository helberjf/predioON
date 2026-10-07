import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { hashPassword } from "../src/auth/passwords.js";
import { loginBudgetKeys } from "../src/auth/login-budget-keys.js";
import { MFA_REQUIRED_MESSAGE } from "../src/auth/mfa-factor.js";
import { base32Decode, totpCode, totpStep } from "../src/auth/totp.js";
import { config } from "../src/config.js";
import { call, startTestServer, type TestServer } from "./helpers.js";
// Clients recognise the request for a code by this exact text; the two copies must not drift.
import { MFA_REQUIRED_MESSAGE as CLIENT_MESSAGE } from "../../../packages/contracts/src/auth.ts";

describe("two-step verification with TOTP and recovery codes", () => {
  const suffix = randomUUID(), user = `mfa-user-${suffix}`, peer = `mfa-peer-${suffix}`;
  const email = `${user}@example.invalid`, password = "predioon123";
  let server: TestServer, token: string, secret: Buffer, recoveryCodes: string[];

  /** Admission is shared per account; these tests exercise the factor, not the budget. */
  const resetBudget = async () => {
    for (const address of [email, `${peer}@example.invalid`]) {
      await sqlClient`delete from auth_login_buckets where scope='account' and key_hash=${loginBudgetKeys(config.authRateLimitKey, address, "127.0.0.1").account}`;
    }
  };
  const signIn = (body: object) => call(server.url, "/auth/login", { method: "POST", body: { email, password, ...body } });
  const mfa = (path: string, method = "GET", body?: unknown, bearer = token) => call(server.url, `/auth/mfa${path}`, { method, body, token: bearer });
  const code = (offset = 0) => totpCode(secret, totpStep(Date.now()) + offset);
  const status = async () => await (await mfa("")).json() as { enabled: boolean; pending: boolean; recoveryCodesRemaining: number; available: boolean };

  before(async () => {
    const hash = await hashPassword(password);
    for (const id of [user, peer]) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@example.invalid`},${hash})`;
    server = await startTestServer();
    token = (await (await signIn({})).json() as { accessToken: string }).accessToken;
  });
  after(async () => {
    await server?.close();
    await resetBudget();
    await sqlClient`delete from users where id in (${user},${peer})`;
    await closeAppDb(); await sqlClient.end();
  });

  it("enrols only with the password and enforces nothing until the first code is confirmed", async () => {
    assert.deepEqual(await status(), { enabled: false, pending: false, recoveryCodesRemaining: 0, available: true });
    assert.equal((await mfa("/enroll", "POST", { currentPassword: "senha errada" })).status, 400);
    assert.equal((await mfa("/confirm", "POST", { code: "123456" })).status, 409, "nothing to confirm yet");
    const enrolled = await mfa("/enroll", "POST", { currentPassword: password });
    assert.equal(enrolled.status, 200);
    assert.equal(enrolled.headers.get("cache-control"), "no-store");
    const body = await enrolled.json() as { secret: string; otpauthUri: string };
    secret = base32Decode(body.secret)!;
    assert.equal(secret.length, 20);
    assert.ok(body.otpauthUri.startsWith("otpauth://totp/") && body.otpauthUri.includes(`secret=${body.secret}`) && body.otpauthUri.includes(encodeURIComponent(email)));
    const [row] = await sqlClient`select secret_ciphertext, confirmed_at from mfa_factors where user_id=${user}`;
    assert.equal(row!.confirmed_at, null);
    assert.ok(!Buffer.from(row!.secret_ciphertext).includes(secret) && !Buffer.from(row!.secret_ciphertext).toString("latin1").includes(body.secret), "the secret is not stored in the clear");
    assert.deepEqual(await status(), { enabled: false, pending: true, recoveryCodesRemaining: 0, available: true });
    assert.equal((await signIn({})).status, 200, "a pending enrolment does not lock the account out");
    // Starting again replaces the pending secret; the first one stops working.
    const again = await (await mfa("/enroll", "POST", { currentPassword: password })).json() as { secret: string };
    assert.notEqual(again.secret, body.secret);
    assert.equal((await mfa("/confirm", "POST", { code: code() })).status, 400, "code of the replaced secret");
    secret = base32Decode(again.secret)!;
    await resetBudget();
  });

  it("confirms with a valid code, issues ten recovery codes once and refuses a second enrolment", async () => {
    assert.equal((await mfa("/confirm", "POST", { code: "000000" })).status, 400);
    assert.equal((await mfa("/confirm", "POST", { code: "abc" })).status, 400);
    const confirmed = await mfa("/confirm", "POST", { code: code() });
    assert.equal(confirmed.status, 200);
    recoveryCodes = (await confirmed.json() as { recoveryCodes: string[] }).recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);
    assert.ok(recoveryCodes.every(item => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(item)));
    const stored = await sqlClient`select encode(code_hash,'hex') as hash from mfa_recovery_codes where user_id=${user}`;
    assert.equal(stored.length, 10);
    assert.ok(!JSON.stringify(stored).includes(recoveryCodes[0]!.replace("-", "")), "recovery codes are stored only as hashes");
    assert.deepEqual(await status(), { enabled: true, pending: false, recoveryCodesRemaining: 10, available: true });
    assert.equal((await mfa("/enroll", "POST", { currentPassword: password })).status, 409);
    assert.equal((await mfa("/confirm", "POST", { code: code() })).status, 409);
    await resetBudget();
  });

  it("requires the second factor at login, after the password, and never accepts a code twice", async () => {
    const wrongPassword = await call(server.url, "/auth/login", { method: "POST", body: { email, password: "senha errada", code: code(1) } });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(await wrongPassword.json(), { error: "E-mail ou senha inválidos" }, "a wrong password never reveals that a factor exists");
    const missing = await signIn({});
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: MFA_REQUIRED_MESSAGE });
    assert.equal(CLIENT_MESSAGE, MFA_REQUIRED_MESSAGE);
    assert.equal((await signIn({ code: "000000" })).status, 401);
    // Derive the codes from the stored step, so a 30-second boundary cannot change the outcome.
    const last = Number((await sqlClient`select last_used_step from mfa_factors where user_id=${user}`)[0]!.last_used_step);
    assert.equal((await signIn({ code: totpCode(secret, last) })).status, 401, "the step confirmed at enrolment is already spent");
    const next = totpCode(secret, last + 1);
    const accepted = await signIn({ code: next });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as { user: { id: string } }).user.id, user);
    assert.equal((await signIn({ code: next })).status, 401, "replay of an accepted code");
    assert.equal((await signIn({ code: totpCode(secret, last) })).status, 401, "an older step is never accepted after a newer one");
    for (const malformed of ["12345", "1234 56", "<script>", "x".repeat(17)]) assert.equal((await signIn({ code: malformed })).status, 400, malformed);
    assert.equal((await sqlClient`select count(*)::int as count from sessions where user_id=${user} and revoked_at is null`)[0]!.count, 3, "enrolment, pending and one verified login");
    await resetBudget();
  });

  it("accepts each recovery code once, in either spelling, including concurrently", async () => {
    const [first, second] = recoveryCodes;
    assert.equal((await signIn({ code: first!.toLowerCase().replace("-", "") })).status, 200);
    assert.equal((await signIn({ code: first })).status, 401);
    const race = await Promise.all([signIn({ code: second }), signIn({ code: second })]);
    assert.deepEqual(race.map(response => response.status).sort(), [200, 401]);
    assert.equal((await signIn({ code: "AAAAA-AAAAA" })).status, 401);
    assert.equal((await status()).recoveryCodesRemaining, 8);
    const peerLogin = await call(server.url, "/auth/login", { method: "POST", body: { email: `${peer}@example.invalid`, password } });
    assert.equal(peerLogin.status, 200, "another account is not affected");
    const peerToken = (await peerLogin.json() as { accessToken: string }).accessToken;
    assert.deepEqual(await (await mfa("", "GET", undefined, peerToken)).json(), { enabled: false, pending: false, recoveryCodesRemaining: 0, available: true });
    await resetBudget();
  });

  it("turns the factor off only with the password and a valid code", async () => {
    assert.equal((await mfa("/disable", "POST", { currentPassword: "senha errada", code: recoveryCodes[2] })).status, 400);
    assert.equal((await mfa("/disable", "POST", { currentPassword: password })).status, 401);
    assert.equal((await mfa("/disable", "POST", { currentPassword: password, code: "000000" })).status, 401);
    assert.equal((await status()).enabled, true);
    assert.equal((await mfa("/disable", "POST", { currentPassword: password, code: recoveryCodes[3] })).status, 204);
    assert.deepEqual(await status(), { enabled: false, pending: false, recoveryCodesRemaining: 0, available: true });
    assert.equal((await sqlClient`select 1 from mfa_factors where user_id=${user}`).length + (await sqlClient`select 1 from mfa_recovery_codes where user_id=${user}`).length, 0);
    assert.equal((await signIn({})).status, 200);
    assert.equal((await mfa("/disable", "POST", { currentPassword: password })).status, 204, "disabling twice is not an error");
    assert.equal((await mfa("")).status, 200);
    assert.equal((await call(server.url, "/auth/mfa")).status, 401, "every MFA route needs a session");
  });

  it("keeps the factor tables away from the business and broker roles", async () => {
    for (const client of [appSqlClient, brokerAuthSqlClient]) {
      await assert.rejects(client`select user_id from mfa_factors`, { code: "42501" });
      await assert.rejects(client`select user_id from mfa_recovery_codes`, { code: "42501" });
      await assert.rejects(client`delete from mfa_factors`, { code: "42501" });
    }
    await assert.rejects(identitySqlClient`update mfa_factors set secret_ciphertext=secret_ciphertext where false`, { code: "42501" });
    await assert.rejects(identitySqlClient`update mfa_recovery_codes set code_hash=code_hash where false`, { code: "42501" });
    await assert.rejects(identitySqlClient`update mfa_factors set user_id=user_id where false`, { code: "42501" });
  });
});
