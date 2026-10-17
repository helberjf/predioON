import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { verifyRestrictedDatabaseRole, runtimeDatabaseUrl } from "../src/runtime-connection.js";

const roles = ["predioon_app", "predioon_identity", "predioon_broker_auth", "predioon_notifications", "predioon_ingest", "predioon_access_service"] as const;
const serviceRoles = [
  ["DATABASE_URL_INGEST", "predioon_ingest"],
  ["DATABASE_URL_ACCESS_SERVICE", "predioon_access_service"],
] as const;

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function safeRuntimeError(variable: string, kind: "obrigatória" | "inválida", configured?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(variable), "error identifies the runtime variable");
    assert.ok(error.message.includes(kind), `error reports ${kind} rather than an unrecognized role`);
    assert.ok(!/RUNTIME_SECRET|postgres(?:ql)?:\/\//.test(error.message), "error omits credentials and DSNs");
    if (configured) assert.ok(!error.message.includes(configured), "error omits the configured URL");
    return true;
  };
}

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

for (const [variable, role] of serviceRoles) {
  for (const node of ["development", "test", "production"]) {
    for (const configured of [undefined, "", "   "]) {
      it(`${variable} is mandatory in ${node} with ${configured === undefined ? "missing" : configured === "" ? "empty" : "blank"} configuration`, () => {
        // DATABASE_URL is deliberately not read or changed: even if an owner URL
        // exists in the calling shell it cannot satisfy this runtime contract.
        withEnvironment({ [variable]: configured, NODE_ENV: node }, () => {
          assert.throws(() => runtimeDatabaseUrl(variable, role), safeRuntimeError(variable, "obrigatória"));
        });
      });
    }

    for (const protocol of ["postgres", "postgresql"]) {
      it(`${variable} preserves an explicit ${protocol} URL in ${node}`, () => {
        const configured = `${protocol}://${role}:RUNTIME_SECRET%20%2520%40%2F@localhost/predioon?application_name=restricted-fixture`;
        withEnvironment({ [variable]: configured, NODE_ENV: node }, () => {
          assert.ok(runtimeDatabaseUrl(variable, role) === configured, "explicit URL is returned unchanged");
        });
      });
    }
  }

  const base = `postgres://${role}:RUNTIME_SECRET@localhost:5436/predioon`;
  const otherRole = role === "predioon_ingest" ? "predioon_access_service" : "predioon_ingest";
  const invalidValues: [string, string][] = [
    ["owner username", base.replace(role, "owner")],
    ["app username", base.replace(role, "predioon_app")],
    ["crossed service username", base.replace(role, otherRole)],
    ["wrong username case", base.replace(role, role.toUpperCase())],
    ["invalid URL", "invalid://RUNTIME_SECRET"],
    ["unsupported protocol", base.replace("postgres:", "https:")],
    ["malformed username escape", base.replace(role, `${role}%GG`)],
    ["malformed password escape", base.replace("RUNTIME_SECRET", "RUNTIME_SECRET%GG")],
    ["malformed database escape", base.replace("/predioon", "/predioon%GG")],
    ...["role=owner", "options=-c%20role%3Downer", "session_authorization=owner", "RoLe=owner",
      "OPTIONS=-c%20role%3Downer", "SESSION_AUTHORIZATION=owner"].map(parameter => [`startup ${parameter.split("=")[0]}`, `${base}?${parameter}`] as [string, string]),
  ];
  for (const [reason, configured] of invalidValues) {
    it(`${variable} rejects ${reason} with a sanitized URL error`, () => {
      withEnvironment({ [variable]: configured }, () => {
        assert.throws(() => runtimeDatabaseUrl(variable, role), safeRuntimeError(variable, "inválida", configured));
      });
    });
  }

  it(`${variable} fixes the role independently of a supplied URL`, () => {
    withEnvironment({ [variable]: base.replace(role, otherRole) }, () => {
      assert.throws(() => runtimeDatabaseUrl(variable, otherRole), error => {
        assert.ok(error instanceof Error && error.message.includes(variable) && /role restrita incompatível/.test(error.message));
        assert.ok(!error.message.includes("RUNTIME_SECRET") && !error.message.includes("postgres://"));
        return true;
      });
    });
  });

  it(`${role} verifier accepts a restricted identity record and rejects each privileged or forged field`, async () => {
    // These records exercise the verifier's decision only. They do not prove
    // which memberships or authenticated identities a PostgreSQL query returns.
    const record = { effective_user: role, session_user_name: role, rolname: role,
      rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, has_memberships: false, owns_objects: false };
    const client = (records: unknown[]) => (async () => records) as unknown as postgres.Sql;
    await verifyRestrictedDatabaseRole(client([record]), role);
    for (const key of ["rolsuper", "rolbypassrls", "rolinherit", "rolcreatedb", "rolcreaterole", "rolreplication", "has_memberships", "owns_objects"]) {
      await assert.rejects(verifyRestrictedDatabaseRole(client([{ ...record, [key]: true }]), role), /Credencial de banco restrita/);
    }
    // rolname is the authenticated backend identity; the other fields represent
    // current_user and session_user, including their forged SET ROLE variants.
    for (const key of ["effective_user", "session_user_name", "rolname"]) {
      for (const forged of ["owner", otherRole]) {
        await assert.rejects(verifyRestrictedDatabaseRole(client([{ ...record, [key]: forged }]), role), /Credencial de banco restrita/);
      }
    }
    await assert.rejects(verifyRestrictedDatabaseRole(client([]), role), /Credencial de banco restrita/);
  });

  it(`${role} verifier sanitizes a query failure`, async () => {
    const client = (async () => { throw new Error("postgres://owner:RUNTIME_SECRET@fixture/predioon"); }) as unknown as postgres.Sql;
    await assert.rejects(verifyRestrictedDatabaseRole(client, role), error => {
      assert.ok(error instanceof Error && error.message.includes(role) && /Credencial de banco restrita/.test(error.message));
      assert.ok(!/RUNTIME_SECRET|postgres:\/\//.test(error.message));
      return true;
    });
  });
}
