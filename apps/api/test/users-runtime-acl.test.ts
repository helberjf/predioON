import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it, mock } from "node:test";
import { sql, type SQL } from "drizzle-orm";
import { sqlClient } from "@predioon/db";
import { appSqlClient, closeAppDb, withUserContext, type UserContext } from "@predioon/db/runtime";
import { identitySqlClient } from "@predioon/db/identity";
import { brokerAuthSqlClient } from "@predioon/db/broker-auth";
import { createNotificationSqlClient } from "@predioon/db/notifications";
import { hashPassword } from "../src/auth/passwords.js";
import { loginBudgetKeys } from "../src/auth/login-budget-keys.js";
import { config } from "../src/config.js";
import { pgErrorCode } from "../src/http/errors.js";
import { call, login, startTestServer, type Session, type TestServer } from "./helpers.js";

const publicColumns = ["active", "created_at", "email", "id", "is_platform_admin", "name", "phone"];
const publicDto = ["active", "createdAt", "email", "id", "isPlatformAdmin", "name", "phone"];
const allColumns = [...publicColumns, "password_hash", "updated_at"].sort();
const runtimeRoles = ["predioon_app", "predioon_identity", "predioon_broker_auth", "predioon_notifications"];
const publicProjection = sql.raw(publicColumns.join(","));

