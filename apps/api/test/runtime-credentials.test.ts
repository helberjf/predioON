import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sqlClient } from "@predioon/db";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const roles = ["predioon_app", "predioon_identity", "predioon_broker_auth"];
const enabled = process.env.RUN_ACCESS_DB_TESTS === "1";
after(async () => { await sqlClient.end(); });

function child(code: string, env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    const processChild = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: apiDirectory, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => { processChild.kill(); reject(new Error("Runtime child timed out")); }, 60_000);
    processChild.stdout.on("data", chunk => { output += chunk; });
    processChild.stderr.on("data", chunk => { output += chunk; });
    processChild.once("error", reject);
    processChild.once("exit", status => { clearTimeout(timer); resolve({ status, output }); });
  });
}

it("API configuration does not require the owner DATABASE_URL", async () => {
  const result = await child("await import('./src/config.ts');", { DATABASE_URL: "", NODE_ENV: "test" });
  assert.equal(result.status, 0, result.output);
});

it("production configuration requires every restricted DSN", async () => {
  for (const key of ["DATABASE_URL_APP", "DATABASE_URL_IDENTITY", "DATABASE_URL_BROKER_AUTH"]) {
    for (const missing of [false, true]) {
      const result = await child(`await import('./src/env.ts'); ${missing ? `delete process.env.${key};` : ""} await import('./src/config.ts');`, { [key]: "", NODE_ENV: "production" });
      assert.notEqual(result.status, 0);
      assert.match(result.output, new RegExp(key));
      assert.doesNotMatch(result.output, /postgres:\/\//);
    }
  }
});

it("rejects malformed runtime URLs without printing their credential input", async () => {
  for (const key of ["DATABASE_URL_APP", "DATABASE_URL_IDENTITY", "DATABASE_URL_BROKER_AUTH"]) {
    const result = await child("await import('./src/server.ts');", { [key]: "postgres://invalid:URL_SECRET_SENTINEL@" });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.output, /URL_SECRET_SENTINEL|postgres:\/\//);
    assert.match(result.output, new RegExp(key));
  }
});

it("sanitizes driver constructor errors for all three runtime pools", async () => {
  for (const [key, entrypoint] of [["DATABASE_URL_APP", "runtime"], ["DATABASE_URL_IDENTITY", "identity"], ["DATABASE_URL_BROKER_AUTH", "broker-auth"]]) {
    const result = await child(`await import('@predioon/db/${entrypoint}');`, {
      [key!]: "postgres://role:password@localhost:5436/predioon?target_session_attrs=URL_SECRET_SENTINEL",
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.output, /URL_SECRET_SENTINEL|postgres:\/\//);
    assert.match(result.output, new RegExp(key!));
  }
});

it("imports the owner entrypoint in production without any runtime credentials", async () => {
  const result = await child(`
    await import('../../packages/db/src/env.ts');
    delete process.env.DATABASE_URL_APP;
    delete process.env.DATABASE_URL_IDENTITY;
    delete process.env.DATABASE_URL_BROKER_AUTH;
    const { sqlClient } = await import('@predioon/db');
    await sqlClient.end();
    console.log('owner-independent');
  `, { NODE_ENV: "production" });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /owner-independent/);
});

describe("restricted API database credentials", { skip: !enabled }, () => {
  it("has three non-owning roles without inheritance, privilege flags or memberships", async () => {
    const found = await sqlClient`select rolname, rolsuper, rolinherit, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname in ${sqlClient(roles)}`;
    assert.equal(found.length, 3, "SQL015 must create both dedicated roles");
    for (const role of found) {
      for (const flag of ["rolsuper", "rolinherit", "rolbypassrls", "rolcreatedb", "rolcreaterole"]) assert.equal(role[flag], false, `${role.rolname}: ${flag}`);
    }
    const memberships = await sqlClient`select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname in ${sqlClient(roles)}`;
    assert.equal(memberships.length, 0);
    const owners = await sqlClient`select 1 from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname in ${sqlClient(roles)}`;
    assert.equal(owners.length, 0);
  });

  it("identity can read account state and lock it without gaining account or business writes", async () => {
    const { identitySqlClient: identity, closeIdentityDb } = await import("@predioon/db/identity");
    try {
      const [account] = await identity`select id from users where id='resident_demo'`;
      assert.ok(account);
      const [active] = await identity`select identity_lock_account_active('resident_demo') as active`;
      assert.equal(active?.active, true);
      const [missing] = await identity`select identity_lock_account_active('missing-account') as active`;
      assert.equal(missing?.active, false);
      for (const query of [
        "update users set active=false where false", "update users set is_platform_admin=true where false",
        "update memberships set role='BUILDING_ADMIN' where false", "select * from telemetry limit 1",
        "select * from financial_reports limit 1", "select * from audit_logs limit 1", "select * from role_bindings limit 1",
        "delete from sessions where false", "create table public.identity_forbidden(id int)", "set role predioon_app",
      ]) await assert.rejects(identity.unsafe(query), { code: "42501" }, query);
    } finally { await closeIdentityDb(); }
  });

  it("broker reads only its authentication columns and cannot read identity, business data or write", async () => {
    const { brokerAuthSqlClient: broker, closeBrokerAuthDb } = await import("@predioon/db/broker-auth");
    try {
      await broker`select id, building_id, enabled, metadata from gateways limit 1`;
      await broker`select id, building_id, gateway_id, enabled from devices limit 1`;
      await broker`select id, active from buildings limit 1`;
      await broker`select id, building_id, gateway_id, device_id, enabled from gates limit 1`;
      for (const query of [
        "select password_hash from users limit 1", "select * from sessions limit 1", "select * from refresh_tokens limit 1",
        "select name from gateways limit 1", "select address from buildings limit 1", "select * from telemetry limit 1",
        "select * from financial_reports limit 1", "update gateways set enabled=false where false",
        "delete from devices where false", "create table public.broker_forbidden(id int)", "set role predioon_identity",
        "select identity_lock_account_active('resident_demo')", "select app_access_role('bld_001')",
      ]) await assert.rejects(broker.unsafe(query), { code: "42501" }, query);
    } finally { await closeBrokerAuthDb(); }
  });

  it("does not expose the identity helper or unrestricted auth policies to app", async () => {
    await sqlClient.begin(async tx => {
      await tx`set local role predioon_app`;
      assert.equal((await tx`select id from users`).length, 0);
      assert.equal((await tx`select id from sessions`).length, 0);
    });
    await assert.rejects(sqlClient.begin(async tx => {
      await tx`set local role predioon_app`;
      await tx`select identity_lock_account_active('resident_demo')`;
    }), { code: "42501" });
    const policies = await sqlClient`select policyname, roles from pg_policies where policyname like 'identity_%' or policyname like 'broker_auth_%'`;
    assert.ok(policies.length >= 14);
    for (const policy of policies) assert.deepEqual(policy.roles, [policy.policyname.startsWith("identity_") ? "predioon_identity" : "predioon_broker_auth"]);
  });

  it("starts the real API, logs in and reports ready while the owner DSN is unavailable", async () => {
    const result = await child(`
      import assert from 'node:assert/strict';
      import { app } from './src/app.ts';
      import { assertApiDatabaseRoles, closeApiDatabases } from './src/database.ts';
      await assertApiDatabaseRoles();
      const server = app.listen(0);
      await new Promise(resolve => server.once('listening', resolve));
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        assert.equal((await fetch(base + '/health/ready')).status, 200);
        assert.equal((await fetch(base + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:'morador@predioon.local',password:'predioon123'}) })).status, 200);
        console.log('restricted-runtime-ready');
      } finally { await new Promise(resolve => server.close(resolve)); await closeApiDatabases(); }
    `, { DATABASE_URL: "postgres://owner:OWNER_SENTINEL@127.0.0.1:1/unavailable" });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /restricted-runtime-ready/);
    assert.doesNotMatch(result.output, /OWNER_SENTINEL/);
  });

  it("fails startup closed when any runtime DSN points to the owner without disclosing credentials", async () => {
    for (const key of ["DATABASE_URL_APP", "DATABASE_URL_IDENTITY", "DATABASE_URL_BROKER_AUTH"]) {
      const result = await child("await import('./src/server.ts');", { [key]: process.env.DATABASE_URL! });
      assert.notEqual(result.status, 0, key);
      assert.doesNotMatch(result.output, /Prédio ON API:|postgres:\/\//);
      assert.match(result.output, /credencial|credential|restrit/i);
    }
  });

  it("sanitizes readiness errors even when a pool is unavailable", async () => {
    const result = await child(`
      import assert from 'node:assert/strict';
      import { app } from './src/app.ts';
      import { closeApiDatabases } from './src/database.ts';
      const server=app.listen(0); await new Promise(resolve => server.once('listening', resolve));
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/health/ready');
        assert.equal(response.status,503);
        assert.deepEqual(await response.json(), {ok:false,database:'down'});
      } finally { await new Promise(resolve=>server.close(resolve)); await closeApiDatabases(); }
    `, { DATABASE_URL_IDENTITY: "postgres://predioon_identity:READINESS_SECRET@127.0.0.1:1/unavailable" });
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /READINESS_SECRET|postgres:\/\//);
  });
});
