import assert from "node:assert/strict";
import { test } from "node:test";
import { isDisposableDatabaseTarget, sameDatabaseTarget } from "./database-target.ts";

test("local fixtures accept PostgreSQL loopback only, without alternate connection parameters", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) assert.equal(isDisposableDatabaseTarget(new URL(`postgres://owner:password@${host}:5436/predioon`), {}), true);
  for (const url of ["https://localhost/predioon", "postgres://db.example.test/predioon", "postgres://postgres/predioon", "postgres://localhost/predioon?host=db.example.test", "postgres://localhost/predioon#alternate"]) {
    assert.equal(isDisposableDatabaseTarget(new URL(url), {}), false);
  }
});

test("the CI exception requires the exact service, port, database and explicit GitHub job settings", () => {
  const environment = { GITHUB_ACTIONS: "true", E2E_DATABASE_SERVICE: "postgres" };
  const service = new URL("postgres://owner:password@postgres:5432/predioon");
  assert.equal(isDisposableDatabaseTarget(service, environment), true);
  for (const env of [{}, { CI: "true" }, { GITHUB_ACTIONS: "true" }, { E2E_DATABASE_SERVICE: "postgres" }, { ...environment, E2E_DATABASE_SERVICE: "db.example.test" }]) {
    assert.equal(isDisposableDatabaseTarget(service, env), false);
  }
  for (const url of ["postgres://postgres:5436/predioon", "postgres://postgres/production", "postgres://postgres.example.test/predioon", "postgres://postgres/predioon?sslmode=require"]) {
    assert.equal(isDisposableDatabaseTarget(new URL(url), environment), false);
  }
});

test("owner and runtime credentials may differ but must select the same database endpoint", () => {
  const owner = new URL("postgres://owner:secret@postgres/predioon");
  assert.equal(sameDatabaseTarget(owner, new URL("postgresql://runtime:other@postgres:5432/predioon")), true);
  for (const target of ["postgres://localhost/predioon", "postgres://postgres:5436/predioon", "postgres://postgres/other"]) {
    assert.equal(sameDatabaseTarget(owner, new URL(target)), false);
  }
});
