import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb, withUserContext } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { hashPassword } from "../src/auth/passwords.js";
import { loginBudgetKeys } from "../src/auth/login-budget-keys.js";
import { config } from "../src/config.js";
import { pgErrorCode } from "../src/http/errors.js";
import { setMailTransport, type Mail } from "../src/mail/mailer.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

const strongPassword = "Senha convidada 2026 segura";

describe("resident invitations", () => {
  const suffix = randomUUID(), org = `invite-org-${suffix}`;
  const building = `invite-a-${suffix}`, other = `invite-b-${suffix}`;
  const manager = `invite-manager-${suffix}`, resident = `invite-resident-${suffix}`, existing = `invite-existing-${suffix}`;
  const address = (label: string) => `invite-${label}-${suffix}@example.invalid`;
  let server: TestServer, managerToken: string, residentToken: string, unitId: string, existingHash: string;

  /** The shared network budget may be exhausted by neighbouring suites; honour it instead of weakening it. */
  async function open(path: string, body: unknown): Promise<Response> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await call(server.url, `/auth/invitations/${path}`, { method: "POST", body });
      if (response.status !== 429) return response;
      await delay(Math.min(Number(response.headers.get("retry-after") ?? "1"), 5) * 1000);
    }
    throw new Error("Invitation budget did not recover");
  }
  const tenancy = (path: string, method = "GET", body?: unknown, token = managerToken) => call(server.url, `/v1/tenancy${path}`, { method, body, token });
  async function invite(label: string, extra: object = {}, token = managerToken) {
    const response = await tenancy("/invitations", "POST", { buildingId: building, name: `Convidado ${label}`, email: address(label), ...extra }, token);
    const data = await response.json() as { invitation: { id: string; status: string; email: string }; token: string };
    assert.equal(response.status, 201, JSON.stringify(data));
    return data;
  }
  const stored = async (id: string) => (await sqlClient`select * from invitations where id=${id}`)[0]!;
  const account = async (label: string) => (await sqlClient`select id,name,password_hash,is_platform_admin,active from users where email=${address(label)}`)[0];

  before(async () => {
    existingHash = await hashPassword("predioon123");
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Invitation fixture',${org})`;
    for (const id of [building, other]) await sqlClient`insert into buildings(id,organization_id,name,code) values(${id},${org},${`Condomínio ${id}`},${id})`;
    for (const id of [manager, resident]) await sqlClient`insert into users(id,name,email,password_hash) values(${id},${id},${`${id}@test.local`},${existingHash})`;
    await sqlClient`insert into users(id,name,email,password_hash) values(${existing},'Conta existente',${address("existing")},${existingHash})`;
    await sqlClient`insert into memberships(user_id,building_id,role) values (${manager},${building},'BUILDING_ADMIN'), (${resident},${building},'RESIDENT')`;
    unitId = (await sqlClient`insert into units(building_id,code) values(${building},'101') returning id`)[0]!.id;
    server = await startTestServer();
    [managerToken, residentToken] = await Promise.all([manager, resident].map(async id => (await login(server.url, `${id}@test.local`)).accessToken));
  });
  after(async () => {
    await server?.close();
    await sqlClient`delete from audit_logs where building_id in (${building},${other})`;
    const accounts = await sqlClient`select email from users where email like ${`invite-%-${suffix}@example.invalid`} or id in (${manager},${resident})`;
    for (const row of accounts) {
      const key = loginBudgetKeys(config.authRateLimitKey, row.email, "127.0.0.1").account;
      await sqlClient`delete from auth_login_buckets where scope='account' and key_hash=${key}`;
    }
    await sqlClient`delete from buildings where id in (${building},${other})`;
    await sqlClient`delete from users where email like ${`invite-%-${suffix}@example.invalid`} or id in (${manager},${resident})`;
    await sqlClient`delete from organizations where id=${org}`;
    await closeAppDb(); await sqlClient.end();
  });

  it("stores only the hash, lists without secrets and audits the inviter", async () => {
    const { invitation, token } = await invite("stored", { unitId, kind: "OCCUPANT" });
    assert.equal(invitation.status, "PENDING");
    for (const key of ["createdAt", "expiresAt"] as const) {
      const value = (invitation as unknown as Record<string, string>)[key]!;
      assert.equal(new Date(value).toISOString(), value, `${key} is strict ISO-8601`);
    }
    assert.deepEqual(Object.keys(invitation).sort(), ["buildingId", "createdAt", "email", "expiresAt", "id", "kind", "name", "status", "unitId"]);
    const row = await stored(invitation.id);
    assert.deepEqual(Buffer.from(row.token_hash), createHash("sha256").update(Buffer.from(token, "base64url")).digest());
    assert.ok(!JSON.stringify({ ...row, token_hash: null }).includes(token));
    assert.equal(row.invited_by, manager);
    const days = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000;
    assert.ok(days > 6.99 && days <= 7);
    const list = await tenancy(`/invitations?buildingId=${building}`);
    const body = await list.text();
    assert.equal(list.status, 200);
    assert.ok(body.includes(invitation.id) && !body.includes(token) && !/token|hash/i.test(body));
    const audit = await sqlClient`select user_id,building_id from audit_logs where resource_id=${invitation.id} and action='INVITATION_CREATED'`;
    assert.deepEqual(audit.map(entry => ({ ...entry })), [{ user_id: manager, building_id: building }]);
  });

  it("also e-mails the link only when the resident portal and a provider are configured", async () => {
    const settings = config as { residentPortalUrl: string | null }, outbox: Mail[] = [];
    assert.equal((await invite("unmailed") as unknown as { emailRequested: boolean }).emailRequested, false);
    setMailTransport(async mail => { outbox.push(mail); return { sent: true }; });
    try {
      assert.equal((await invite("portalless") as unknown as { emailRequested: boolean }).emailRequested, false, "no portal, no link to send");
      settings.residentPortalUrl = "https://morador.example";
      const { token, emailRequested } = await invite("mailed") as unknown as { token: string; emailRequested: boolean };
      assert.equal(emailRequested, true);
      for (let attempt = 0; attempt < 100 && !outbox.length; attempt++) await delay(20);
      assert.deepEqual(outbox.map(mail => mail.to), [address("mailed")]);
      const url = `https://morador.example/convite#${token}`;
      assert.ok(outbox[0]!.text.includes(url) && outbox[0]!.html.includes(`href="${url}"`) && outbox[0]!.text.includes("Convidado mailed"));
      // A provider failure never fails the invitation: the code is still handed over on screen.
      setMailTransport(async () => { throw new Error("provider down"); });
      assert.equal((await invite("provider-down") as unknown as { emailRequested: boolean }).emailRequested, true);
    } finally { setMailTransport(null); settings.residentPortalUrl = null; }
  });

  it("previews a valid secret and treats every other value alike", async () => {
    const { token } = await invite("preview");
    const response = await open("preview", { token });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual({ ...body, expiresAt: typeof body.expiresAt }, { email: address("preview"), name: "Convidado preview",
      buildingName: `Condomínio ${building}`, accountExists: false, expiresAt: "string" });
    for (const bad of [randomBytes(32).toString("base64url"), token.slice(0, -1), `${token}=`, "x", randomBytes(31).toString("base64url")]) {
      const refused = await open("preview", { token: bad });
      assert.equal(refused.status, 404, bad);
      assert.deepEqual(await refused.json(), { error: "Convite inválido, expirado ou já utilizado" });
    }
    assert.equal((await open("preview", {})).status, 400);
    assert.equal((await open("preview", { token, email: address("preview") })).status, 400);
  });

  it("creates the account with the invited identity, grants only RESIDENT and is single-use", async () => {
    const { invitation, token } = await invite("fresh", { unitId, kind: "OWNER" });
    assert.equal((await open("accept", { token, password: "curta" })).status, 400);
    assert.equal(await account("fresh"), undefined, "a refused password creates nothing");
    assert.equal((await open("accept", { token, password: strongPassword, name: "Outro nome" })).status, 400);
    const outcomes = await Promise.all([open("accept", { token, password: strongPassword }), open("accept", { token, password: `${strongPassword} 2` })]);
    assert.deepEqual(outcomes.map(response => response.status).sort(), [204, 404]);
    const created = (await account("fresh"))!;
    assert.deepEqual({ name: created.name, admin: created.is_platform_admin, active: created.active }, { name: "Convidado fresh", admin: false, active: true });
    assert.match(created.password_hash, /^\$argon2id\$/);
    const winner = outcomes[0]!.status === 204 ? strongPassword : `${strongPassword} 2`;
    const session = await login(server.url, address("fresh"), winner);
    assert.equal(session.user.id, created.id);
    const authorization = await call(server.url, `/v1/authorization?buildingId=${building}`, { token: session.accessToken });
    assert.equal(authorization.status, 200);
    const { capabilities } = await authorization.json() as { capabilities: string[] };
    assert.ok(capabilities.length > 0 && !capabilities.some(capability => /:manage$|^memberships:|^audit:/.test(capability)), capabilities.join());
    assert.equal((await call(server.url, `/v1/authorization?buildingId=${other}`, { token: session.accessToken })).status, 403);
    const units = await (await call(server.url, `/v1/tenancy/units?buildingId=${building}`, { token: session.accessToken })).json() as { items: Array<{ id: string }> };
    assert.deepEqual(units.items.map(unit => unit.id), [unitId]);
    const bindings = await sqlClient`select role_key,granted_by,building_id,resource_type,active from role_bindings where user_id=${created.id}`;
    assert.deepEqual(bindings.map(row => ({ ...row })), [{ role_key: "RESIDENT", granted_by: manager, building_id: building, resource_type: null, active: true }]);
    assert.deepEqual((await sqlClient`select kind,unit_id from unit_memberships where user_id=${created.id}`).map(row => ({ ...row })), [{ kind: "OWNER", unit_id: unitId }]);
    assert.equal((await sqlClient`select 1 from memberships where user_id=${created.id}`).length, 0);
    const row = await stored(invitation.id);
    assert.equal(row.accepted_user_id, created.id);
    assert.deepEqual((await sqlClient`select user_id from audit_logs where resource_id=${invitation.id} and action='INVITATION_ACCEPTED'`).map(entry => entry.user_id), [created.id]);
    assert.equal((await open("preview", { token })).status, 404);
    assert.equal((await open("accept", { token, password: strongPassword })).status, 404);
    const listed = await (await tenancy(`/invitations?buildingId=${building}`)).json() as { items: Array<{ id: string; status: string }> };
    assert.equal(listed.items.find(item => item.id === invitation.id)?.status, "ACCEPTED");
  });

  it("links an existing account only after its own password and never replaces that credential", async () => {
    const { token } = await invite("existing");
    assert.equal((await (await open("preview", { token })).json() as { accountExists: boolean }).accountExists, true);
    const wrong = await open("accept", { token, password: strongPassword });
    assert.equal(wrong.status, 401);
    assert.equal((await sqlClient`select 1 from role_bindings where user_id=${existing}`).length, 0);
    assert.equal((await open("accept", { token, password: "predioon123" })).status, 204);
    const row = (await account("existing"))!;
    assert.equal(row.password_hash, existingHash);
    assert.equal(row.name, "Conta existente", "the invited display name does not rename an existing account");
    assert.deepEqual((await sqlClient`select role_key,building_id from role_bindings where user_id=${existing}`).map(entry => ({ ...entry })), [{ role_key: "RESIDENT", building_id: building }]);
    assert.equal((await sqlClient`select count(*)::int as count from users where email=${address("existing")}`)[0]!.count, 1);
  });

  it("replaces an open invitation on reissue and revokes on request", async () => {
    const first = await invite("reissue");
    const second = await invite("reissue");
    assert.notEqual(first.token, second.token);
    assert.equal((await open("preview", { token: first.token })).status, 404);
    assert.equal((await open("preview", { token: second.token })).status, 200);
    assert.equal((await sqlClient`select 1 from audit_logs where resource_id=${first.invitation.id} and action='INVITATION_REVOKED' and user_id=${manager}`).length, 1);
    assert.equal((await tenancy(`/invitations/${second.invitation.id}`, "DELETE", undefined, residentToken)).status, 404);
    assert.equal((await tenancy(`/invitations/${second.invitation.id}`, "DELETE")).status, 204);
    assert.equal((await tenancy(`/invitations/${second.invitation.id}`, "DELETE")).status, 204, "revoking twice is not an error");
    assert.equal((await sqlClient`select 1 from audit_logs where resource_id=${second.invitation.id} and action='INVITATION_REVOKED'`).length, 1);
    assert.equal((await open("accept", { token: second.token, password: strongPassword })).status, 404);
    assert.equal(await account("reissue"), undefined);
    assert.equal((await tenancy(`/invitations/${randomUUID()}`, "DELETE")).status, 404);
    assert.equal((await tenancy("/invitations/not-a-uuid", "DELETE")).status, 404);
  });

  it("rejects invitations outside the manager's authority and malformed requests", async () => {
    const before = (await sqlClient`select count(*)::int as count from invitations`)[0]!.count;
    const body = { buildingId: building, name: "Convidado", email: address("refused") };
    assert.equal((await tenancy("/invitations", "POST", body, residentToken)).status, 403);
    assert.equal((await tenancy("/invitations", "POST", { ...body, buildingId: other })).status, 403);
    assert.equal((await tenancy(`/invitations?buildingId=${building}`, "GET", undefined, residentToken)).status, 403);
    const [foreignUnit] = await sqlClient`insert into units(building_id,code) values(${other},'901') returning id`;
    assert.equal((await tenancy("/invitations", "POST", { ...body, unitId: foreignUnit!.id, kind: "OCCUPANT" })).status, 400);
    for (const invalid of [{ ...body, email: "sem-arroba" }, { ...body, name: " " }, { ...body, unitId }, { ...body, kind: "OWNER" },
      { ...body, roleKey: "BUILDING_ADMIN" }, { ...body, isPlatformAdmin: true }, { ...body, unitId, kind: "ADMIN" }]) {
      assert.equal((await tenancy("/invitations", "POST", invalid)).status, 400, JSON.stringify(invalid));
    }
    assert.equal((await sqlClient`select count(*)::int as count from invitations`)[0]!.count, before);
  });

  it("refuses acceptance when the invitation expired, the unit is inactive or the inviter lost authority", async () => {
    const expired = await invite("expired");
    await sqlClient`update invitations set created_at=clock_timestamp()-interval '8 days', expires_at=clock_timestamp()-interval '1 second' where id=${expired.invitation.id}`;
    assert.equal((await open("preview", { token: expired.token })).status, 404);
    assert.equal((await open("accept", { token: expired.token, password: strongPassword })).status, 404);
    const listed = await (await tenancy(`/invitations?buildingId=${building}`)).json() as { items: Array<{ id: string; status: string }> };
    assert.equal(listed.items.find(item => item.id === expired.invitation.id)?.status, "EXPIRED");

    const unit = await invite("unit", { unitId, kind: "OCCUPANT" });
    await sqlClient`update units set active=false where id=${unitId}`;
    try { assert.equal((await open("accept", { token: unit.token, password: strongPassword })).status, 404); }
    finally { await sqlClient`update units set active=true where id=${unitId}`; }

    const orphan = await invite("orphan");
    await sqlClient`update memberships set active=false where user_id=${manager} and building_id=${building}`;
    try { assert.equal((await open("accept", { token: orphan.token, password: strongPassword })).status, 404); }
    finally { await sqlClient`update memberships set active=true where user_id=${manager} and building_id=${building}`; }
    for (const label of ["expired", "unit", "orphan"]) assert.equal(await account(label), undefined, label);
    assert.equal((await open("accept", { token: orphan.token, password: strongPassword })).status, 204, "authority restored before expiry");
    assert.equal((await open("accept", { token: unit.token, password: strongPassword })).status, 204);
  });

  it("keeps the secret, the outcome and both helpers behind the database boundary", async () => {
    const { invitation } = await invite("boundary");
    const as = <T>(userId: string, role: "BUILDING_ADMIN" | "RESIDENT", run: Parameters<typeof withUserContext<T>>[1]) => withUserContext({ userId, role }, run);
    const denied = (promise: Promise<unknown>) => assert.rejects(promise, error => pgErrorCode(error) === "42501");
    await denied(as(manager, "BUILDING_ADMIN", tx => tx.execute(sql`select token_hash from invitations where id=${invitation.id}`)));
    await denied(as(manager, "BUILDING_ADMIN", tx => tx.execute(sql`select * from invitations where id=${invitation.id}`)));
    await denied(as(manager, "BUILDING_ADMIN", tx => tx.execute(sql`update invitations set accepted_at=clock_timestamp() where id=${invitation.id}`)));
    await denied(as(manager, "BUILDING_ADMIN", tx => tx.execute(sql`update invitations set email='other@example.invalid' where id=${invitation.id}`)));
    await denied(as(manager, "BUILDING_ADMIN", tx => tx.execute(sql`delete from invitations where id=${invitation.id}`)));
    const forged = (actor: string, role: "BUILDING_ADMIN" | "RESIDENT", target: string, inviter: string) => as(actor, role, tx => tx.execute(
      sql`insert into invitations(building_id,email,name,token_hash,invited_by,expires_at) values(${target},${address("forged")},'Forged',${randomBytes(32)},${inviter},clock_timestamp()+interval '1 day')`));
    await denied(forged(resident, "RESIDENT", building, resident));
    await denied(forged(manager, "BUILDING_ADMIN", other, manager));
    await denied(forged(manager, "BUILDING_ADMIN", building, resident));
    assert.equal((await as(resident, "RESIDENT", tx => tx.execute(sql`select id from invitations`))).length, 0);
    assert.equal((await appSqlClient`select id from invitations`).length, 0, "pool outside an actor context sees nothing");
    for (const client of [appSqlClient, brokerAuthSqlClient]) {
      await assert.rejects(client`select * from public.identity_invitation_preview(${randomBytes(32)})`, { code: "42501" });
      await assert.rejects(client`select public.identity_accept_invitation(${randomBytes(32)},'x',null,null)`, { code: "42501" });
    }
    await assert.rejects(identitySqlClient`select id from invitations`, { code: "42501" });
    await assert.rejects(identitySqlClient`select public.identity_accept_invitation(${randomBytes(32)},'usr_x','plain-text',null)`, { code: "22023" });
    await assert.rejects(identitySqlClient`select public.identity_accept_invitation(${randomBytes(32)},'usr_x',${existingHash},${existing})`, { code: "22023" });
    assert.equal((await identitySqlClient`select current_setting('app.user_id', true) as actor`)[0]!.actor ?? "", "", "no actor leaks from the helper");
  });
});
