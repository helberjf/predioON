import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeRoleCredentials } from "../src/runtime-role-credentials.js";

const environment = {
  DATABASE_URL: "postgres://owner:owner-secret@localhost:5436/predioon",
  DATABASE_URL_APP: "postgres://predioon_app:app-secret@localhost:5436/predioon",
  DATABASE_URL_IDENTITY: "postgres://predioon_identity:identity-secret@localhost:5436/predioon",
  DATABASE_URL_BROKER_AUTH: "postgres://predioon_broker_auth:broker-secret@localhost:5436/predioon",
};

test("reads only the expected roles and decodes passwords without altering their value", () => {
  const password = "secret:@/%'\\with spaces";
  const result = runtimeRoleCredentials({ ...environment, DATABASE_URL_IDENTITY: `postgres://predioon_identity:${encodeURIComponent(password)}@localhost:5436/predioon` });
  assert.deepEqual(result.map(value => value.role), ["predioon_app", "predioon_identity", "predioon_broker_auth"]);
  assert.equal(result[1]!.password, password);
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
  for (const key of Object.keys(environment)) {
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
  assert.equal(runtimeRoleCredentials(local).length, 3);
});
