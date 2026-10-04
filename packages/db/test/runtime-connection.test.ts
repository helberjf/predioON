import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { verifyRestrictedDatabaseRole, runtimeDatabaseUrl } from "../src/runtime-connection.js";

const roles = ["predioon_app", "predioon_identity", "predioon_broker_auth", "predioon_notifications"] as const;

for (const statement of ["set role", "set session authorization"]) {
  it(`rejects owner login disguised through ${statement}`, { skip: process.env.RUN_ACCESS_DB_TESTS !== "1" }, async () => {
    for (const role of roles) {
      const client = postgres(process.env.DATABASE_URL!, { max: 1 });
      try {
        await client.unsafe(`${statement} ${role}`);
        const [identity] = await client`select current_user as effective_user, session_user as session_user_name,
          (select usename from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid()) as authenticated_user`;
        assert.equal(identity!.effective_user, role);
        if (statement === "set session authorization") assert.equal(identity!.session_user_name, role);
        assert.notEqual(identity!.authenticated_user, role);
        await assert.rejects(verifyRestrictedDatabaseRole(client, role), /Credencial de banco restrita/);
      } finally { await client.end(); }
    }
  });
}

it("accepts the actual fourth restricted login without owner impersonation", { skip: process.env.RUN_ACCESS_DB_TESTS !== "1" }, async () => {
  // Infrastructure tests install038 in UUID databases on this disposable
  // cluster. Its role hardening correctly restores cluster-wide NOLOGIN;
  // prepare the real login fixture after those migrations, through the same
  // administrative CLI used at deployment, without weakening any role flags.
  await promisify(execFile)(process.execPath, ["--import", "tsx", "src/provision-runtime-roles.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env }, timeout: 30_000, windowsHide: true,
  });
  const client = postgres(runtimeDatabaseUrl("DATABASE_URL_NOTIFICATIONS", "predioon_notifications"), { max: 1 });
  try { await verifyRestrictedDatabaseRole(client, "predioon_notifications"); }
  finally { await client.end(); }
});

it("rejects role-changing startup parameters in runtime URLs", () => {
  const previous = process.env.DATABASE_URL_APP;
  try {
    for (const parameter of ["role=predioon_app", "options=-c%20role%3Dpredioon_app", "session_authorization=predioon_app", "RoLe=predioon_app"]) {
      process.env.DATABASE_URL_APP = `postgres://predioon_app:URL_PARAMETER_SENTINEL@localhost:5436/predioon?${parameter}`;
      assert.throws(() => runtimeDatabaseUrl("DATABASE_URL_APP", "predioon_app"), error =>
        error instanceof Error && /DATABASE_URL_APP/.test(error.message) && !/URL_PARAMETER_SENTINEL/.test(error.message));
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL_APP;
    else process.env.DATABASE_URL_APP = previous;
  }
});

it("notification runtime requires its explicit restricted URL in every environment", () => {
  const previous = { url: process.env.DATABASE_URL_NOTIFICATIONS, node: process.env.NODE_ENV };
  try {
    for (const node of ["development", "test", "production"]) {
      process.env.NODE_ENV = node;
      delete process.env.DATABASE_URL_NOTIFICATIONS;
      assert.throws(() => runtimeDatabaseUrl("DATABASE_URL_NOTIFICATIONS", "predioon_notifications"), /DATABASE_URL_NOTIFICATIONS/);
    }
    for (const invalid of ["postgres://owner:RUNTIME_SECRET@localhost:5436/predioon",
      "postgres://predioon_app:RUNTIME_SECRET@localhost:5436/predioon",
      "postgres://predioon_notifications:RUNTIME_SECRET@localhost:5436/predioon?options=-c%20role%3Downer",
      "postgres://predioon_notifications:RUNTIME_SECRET@localhost:5436/predioon?RoLe=owner",
      "postgres://predioon_notifications:RUNTIME_SECRET@localhost:5436/predioon?session_authorization=owner"]) {
      process.env.DATABASE_URL_NOTIFICATIONS = invalid;
      assert.throws(() => runtimeDatabaseUrl("DATABASE_URL_NOTIFICATIONS", "predioon_notifications"), error =>
        error instanceof Error && /DATABASE_URL_NOTIFICATIONS/.test(error.message) && !error.message.includes("RUNTIME_SECRET"));
    }
    process.env.DATABASE_URL_NOTIFICATIONS = "postgresql://predioon_notifications:encoded%20password@localhost:5436/predioon";
    assert.equal(runtimeDatabaseUrl("DATABASE_URL_NOTIFICATIONS", "predioon_notifications"), process.env.DATABASE_URL_NOTIFICATIONS);
  } finally {
    if (previous.url === undefined) delete process.env.DATABASE_URL_NOTIFICATIONS; else process.env.DATABASE_URL_NOTIFICATIONS = previous.url;
    if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
  }
});

it("notification identity rejects forged login, ownership, memberships and privileged flags", async () => {
  const role = { effective_user: "predioon_notifications", session_user_name: "predioon_notifications", rolname: "predioon_notifications",
    rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
    has_memberships: false, owns_objects: false };
  const client = (record: unknown) => (async () => [record]) as unknown as postgres.Sql;
  await verifyRestrictedDatabaseRole(client(role), "predioon_notifications");
  for (const key of ["rolsuper", "rolbypassrls", "rolinherit", "rolcreatedb", "rolcreaterole", "rolreplication", "has_memberships", "owns_objects"]) {
    await assert.rejects(verifyRestrictedDatabaseRole(client({ ...role, [key]: true }), "predioon_notifications"), /Credencial de banco restrita/);
  }
  for (const key of ["effective_user", "session_user_name", "rolname"]) {
    await assert.rejects(verifyRestrictedDatabaseRole(client({ ...role, [key]: "owner" }), "predioon_notifications"), /Credencial de banco restrita/);
  }
});
