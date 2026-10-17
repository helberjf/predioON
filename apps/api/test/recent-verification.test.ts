import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb } from "@predioon/db/runtime";
import { hashPassword } from "../src/auth/passwords.js";
import { base32Decode, totpCode, totpStep } from "../src/auth/totp.js";
import { call, login, startTestServer, type TestServer } from "./helpers.js";

// 055: privileged actions need the password (and the second factor) proved recently on this session.
describe("recent verification for privileged actions (055)", () => {
  const suffix = `v055-${randomUUID().slice(0, 8)}`, org = `${suffix}-org`, building = `${suffix}-a`, gateway = `${suffix}-gw`;
  const id = { admin: `${suffix}-admin`, resident: `${suffix}-resident`, staff: `${suffix}-staff`, mfa: `${suffix}-mfa`, outsider: `${suffix}-outsider` };
  const email = (user: string) => `${user}@verify055.test`, password = "predioon123";
  let server: TestServer;

  before(async () => {
    const hash = await hashPassword(password);
    await sqlClient`insert into organizations(id,name,slug) values(${org},'Verify 055',${org})`;
    await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${org},'A','A')`;
    for (const user of Object.values(id)) await sqlClient`insert into users(id,email,name,password_hash) values(${user},${email(user)},${user},${hash})`;
    await sqlClient`update users set is_platform_admin=true where id=${id.admin}`;
    await sqlClient`insert into role_bindings(user_id,building_id,role_key) values(${id.admin},${building},'BUILDING_ADMIN'),(${id.mfa},${building},'BUILDING_ADMIN')`;
    await sqlClient`insert into memberships(user_id,building_id,role) values(${id.resident},${building},'RESIDENT'),(${id.staff},${building},'RESIDENT'),(${id.outsider},${building},'RESIDENT')`;
    await sqlClient`insert into gateways(id,building_id,name,serial_number) values(${gateway},${building},'Gateway',${gateway})`;
    server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    const ids = Object.values(id);
    await sqlClient`delete from support_grants where building_id=${building}`;
    await sqlClient`delete from audit_logs where user_id in ${sqlClient(ids)} or building_id=${building}`;
    await sqlClient`delete from role_bindings where user_id in ${sqlClient(ids)} or building_id=${building}`;
    await sqlClient`delete from buildings where organization_id=${org}`;
    await sqlClient`delete from organizations where id=${org}`;
    await sqlClient`delete from users where id in ${sqlClient(ids)} or email like ${`%-${suffix}@verify055.test`}`;
    await closeAppDb(); await sqlClient.end();
  });

  const session = async (user: string) => {
    const token = (await login(server.url, email(user))).accessToken;
    const request = (path: string, method = "GET", body?: unknown) => call(server.url, path, { token, method, body });
    const verify = (body: object) => request("/auth/verify", "POST", body);
    const sid = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sid as string;
    /** The proof is older than the window: what a session looks like ten minutes after signing in. */
    const age = () => sqlClient`update sessions set verified_at=clock_timestamp()-interval '11 minutes' where id=${sid}`;
    return { token, sid, request, verify, age };
  };
  const required = async (response: Response) => {
    assert.equal(response.status, 403, await response.clone().text());
    assert.deepEqual(await response.json(), { error: "Confirme sua senha para concluir esta ação.", details: { reason: "VERIFICATION_REQUIRED" } });
  };
  const privileged = (n: string) => [
    ["/users", { name: "Pessoa nova", email: `n${n}-${suffix}@verify055.test`, password: "outra-senha-forte" }],
    ["/users/memberships", { userId: id.resident, buildingId: building, role: "BUILDING_ADMIN" }],
    ["/v1/tenancy/role-bindings", { buildingId: building, userId: id.resident, roleKey: "MAINTENANCE", reason: "Equipe de manutenção" }],
    ["/v1/support-access/staff", { userId: id.staff, reason: "Equipe de suporte" }],
    ["/v1/support-access/grants", { buildingId: building, supportUserId: id.staff, capabilities: ["telemetry:read"], reason: "Diagnóstico", hours: 1 }],
    [`/gateways/${gateway}/credentials`, {}],
  ] as const;

  it("asks every privileged action of a session whose proof is old, and changes nothing", async () => {
    const admin = await session(id.admin);
    await admin.age();
    for (const [path, body] of privileged("1")) await required(await admin.request(path, "POST", body));
    assert.equal((await sqlClient`select count(*)::int n from users where email like ${`%-${suffix}@verify055.test`}`)[0]!.n, 0);
    assert.equal((await sqlClient`select count(*)::int n from memberships where user_id=${id.resident} and role='BUILDING_ADMIN'`)[0]!.n, 0);
    assert.equal((await sqlClient`select count(*)::int n from role_bindings where user_id in (${id.resident},${id.staff})`)[0]!.n, 0);
    assert.equal((await sqlClient`select count(*)::int n from support_grants where building_id=${building}`)[0]!.n, 0);
    assert.equal((await sqlClient`select coalesce(metadata ? 'mqttPasswordHash', false) as issued from gateways where id=${gateway}`)[0]!.issued, false);

    // Routine work and refreshing the token do not need it; a resident link is routine.
    assert.equal((await admin.request(`/users?buildingId=${building}`)).status, 200);
    const resident = await admin.request("/users/memberships", "POST", { userId: id.staff, buildingId: building, role: "RESIDENT", unit: "12" });
    assert.equal(resident.status, 201, await resident.clone().text());
  });

  it("the password renews only this session, and then every privileged action goes through", async () => {
    const admin = await session(id.admin), other = await session(id.admin);
    await admin.age(); await other.age();
    assert.equal((await admin.verify({ currentPassword: "senha errada" })).status, 400);
    await required(await admin.request("/v1/support-access/staff", "POST", privileged("2")[3][1]));
    assert.equal((await admin.verify({ currentPassword: password })).status, 204);
    const [mine, theirs] = await Promise.all([admin.sid, other.sid].map(async sid =>
      (await sqlClient`select verified_at > clock_timestamp()-interval '1 minute' as fresh from sessions where id=${sid}`)[0]!.fresh));
    assert.deepEqual([mine, theirs], [true, false], "another device keeps its own clock");
    await required(await other.request("/v1/support-access/staff", "POST", privileged("2")[3][1]));

    const expected = [201, 201, 201, 201, 201, 201];
    const statuses: number[] = [];
    for (const [path, body] of privileged("2")) {
      const response = await admin.request(path, "POST", body);
      statuses.push(response.status);
      await response.body?.cancel();
    }
    assert.deepEqual(statuses, expected);
  });

  it("checks authority first: someone without it is refused without being asked to confirm", async () => {
    const outsider = await session(id.outsider);
    await outsider.age();
    for (const [path, body] of privileged("3")) {
      const response = await outsider.request(path, "POST", body);
      // The gateway may simply be invisible to a resident.
      assert.ok([403, 404].includes(response.status), `${path}: ${response.status}`);
      assert.notEqual((await response.json() as { details?: { reason?: string } }).details?.reason, "VERIFICATION_REQUIRED", path);
    }
  });

  it("an account with a second factor must also give a fresh code", async () => {
    const manager = await session(id.mfa);
    const enrolled = await manager.request("/auth/mfa/enroll", "POST", { currentPassword: password });
    const secret = base32Decode((await enrolled.json() as { secret: string }).secret)!;
    const step = totpStep(Date.now());
    assert.equal((await manager.request("/auth/mfa/confirm", "POST", { code: totpCode(secret, step) })).status, 200);
    await manager.age();
    const binding = { buildingId: building, userId: id.resident, roleKey: "RESIDENT", reason: "Morador confirmado" };
    await required(await manager.request("/v1/tenancy/role-bindings", "POST", binding));
    assert.equal((await manager.verify({ currentPassword: password })).status, 400, "the password alone is not enough");
    assert.equal((await manager.verify({ currentPassword: password, code: totpCode(secret, step) })).status, 400, "a spent code is refused");
    await required(await manager.request("/v1/tenancy/role-bindings", "POST", binding));
    assert.equal((await manager.verify({ currentPassword: password, code: totpCode(secret, step + 1) })).status, 204);
    assert.equal((await manager.request("/v1/tenancy/role-bindings", "POST", binding)).status, 201);
  });

  it("in PostgreSQL only the identity runtime writes sessions", async () => {
    const admin = await session(id.admin);
    await assert.rejects(appSqlClient.begin(async tx => {
      await tx`select set_config('app.user_id', ${id.admin}, true)`;
      await tx`update sessions set verified_at=clock_timestamp() where id=${admin.sid}`;
    }), { code: "42501" });
    await assert.rejects(appSqlClient`insert into sessions(user_id,expires_at) values(${id.admin},clock_timestamp()+interval '1 hour')`, { code: "42501" });
    await assert.rejects(appSqlClient`delete from sessions where false`, { code: "42501" });
  });
});
