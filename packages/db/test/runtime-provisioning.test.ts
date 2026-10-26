import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeRoleCredentials } from "../src/runtime-role-credentials.js";

const environment = {
  DATABASE_URL: "postgres://owner:owner-secret@localhost:5436/predioon",
  DATABASE_URL_APP: "postgres://predioon_app:app-secret@localhost:5436/predioon",
  DATABASE_URL_IDENTITY: "postgres://predioon_identity:identity-secret@localhost:5436/predioon",
  DATABASE_URL_BROKER_AUTH: "postgres://predioon_broker_auth:broker-secret@localhost:5436/predioon",
  DATABASE_URL_NOTIFICATIONS: "postgres://predioon_notifications:notification-secret@localhost:5436/predioon",
  DATABASE_URL_INGEST: "postgres://predioon_ingest:ingest-secret@localhost:5436/predioon",
  DATABASE_URL_ACCESS_SERVICE: "postgres://predioon_access_service:access-service-secret@localhost:5436/predioon",
};

const expectedRoles = ["predioon_app", "predioon_identity", "predioon_broker_auth", "predioon_notifications",
  "predioon_ingest", "predioon_access_service"];
const serviceRoles = [
  ["DATABASE_URL_INGEST", "predioon_ingest"],
  ["DATABASE_URL_ACCESS_SERVICE", "predioon_access_service"],
] as const;

test("API-only provisioning requires just its three restricted logins and preserves default worker validation", () => {
  const api = { DATABASE_URL: environment.DATABASE_URL, DATABASE_URL_APP: environment.DATABASE_URL_APP,
    DATABASE_URL_IDENTITY: environment.DATABASE_URL_IDENTITY, DATABASE_URL_BROKER_AUTH: environment.DATABASE_URL_BROKER_AUTH };
  assert.deepEqual(runtimeRoleCredentials(api, "api").map(item => item.role), expectedRoles.slice(0, 3));
  assert.throws(() => runtimeRoleCredentials(api), /DATABASE_URL_NOTIFICATIONS/);
  assert.throws(() => runtimeRoleCredentials({ ...api, DATABASE_URL_APP: api.DATABASE_URL }, "api"), /DATABASE_URL_APP/);
  assert.throws(() => runtimeRoleCredentials({ ...api, DATABASE_URL_IDENTITY: api.DATABASE_URL_IDENTITY + "?role=owner" }, "api"), /DATABASE_URL_IDENTITY/);
});

test("field-only provisioning touches just ingestion and gate dispatch, never the API logins", () => {
  const field = { DATABASE_URL: environment.DATABASE_URL, DATABASE_URL_INGEST: environment.DATABASE_URL_INGEST,
    DATABASE_URL_ACCESS_SERVICE: environment.DATABASE_URL_ACCESS_SERVICE };
  assert.deepEqual(runtimeRoleCredentials(field, "field").map(item => item.role), ["predioon_ingest", "predioon_access_service"]);
  assert.ok(!runtimeRoleCredentials({ ...environment }, "field").some(item => ["predioon_app", "predioon_identity", "predioon_broker_auth"].includes(item.role)));
  assert.throws(() => runtimeRoleCredentials({ ...field, DATABASE_URL_INGEST: field.DATABASE_URL }, "field"), /DATABASE_URL_INGEST/);
});

function safeConfigurationError(variable: string, configured?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(variable), "error identifies the invalid variable");
    assert.ok(!/secret|postgres(?:ql)?:\/\//i.test(error.message), "error omits credentials and DSNs");
    if (configured) assert.ok(!error.message.includes(configured), "error omits the configured URL");
    return true;
  };
}

test("reads only the expected roles and decodes passwords without altering their value", () => {
  const password = "secret:@/%'\\with spaces";
  const result = runtimeRoleCredentials({ ...environment, DATABASE_URL_IDENTITY: `postgres://predioon_identity:${encodeURIComponent(password)}@localhost:5436/predioon` });
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(value => value.role), expectedRoles);
  assert.ok(result[1]!.password === password, "encoded password is decoded exactly once");
});

test("preserves encoded passwords for all six fixed runtime usernames", () => {
  const password = "secret:@/%'\\with spaces %20";
  const encoded = encodeURIComponent(password);
  const configured = { ...environment };
  for (const [variable, url] of Object.entries(configured)) {
    if (variable !== "DATABASE_URL") configured[variable as keyof typeof configured] = url.replace(/:[^:]+@/, `:${encoded}@`);
  }
  const before = { ...configured };
  const result = runtimeRoleCredentials(configured);
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(value => value.role), expectedRoles);
  for (const value of result) assert.ok(value.password === password, `${value.role}: password preserved`);
  assert.ok(Object.keys(configured).every(key => configured[key as keyof typeof configured] === before[key as keyof typeof before]),
    "input URLs are unchanged");
});

test("rejects missing, owner and cross-database runtime credentials before connecting", () => {
  for (const invalid of [undefined, "invalid", environment.DATABASE_URL,
    "postgres://predioon_identity:secret@foreign:5436/predioon",
    "postgres://predioon_identity:secret@localhost:5436/other",
    "postgres://predioon_identity:secret@localhost:5437/predioon",
    "postgres://predioon_identity@localhost:5436/predioon",
    "https://predioon_identity:secret@localhost:5436/predioon"]) {
    assert.throws(() => runtimeRoleCredentials({ ...environment, DATABASE_URL_IDENTITY: invalid }), /DATABASE_URL_IDENTITY/);
  }
});

