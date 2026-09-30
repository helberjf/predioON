import assert from "node:assert/strict";
import { it } from "node:test";
import postgres from "postgres";
import { verifyRestrictedDatabaseRole, runtimeDatabaseUrl } from "../src/runtime-connection.js";

const roles = ["predioon_app", "predioon_identity", "predioon_broker_auth"] as const;

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