describe("users runtime has public reads and legacy inserts only", () => {
  let server: TestServer;
  let passwordHash: string;
  const actorRoles = new Map<string, UserContext["role"]>();

  before(async () => {
    const [role] = await appSqlClient`select current_user as effective, session_user as authenticated`;
    assert.deepEqual(role, { effective: "predioon_app", authenticated: "predioon_app" });
    passwordHash = await hashPassword("predioon123");
    server = await startTestServer();
  });
  after(async () => {
    await server?.close();
    await closeAppDb();
    await sqlClient.end();
  });

  type Fixture = {
    prefix: string;
    users: Record<"admin" | "resident" | "manager" | "foreign", string>;
    buildings: string[];
    session: (kind: keyof Fixture["users"]) => Promise<Session>;
  };

  async function fixture(run: (f: Fixture) => Promise<void>) {
    const prefix = `users040-${randomUUID()}`;
    const users = Object.fromEntries(["admin", "resident", "manager", "foreign"].map(kind => [kind, `${prefix}-${kind}`])) as Fixture["users"];
    const buildings = [`${prefix}-local`, `${prefix}-foreign`];
    const sessions = new Map<keyof Fixture["users"], Session>();
    const f: Fixture = { prefix, users, buildings, session: async kind => {
      if (!sessions.has(kind)) sessions.set(kind, await login(server.url, `${users[kind]}@example.invalid`));
      return sessions.get(kind)!;
    } };
    try {
      for (const building of buildings) {
        await sqlClient`insert into organizations(id,name,slug) values(${building},'ACL fixture',${building})`;
        await sqlClient`insert into buildings(id,organization_id,name,code) values(${building},${building},'ACL fixture',${building})`;
      }
      for (const [kind, id] of Object.entries(users)) {
        actorRoles.set(id, kind === "admin" ? "PLATFORM_ADMIN" : kind === "manager" ? "BUILDING_ADMIN" : "RESIDENT");
        await sqlClient`insert into users(id,name,email,password_hash,is_platform_admin,phone)
          values(${id},'ACL fixture',${`${id}@example.invalid`},${passwordHash},${kind === "admin"},'fixture-phone')`;
      }
      await sqlClient`insert into memberships(user_id,building_id,role) values
        (${users.resident},${buildings[0]!},'RESIDENT'),
        (${users.manager},${buildings[0]!},'BUILDING_ADMIN'),
        (${users.foreign},${buildings[1]!},'RESIDENT')`;
      await run(f);
    } finally {
      // Includes HTTP-created users whose generated IDs do not have our prefix.
      await sqlClient`delete from audit_logs where user_id in ${sqlClient(Object.values(users))}
        or resource_id in (select id from users where email like ${`${prefix}%@example.invalid`})`;
      await sqlClient`delete from buildings where id in ${sqlClient(buildings)}`;
      await sqlClient`delete from organizations where id in ${sqlClient(buildings)}`;
      const accounts = await sqlClient`select email from users where email like ${`${prefix}%@example.invalid`}`;
      for (const account of accounts) {
        const key = loginBudgetKeys(config.authRateLimitKey, account.email, "127.0.0.1").account;
        await sqlClient`delete from auth_login_buckets where scope='account' and key_hash=${key}`;
      }
      await sqlClient`delete from users where email like ${`${prefix}%@example.invalid`}`;
      assert.equal((await sqlClient`select id from users where email like ${`${prefix}%@example.invalid`}`).length, 0);
      for (const id of Object.values(users)) actorRoles.delete(id);
    }
  }

  const as = <T>(userId: string, run: Parameters<typeof withUserContext<T>>[1]) => {
    const role = actorRoles.get(userId);
    assert.ok(role, "actor context must belong to this fixture");
    return withUserContext({ userId, role }, run);
  };

  async function unchanged(f: Fixture) {
    const [row] = await sqlClient`select count(*)::int as count,
      bool_and(password_hash=${passwordHash} and active and is_platform_admin=(id=${f.users.admin})) as intact
      from users where id in ${sqlClient(Object.values(f.users))}`;
    assert.deepEqual(row, { count: 4, intact: true });
  }

  async function denied(userId: string, statement: SQL) {
    // Also roll back unexpected success in RED: tests never persist a promotion,
    // credential change, deletion or a mistakenly authorized insert.
    const rollback = new Error("users ACL probe rollback");
    let refused = false;
    try {
      await as(userId, async tx => { await tx.execute(statement); throw rollback; });
    } catch (error) {
      if (error !== rollback) {
        assert.equal(pgErrorCode(error), "42501", "failure must be PostgreSQL permission denied");
        refused = true;
      }
    }
    assert.equal(refused, true, "restricted application operation must be denied");
  }

  it("denies credential reads even for the visible account and a real administrator", async () => fixture(async f => {
    for (const actor of [f.users.resident, f.users.admin]) {
      for (const projection of [sql`password_hash`, sql`updated_at`, sql`*`]) {
        await denied(actor, sql`select ${projection} from users where id=${actor}`);
        await denied(actor, sql`select ${projection} from users where false`);
      }
    }
    await unchanged(f);
  }));

  it("denies self promotion through the application SQL role", async () => fixture(async f => {
    await denied(f.users.resident, sql`update users set is_platform_admin=true where id=${f.users.resident}`);
    await unchanged(f);
    const [row] = await as(f.users.resident, tx => tx.execute(sql`select app_has_global_capability('organizations:read') as allowed`));
    assert.equal(row!.allowed, false);
  }));

  it("denies account credential replacement outside the identity helper", async () => fixture(async f => {
    for (const actor of [f.users.resident, f.users.admin]) {
      await denied(actor, sql`update users set password_hash='non-authenticating-ACL-placeholder' where id=${actor}`);
    }
    await unchanged(f);
  }));

  it("denies account deletion for residents and real administrators", async () => fixture(async f => {
    for (const actor of [f.users.resident, f.users.admin]) await denied(actor, sql`delete from users where id=${actor}`);
    await unchanged(f);
  }));

  it("removes UPDATE for every column, including residual column grants", async () => fixture(async f => {
    const columns = await sqlClient`select attname from pg_attribute where attrelid='public.users'::regclass and attnum>0 and not attisdropped order by attname`;
    assert.deepEqual(columns.map(row => row.attname), allColumns);
    for (const actor of [f.users.resident, f.users.admin]) {
      for (const column of allColumns) {
        const identifier = sql.identifier(column);
        await denied(actor, sql`update users set ${identifier}=${identifier} where id=${actor}`);
      }
    }
    await unchanged(f);
  }));

  it("exposes exactly seven public columns while retaining the original INSERT privilege", async () => {
    const table = await sqlClient`select privilege,has_table_privilege('predioon_app','public.users',privilege) as allowed
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege order by privilege`;
    assert.deepEqual(table.map(row => [row.privilege, row.allowed]), [
      ["DELETE", false], ["INSERT", true], ["REFERENCES", false], ["SELECT", false],
      ["TRIGGER", false], ["TRUNCATE", false], ["UPDATE", false],
    ]);
    const columns = await sqlClient`select attname,
      has_column_privilege('predioon_app','public.users',attname,'SELECT') as readable,
      has_column_privilege('predioon_app','public.users',attname,'INSERT') as insertable,
      has_column_privilege('predioon_app','public.users',attname,'UPDATE') as updatable
      from pg_attribute where attrelid='public.users'::regclass and attnum>0 and not attisdropped order by attname`;
    assert.deepEqual(columns.map(row => row.attname), allColumns);
    assert.deepEqual(columns.filter(row => row.readable).map(row => row.attname), publicColumns);
    assert.ok(columns.every(row => row.insertable && !row.updatable));
  });

  it("preserves existing public SELECT isolation with each actor's actual context", async () => fixture(async f => {
    for (const [actor, expected] of [
      [f.users.resident, [f.users.resident]],
      [f.users.manager, [f.users.manager, f.users.resident]],
      [f.users.admin, Object.values(f.users)],
    ] as const) {
      const rows = await as(actor, tx => tx.execute(sql`select ${publicProjection} from users
        where id in (${sql.join(Object.values(f.users).map(id => sql`${id}`), sql`,`)}) order by id`));
      assert.deepEqual(rows.map(row => row.id), [...expected].sort());
      assert.ok(rows.every(row => Object.keys(row).sort().join() === publicColumns.join()));
    }
    assert.equal((await appSqlClient`select id from users`).length, 0, "pool outside actor context sees no users");
  }));

  it("allows authorized INSERT with public RETURNING but never secret RETURNING", async () => fixture(async f => {
    const rollback = new Error("authorized insert rollback");
    await assert.rejects(as(f.users.admin, async tx => {
      const [row] = await tx.execute(sql`insert into users(id,name,email,password_hash)
        values(${`${f.prefix}-sql`},'Inserted fixture',${`${f.prefix}-sql@example.invalid`},'non-authenticating-ACL-placeholder')
        returning ${publicProjection}`);
      assert.deepEqual(Object.keys(row!).sort(), publicColumns);
      assert.equal(row!.active, true);
      assert.equal(row!.is_platform_admin, false);
      throw rollback;
    }), error => error === rollback);
    await denied(f.users.admin, sql`insert into users(id,name,email,password_hash)
      values(${`${f.prefix}-secret`},'Secret return fixture',${`${f.prefix}-secret@example.invalid`},'non-authenticating-ACL-placeholder') returning password_hash`);
    await denied(f.users.resident, sql`insert into users(id,name,email)
      values(${`${f.prefix}-forbidden`},'Forbidden fixture',${`${f.prefix}-forbidden@example.invalid`}) returning id`);
    assert.equal((await sqlClient`select id from users where id in (${`${f.prefix}-sql`},${`${f.prefix}-secret`},${`${f.prefix}-forbidden`})`).length, 0);
  }));

  it("keeps legacy HTTP creation, duplicate checks, public listing and audit atomic", async () => fixture(async f => {
    const admin = await f.session("admin");
    const body = { name: "Created ACL fixture", email: `${f.prefix}-http@example.invalid`, password: "predioon123", phone: "public-phone" };
    const response = await call(server.url, "/users", { method: "POST", token: admin.accessToken, body });
    assert.equal(response.status, 201);
    const created = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(created).sort(), publicDto);
    assert.equal(created.email, body.email);
    assert.equal(created.active, true);
    assert.equal(created.isPlatformAdmin, false);
    assert.equal((await login(server.url, body.email)).user.id, created.id);
    assert.equal((await call(server.url, "/users", { method: "POST", token: admin.accessToken, body })).status, 409);
    const manager = await f.session("manager");
    assert.equal((await call(server.url, "/users", { method: "POST", token: manager.accessToken, body: { ...body, email: `${f.prefix}-denied@example.invalid` } })).status, 403);
    const list = await call(server.url, `/users?buildingId=${f.buildings[0]}`, { token: manager.accessToken });
    assert.equal(list.status, 200);
    const { items } = await list.json() as { items: Record<string, unknown>[] };
    assert.deepEqual(items.map(row => row.id).sort(), [f.users.manager, f.users.resident].sort());
    assert.ok(items.every(row => Object.keys(row).sort().join() === publicDto.join()));
    const audit = await sqlClient`select action,metadata,scope_kind from audit_logs where user_id=${f.users.admin} and resource_id=${String(created.id)}`;
    assert.deepEqual(audit.map(row => ({ ...row })), [{ action: "USER_CREATED", metadata: {}, scope_kind: "PLATFORM" }]);
    assert.equal((await sqlClient`select id from users where email=${`${f.prefix}-denied@example.invalid`}`).length, 0);
  }));

  it("rolls HTTP account creation back when its mandatory audit fails", async () => fixture(async f => {
    const admin = await f.session("admin");
    const name = `users040_${randomUUID().replaceAll("-", "")}`;
    const logger = mock.method(console, "error", () => {});
    try {
      await sqlClient.unsafe(`create function ${name}() returns trigger language plpgsql as $$ begin
        if new.user_id=TG_ARGV[0] and new.action='USER_CREATED' then raise exception 'Fixture audit failure'; end if;
        return new; end $$`);
      await sqlClient.unsafe(`create trigger ${name} before insert on audit_logs for each row execute function ${name}('${f.users.admin}')`);
      const response = await call(server.url, "/users", { method: "POST", token: admin.accessToken,
        body: { name: "Rollback fixture", email: `${f.prefix}-rollback@example.invalid`, password: "predioon123" } });
      assert.equal(response.status, 500);
      assert.equal((await sqlClient`select id from users where email=${`${f.prefix}-rollback@example.invalid`}`).length, 0);
      assert.equal((await sqlClient`select id from audit_logs where user_id=${f.users.admin}`).length, 0);
    } finally {
      await sqlClient.unsafe(`drop trigger if exists ${name} on audit_logs`);
      await sqlClient.unsafe(`drop function if exists ${name}()`);
      logger.mock.restore();
    }
  }));

  it("preserves identity login, refresh and password replacement without direct UPDATE", async () => fixture(async f => {
    const initial = await f.session("resident");
    const refreshed = await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: initial.refreshToken } });
    assert.equal(refreshed.status, 200);
    const rotated = await refreshed.json() as Session;
    const nextPassword = "New disposable password 040";
    assert.equal((await call(server.url, "/auth/password", { method: "POST", token: rotated.accessToken,
      body: { currentPassword: "predioon123", newPassword: nextPassword } })).status, 204);
    assert.equal((await call(server.url, "/auth/me", { token: rotated.accessToken })).status, 401);
    assert.equal((await call(server.url, "/auth/refresh", { method: "POST", body: { refreshToken: rotated.refreshToken } })).status, 401);
    assert.equal((await call(server.url, "/auth/login", { method: "POST", body: { email: `${f.users.resident}@example.invalid`, password: "predioon123" } })).status, 401);
    assert.equal((await login(server.url, `${f.users.resident}@example.invalid`, nextPassword)).user.id, f.users.resident);
    const [account] = await identitySqlClient`select password_hash is not null as has_credential from users where id=${f.users.resident}`;
    assert.equal(account!.has_credential, true);
    await assert.rejects(identitySqlClient`update users set active=false where false`, { code: "42501" });
  }));

  it("keeps broker and notifications excluded from users and roles unprivileged", async () => {
    const notifications = createNotificationSqlClient(() => {});
    try {
      for (const client of [brokerAuthSqlClient, notifications]) {
        await assert.rejects(client`select id from users where false`, { code: "42501" });
        await assert.rejects(client`select password_hash from users where false`, { code: "42501" });
      }
    } finally { await notifications.end({ timeout: 5 }); }
    const flags = await sqlClient`select rolname,rolsuper,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      from pg_roles where rolname in ${sqlClient(runtimeRoles)} order by rolname`;
    assert.equal(flags.length, 4);
    assert.ok(flags.every(row => Object.entries(row).every(([key, value]) => key === "rolname" || value === false)));
    assert.equal((await sqlClient`select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname in ${sqlClient(runtimeRoles)}`).length, 0);
  });

  it("reapplication removes residual column grants without changing other ACLs, policies or helpers", async () => {
    const migration = await readFile(new URL("../../../infrastructure/040-users-runtime-acl.sql", import.meta.url), "utf8");
    const rollback = new Error("040 reapplication rollback");
    await assert.rejects(sqlClient.begin(async owner => {
      const invariant = async () => ({
        functions: await owner`select p.oid::regprocedure::text as signature,p.prosrc,p.proacl::text,p.proowner,p.proconfig
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by signature`,
        policies: await owner`select * from pg_policies where schemaname='public' order by tablename,policyname`,
        tables: await owner`select c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,x.* from pg_class c
          join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) x
          where n.nspname='public' and not (c.oid='public.users'::regclass and x.grantee='predioon_app'::regrole)
          order by c.oid,x.grantor,x.grantee,x.privilege_type`,
        columns: await owner`select a.attrelid,a.attnum,x.* from pg_attribute a
          join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
          cross join lateral aclexplode(a.attacl) x where n.nspname='public'
          and not (a.attrelid='public.users'::regclass and x.grantee='predioon_app'::regrole)
          order by a.attrelid,a.attnum,x.grantor,x.grantee,x.privilege_type`,
        roles: await owner`select rolname,rolsuper,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
          from pg_roles where rolname in ${owner(runtimeRoles)} order by rolname`,
        memberships: await owner`select * from pg_auth_members order by roleid,member,grantor`,
      });
      const before = await invariant();
      await owner`grant select(password_hash,updated_at), update(is_platform_admin,name) on users to predioon_app`;
      for (let iteration = 0; iteration < 2; iteration++) {
        await owner.unsafe(migration);
        assert.deepEqual(await invariant(), before);
        const [table] = await owner`select has_table_privilege('predioon_app','users','INSERT') as insertable,
          has_table_privilege('predioon_app','users','SELECT') as readable,
          has_table_privilege('predioon_app','users','UPDATE') as updatable,
          has_table_privilege('predioon_app','users','DELETE') as deletable`;
        assert.deepEqual(table, { insertable: true, readable: false, updatable: false, deletable: false });
        const columns = await owner`select attname,
          has_column_privilege('predioon_app','users',attname,'SELECT') as readable,
          has_column_privilege('predioon_app','users',attname,'UPDATE') as updatable
          from pg_attribute where attrelid='users'::regclass and attnum>0 and not attisdropped order by attname`;
        assert.deepEqual(columns.filter(row => row.readable).map(row => row.attname), publicColumns);
        assert.ok(columns.every(row => !row.updatable));
      }
      throw rollback;
    }), error => error === rollback);
  });
});