test("configuration errors never echo a DSN or its password", () => {
  const secret = "never-log-this-password";
  for (const key of ["DATABASE_URL", "DATABASE_URL_APP", "DATABASE_URL_IDENTITY", "DATABASE_URL_BROKER_AUTH", "DATABASE_URL_NOTIFICATIONS"]) {
    assert.throws(() => runtimeRoleCredentials({ ...environment, [key]: `invalid://${secret}` }), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(key));
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
});

test("accepts postgres and postgresql URL aliases and the implicit PostgreSQL port", () => {
  const local = Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, value.replace(":5436", "")]));
  local.DATABASE_URL_APP = local.DATABASE_URL_APP!.replace("postgres:", "postgresql:").replace("localhost/", "localhost:5432/");
  local.DATABASE_URL_INGEST = local.DATABASE_URL_INGEST!.replace("postgres:", "postgresql:");
  local.DATABASE_URL_ACCESS_SERVICE = local.DATABASE_URL_ACCESS_SERVICE!.replace("localhost/", "localhost:5432/");
  assert.equal(runtimeRoleCredentials(local).length, 6);
  assert.deepEqual(runtimeRoleCredentials(local).map(value => value.role), expectedRoles);
});

test("requires the fourth role and rejects forged notification credentials before connecting", () => {
  for (const invalid of [undefined, "", environment.DATABASE_URL, environment.DATABASE_URL_APP,
    "postgres://predioon_notifications:secret@foreign:5436/predioon",
    "postgres://predioon_notifications:secret@localhost:5436/other",
    "postgres://predioon_notifications:secret@localhost:5437/predioon",
    "postgres://predioon_notifications@localhost:5436/predioon"]) {
    assert.throws(() => runtimeRoleCredentials({ ...environment, DATABASE_URL_NOTIFICATIONS: invalid }), /DATABASE_URL_NOTIFICATIONS/);
  }
});

test("provisioning refuses role-changing startup parameters without exposing any credential", () => {
  for (const key of ["DATABASE_URL", "DATABASE_URL_APP", "DATABASE_URL_IDENTITY", "DATABASE_URL_BROKER_AUTH", "DATABASE_URL_NOTIFICATIONS"]) {
    for (const parameter of ["role=owner", "options=-c%20role%3Downer", "session_authorization=owner", "RoLe=owner"]) {
      assert.throws(() => runtimeRoleCredentials({ ...environment, [key]: environment[key as keyof typeof environment] + "?" + parameter }), error => {
        assert.ok(error instanceof Error && error.message.includes(key));
        assert.ok(!error.message.includes("secret"));
        return true;
      });
    }
  }
});

for (const [variable, role] of serviceRoles) {
  const base = `postgres://` + role + `:service-secret@localhost:5436/predioon`;
  const invalidValues: [string, string | undefined][] = [
    ["missing", undefined], ["blank", "   "], ["invalid URL", "invalid://service-secret"],
    ["owner login", environment.DATABASE_URL],
    ["another runtime login", environment.DATABASE_URL_APP],
    ["crossed service login", environment[variable === "DATABASE_URL_INGEST" ? "DATABASE_URL_ACCESS_SERVICE" : "DATABASE_URL_INGEST"]],
    ["wrong username case", base.replace(role, role.toUpperCase())],
    ["foreign server", base.replace("localhost", "foreign")],
    ["foreign port", base.replace(":5436", ":5437")],
    ["foreign database", base.replace("/predioon", "/other")],
    ["missing password", base.replace(":service-secret", "")],
    ["unsupported protocol", base.replace("postgres:", "https:")],
    ["malformed username escape", base.replace(role, `${role}%GG`)],
    ["malformed password escape", base.replace("service-secret", "service-secret%GG")],
    ["malformed database escape", base.replace("/predioon", "/predioon%GG")],
    ...["role=owner", "options=-c%20role%3Downer", "session_authorization=owner", "RoLe=owner",
      "OPTIONS=-c%20role%3Downer", "SESSION_AUTHORIZATION=owner"].map(parameter => [`startup ${parameter.split("=")[0]}`, `${base}?${parameter}`] as [string, string]),
  ];
  for (const [reason, configured] of invalidValues) {
    test(`${variable} rejects ${reason} before returning any credential`, () => {
      const consumed: string[] = [];
      assert.throws(() => {
        // Provisioning callers consume this result only after complete validation.
        // No driver or administrative environment is involved in this fixture.
        for (const credential of runtimeRoleCredentials({ ...environment, [variable]: configured })) consumed.push(credential.role);
      }, safeConfigurationError(variable, configured));
      assert.deepEqual(consumed, [], "no credential is available for construction or mutation");
    });
  }

  test(`${variable} accepts its exact percent-encoded username`, () => {
    const configured = base.replace(role, role.replace("predioon", "%70redioon"));
    const result = runtimeRoleCredentials({ ...environment, [variable]: configured });
    assert.equal(result.length, 6);
    assert.deepEqual(result.map(value => value.role), expectedRoles);
  });
}
