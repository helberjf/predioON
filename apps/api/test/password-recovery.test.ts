import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
import { setMailTransport, type Mail } from "../src/mail/mailer.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

const INVALID = { error: "Link inválido, expirado ou já utilizado. Solicite um novo." };
const strongPassword = "Senha recuperada 2026 segura";

describe("password recovery by e-mailed link", () => {
  const suffix = randomUUID(), original = "predioon123";
  const id = (label: string) => `recovery-${label}-${suffix}`, address = (label: string) => `${id(label)}@example.invalid`;
  const labels = ["main", "inactive", "peer", "mfa", "budget", "sentinel"];
  const origin = config.corsOrigins[0]!, settings = config as { passwordResetUrl: string | null };
  const outbox: Mail[] = [];
  let server: TestServer;

  /** The network budget is shared with neighbouring suites; honour it instead of weakening it. */
  async function patient(send: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await send();
      if (response.status !== 429) return response;
      await delay(Math.min(Number(response.headers.get("retry-after") ?? "1"), 5) * 1000);
    }
    throw new Error("Budget did not recover");
  }
  const forgotOnce = (email: unknown, headers: Record<string, string> = { Origin: origin }) => fetch(`${server.url}/auth/password/forgot`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ email }) });
  const forgot = (email: unknown, headers?: Record<string, string>) => patient(() => forgotOnce(email, headers));
  const reset = (token: string, newPassword: string) => patient(() => call(server.url, "/auth/password/reset", { method: "POST", body: { token, newPassword } }));
  const signIn = (label: string, password: string, extra: object = {}) => patient(() => call(server.url, "/auth/login", { method: "POST", body: { email: address(label), password, ...extra } }));
  const rows = (label: string) => sqlClient`select * from password_resets where user_id=${id(label)} order by created_at`;
  /** The request is answered before the message is produced; wait for it to reach the transport. */
  async function mailTo(label: string, after = 0): Promise<Mail> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = outbox.filter(mail => mail.to === address(label))[after];
      if (found) return found;
      await delay(50);
    }
    throw new Error(`No message for ${label}`);
  }
  const tokenIn = (mail: Mail) => /#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(mail.text)![1]!;
  /** A known account asked afterwards proves the earlier requests were already processed. */
  async function settled() {
    const before = outbox.filter(mail => mail.to === address("sentinel")).length;
    await sqlClient`update password_resets set created_at=created_at-interval '5 minutes', expires_at=expires_at-interval '5 minutes' where user_id=${id("sentinel")}`;
    assert.equal((await forgot(address("sentinel"))).status, 204);
    await mailTo("sentinel", before);
  }
  /** Moves the pending link out of the two-minute window in which a new one is refused. */
  const age = (label: string) => sqlClient`update password_resets set created_at=created_at-interval '5 minutes', expires_at=expires_at-interval '5 minutes' where user_id=${id(label)} and used_at is null`;
  const clearBudget = async () => {
    for (const label of labels) for (const key of [address(label), `password-forgot:${address(label)}`]) {
      await sqlClient`delete from auth_login_buckets where scope='account' and key_hash=${loginBudgetKeys(config.authRateLimitKey, key, "127.0.0.1").account}`;
    }
  };

  before(async () => {
    const hash = await hashPassword(original);
    for (const label of labels) await sqlClient`insert into users(id,name,email,password_hash,active) values(${id(label)},${`Pessoa ${label}`},${address(label)},${hash},${label !== "inactive"})`;
    setMailTransport(async mail => { outbox.push(mail); return { sent: true }; });
    server = await startTestServer();
  });
  after(async () => {
    setMailTransport(null);
    settings.passwordResetUrl = null;
    await server?.close();
    await clearBudget();
    await sqlClient`delete from users where id in ${sqlClient(labels.map(id))}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("answers alike for unknown, inactive and known addresses and e-mails only a real account", async () => {
    for (const email of [`ninguem-${suffix}@example.invalid`, address("inactive"), address("main").toUpperCase()]) {
      const response = await forgot(email);
      assert.equal(response.status, 204, email);
      assert.equal(await response.text(), "");
    }
    for (const bad of ["sem-arroba", "", 7, null]) assert.equal((await forgot(bad)).status, 400);
    assert.equal((await fetch(`${server.url}/auth/password/forgot`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address("main"), portal: "https://evil.example" }) })).status, 400, "no field chooses the destination");
    const mail = await mailTo("main");
    await settled();
    assert.deepEqual(outbox.map(sent => sent.to).filter(to => to !== address("sentinel")), [address("main")]);
    assert.equal((await rows("inactive")).length, 0);

    const token = tokenIn(mail), url = `${origin}/redefinir-senha#${token}`;
    assert.ok(mail.text.includes(url) && mail.html.includes(`href="${url}"`) && mail.text.includes("Pessoa main"));
    assert.match(mail.subject, /Redefinição de senha/);
    const [row] = await rows("main");
    assert.deepEqual(Buffer.from(row!.token_hash), createHash("sha256").update(Buffer.from(token, "base64url")).digest());
    assert.ok(!JSON.stringify({ ...row, token_hash: null }).includes(token), "only the hash is stored");
    const minutes = (new Date(row!.expires_at).getTime() - new Date(row!.created_at).getTime()) / 60_000;
    assert.ok(minutes > 59.9 && minutes <= 60);
    assert.equal(row!.used_at, null);
  });

  it("never lets the request choose where the link points", async () => {
    await age("peer");
    assert.equal((await forgot(address("peer"), { Origin: "https://evil.example" })).status, 204);
    assert.equal((await forgot(address("peer"), {})).status, 204);
    await settled();
    assert.equal(outbox.filter(mail => mail.to === address("peer")).length, 0, "without a configured portal nothing is sent");
    assert.equal((await rows("peer")).length, 0);

    settings.passwordResetUrl = "https://portal.example";
    assert.equal((await forgot(address("peer"), { Origin: "https://evil.example" })).status, 204);
    const mail = await mailTo("peer");
    assert.ok(mail.text.includes(`https://portal.example/redefinir-senha#${tokenIn(mail)}`) && !mail.text.includes("evil") && !mail.html.includes("evil"));
    settings.passwordResetUrl = null;
  });

  it("does not flood an inbox and keeps only the most recent link valid", async () => {
    const first = tokenIn(await mailTo("main"));
    assert.equal((await forgot(address("main"))).status, 204);
    await settled();
    assert.equal(outbox.filter(mail => mail.to === address("main")).length, 1, "a second request inside two minutes sends nothing");
    await age("main");
    assert.equal((await forgot(address("main"))).status, 204);
    const second = tokenIn(await mailTo("main", 1));
    assert.notEqual(second, first);
    const stale = await reset(first, strongPassword);
    assert.equal(stale.status, 400);
    assert.deepEqual(await stale.json(), INVALID);
    assert.equal((await signIn("main", original)).status, 200, "a refused link changes nothing");
    assert.deepEqual((await rows("main")).map(row => row.used_at === null), [false, true]);
  });

  it("replaces the password once, ends every session and refuses reuse", async () => {
    const token = tokenIn(await mailTo("main", 1));
    const sessions = [await login(server.url, address("main"), original), await login(server.url, address("main"), original)];
    for (const bad of [randomBytes(32).toString("base64url"), token.slice(0, -1), `${token}=`, "x"]) {
      const refused = await reset(bad, strongPassword);
      assert.equal(refused.status, 400, bad);
      assert.deepEqual(await refused.json(), INVALID);
    }
    assert.equal((await reset(token, "curta")).status, 400);
    assert.equal((await call(server.url, "/auth/password/reset", { method: "POST", body: { token, newPassword: strongPassword, email: address("peer") } })).status, 400);
    assert.equal((await rows("main"))[1]!.used_at, null, "a refused password does not spend the link");

    const outcomes = await Promise.all([reset(token, strongPassword), reset(token, `${strongPassword} 2`)]);
    assert.deepEqual(outcomes.map(response => response.status).sort(), [204, 400]);
    const winner = outcomes[0]!.status === 204 ? strongPassword : `${strongPassword} 2`;
    assert.equal((await signIn("main", original)).status, 401);
    assert.equal((await signIn("main", winner)).status, 200);
    for (const session of sessions) {
      assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } })).status, 401);
      assert.equal((await call(server.url, "/auth/me", { token: session.accessToken })).status, 401, "open sessions end at once");
    }
    const revoked = await sqlClient`select distinct revoked_reason from sessions where user_id=${id("main")} and revoked_at is not null and revoked_reason='PASSWORD_RESET'`;
    assert.equal(revoked.length, 1);
    assert.equal((await reset(token, `${strongPassword} 3`)).status, 400, "single use");
    assert.match((await sqlClient`select password_hash from users where id=${id("main")}`)[0]!.password_hash, /^\$argon2id\$/);
    assert.equal((await sqlClient`select 1 from users where id=${id("peer")} and password_hash=(select password_hash from users where id=${id("inactive")})`).length, 1, "no other account is touched");
  });

  it("refuses an expired link and a link of an account deactivated meanwhile", async () => {
    await age("peer");
    assert.equal((await forgot(address("peer"))).status, 204);
    const expired = tokenIn(await mailTo("peer", 1));
    await sqlClient`update password_resets set created_at=created_at-interval '61 minutes', expires_at=expires_at-interval '61 minutes' where user_id=${id("peer")} and used_at is null`;
    assert.equal((await reset(expired, strongPassword)).status, 400);
    assert.equal((await forgot(address("peer"))).status, 204);
    const token = tokenIn(await mailTo("peer", 2));
    await sqlClient`update users set active=false where id=${id("peer")}`;
    assert.equal((await reset(token, strongPassword)).status, 400);
    await sqlClient`update users set active=true where id=${id("peer")}`;
    assert.equal((await signIn("peer", original)).status, 200);
    assert.equal((await reset(token, strongPassword)).status, 204, "the same link works again once the account is active and inside its window");
  });

  it("keeps two-step verification in place after a reset", async () => {
    const session = await login(server.url, address("mfa"), original);
    // Enrolment spends the same network admission as sign-in, which earlier suites may have drained;
    // the body is rebuilt per attempt so a retried confirmation carries a current code.
    const mfa = (path: string, body: () => unknown) => patient(() => call(server.url, `/auth/mfa${path}`, { method: "POST", body: body(), token: session.accessToken }));
    const enrolment = await mfa("/enroll", () => ({ currentPassword: original }));
    assert.equal(enrolment.status, 200);
    const secret = base32Decode((await enrolment.json() as { secret: string }).secret)!;
    assert.equal((await mfa("/confirm", () => ({ code: totpCode(secret, totpStep(Date.now())) }))).status, 200);

    assert.equal((await forgot(address("mfa"))).status, 204);
    assert.equal((await reset(tokenIn(await mailTo("mfa")), strongPassword)).status, 204);
    const withoutCode = await signIn("mfa", strongPassword);
    assert.equal(withoutCode.status, 401);
    assert.deepEqual(await withoutCode.json(), { error: MFA_REQUIRED_MESSAGE });
    // The confirmation consumed the current step; the next one is still inside the accepted window.
    const [factor] = await sqlClient`select last_used_step from mfa_factors where user_id=${id("mfa")}`;
    assert.equal((await signIn("mfa", strongPassword, { code: totpCode(secret, Number(factor!.last_used_step) + 1) })).status, 200);
  });

  it("limits requests per address without spending the sign-in budget", async () => {
    await clearBudget();
    // Let the shared network budget (5 admissions per second) refill, so only the address budget is measured.
    await delay(6000);
    for (let attempt = 0; attempt < 20; attempt++) assert.equal((await forgotOnce(address("budget"))).status, 204);
    const limited = await forgotOnce(address("budget"));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 5, "the wait is the address budget's, far longer than the network's");
    assert.equal((await signIn("budget", original)).status, 200, "the account can still sign in");
    await settled();
    assert.equal(outbox.filter(mail => mail.to === address("budget")).length, 1);
  });

  it("keeps the table and its helpers away from every other runtime role", async () => {
    for (const client of [appSqlClient, identitySqlClient, brokerAuthSqlClient]) {
      await assert.rejects(client`select id from password_resets`, { code: "42501" });
      await assert.rejects(client`delete from password_resets`, { code: "42501" });
    }
    const candidate = randomBytes(32), hash = await hashPassword(strongPassword);
    for (const client of [appSqlClient, brokerAuthSqlClient]) {
      await assert.rejects(client`select public.identity_issue_password_reset(${id("peer")},${candidate},interval '1 hour')`, { code: "42501" });
      await assert.rejects(client`select public.identity_reset_password(${candidate},${hash})`, { code: "42501" });
    }
    await assert.rejects(identitySqlClient`select public.identity_issue_password_reset(${id("peer")},${candidate},interval '25 hours')`, { code: "22023" });
    await assert.rejects(identitySqlClient`select public.identity_issue_password_reset(${id("peer")},${randomBytes(31)},interval '1 hour')`, { code: "22023" });
    await assert.rejects(identitySqlClient`select public.identity_reset_password(${candidate},'texto puro')`, { code: "22023" });
    assert.equal((await identitySqlClient`select public.identity_reset_password(${candidate},${hash}) as changed`)[0]!.changed, false);
  });
});
