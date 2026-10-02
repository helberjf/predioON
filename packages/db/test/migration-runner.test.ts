import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import postgres from "postgres";
import { migrationChecksum, runMigrations } from "../src/migration-runner.js";

it("uses a portable checksum while detecting edited SQL", () => {
  assert.match(migrationChecksum("select 1;\n"), /^[a-f0-9]{64}$/);
  assert.equal(migrationChecksum("select 1;\r\n"), migrationChecksum("select 1;\n"));
  assert.notEqual(migrationChecksum("select 1;\n"), migrationChecksum("select 2;\n"));
});

it("rolls back the entire first adoption batch, including earlier scripts", { skip: !process.env.TEST_MIGRATIONS_DATABASE_URL }, async () => {
  const client = postgres(process.env.TEST_MIGRATIONS_DATABASE_URL!, { max: 2, onnotice: () => {} });
  const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.unsafe(`create schema "${schema}"`);
    await assert.rejects(runMigrations(client, [
      { id: "001-initial", source: `create table "${schema}".effects (value text)` },
      { id: "002-broken", source: "select nonexistent_column" },
    ], { ledgerSchema: schema, atomicInitialBatch: true }), /002-broken/);
    assert.equal((await client`select to_regclass(${`${schema}.effects`}) as name`)[0]?.name, null);
    assert.equal((await client.unsafe(`select * from "${schema}".schema_migrations`)).length, 0);
  } finally {
    await client.unsafe(`drop schema if exists "${schema}" cascade`);
    await client.end();
  }
});

it("never exposes an intermediate legacy state while adopting an existing database", { skip: !process.env.TEST_MIGRATIONS_DATABASE_URL }, async () => {
  const client = postgres(process.env.TEST_MIGRATIONS_DATABASE_URL!, { max: 2, onnotice: () => {} });
  const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
  let signalReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { signalReached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let running: Promise<string[]> | undefined;
  try {
    await client.unsafe(`create schema "${schema}"; create table "${schema}".state (value text); insert into "${schema}".state values ('current')`);
    running = runMigrations(client, [
      { id: "001-legacy", source: `update "${schema}".state set value='legacy'` },
      { id: "002-current", source: "reviewed adapter v1", execute: async tx => {
        signalReached(); await gate;
        await tx.unsafe(`update "${schema}".state set value='current'`);
      } },
    ], { ledgerSchema: schema, atomicInitialBatch: true });
    await Promise.race([reached, running.then(() => { throw new Error("Runner did not reach adapter"); })]);
    assert.equal((await client.unsafe(`select value from "${schema}".state`))[0]?.value, "current");
    release();
    assert.deepEqual(await running, ["001-legacy", "002-current"]);
  } finally {
    release(); await running?.catch(() => {});
    await client.unsafe(`drop schema if exists "${schema}" cascade`);
    await client.end();
  }
});

it("rejects duplicate ids and unsafe schema names before connecting", async () => {
  const unavailable = postgres("postgres://unused:unused@127.0.0.1:1/unused", { connect_timeout: 1 });
  try {
    await assert.rejects(runMigrations(unavailable, [{ id: "000-a", source: "select 1" }, { id: "000-a", source: "select 2" }]), /duplicad/i);
    await assert.rejects(runMigrations(unavailable, [], { ledgerSchema: 'public"; drop table users' }), /schema/i);
  } finally { await unavailable.end(); }
});

const databaseUrl = process.env.TEST_MIGRATIONS_DATABASE_URL;
describe("controlled PostgreSQL migrations", { skip: !databaseUrl }, () => {
  const client = postgres(databaseUrl!, { max: 4, onnotice: () => {} });
  const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
  const effects = `"${schema}".effects`;
  before(async () => { await client.unsafe(`create schema "${schema}"`); });
  after(async () => {
    assert.match(schema, /^migration_test_[a-f0-9]{32}$/);
    await client.unsafe(`drop schema "${schema}" cascade`);
    await client.end();
  });

  const migrations = [
    { id: "000-initial", source: `create table ${effects}(id text primary key)` },
    { id: "001-effect", source: `insert into ${effects}(id) values ('once')` },
  ];

  it("serializes concurrent runners and records each effect once", async () => {
    const results = await Promise.all([
      runMigrations(client, migrations, { ledgerSchema: schema }),
      runMigrations(client, migrations, { ledgerSchema: schema }),
    ]);
    assert.equal(results.flat().length, 2);
    assert.equal((await client.unsafe(`select * from ${effects}`)).length, 1);
    assert.deepEqual(await runMigrations(client, migrations, { ledgerSchema: schema }), []);
  });

  it("refuses altered or missing migration history before applying anything new", async () => {
    await assert.rejects(runMigrations(client, [migrations[0]!, { ...migrations[1]!, source: "select 1" }], { ledgerSchema: schema }), /checksum|alterada/i);
    await assert.rejects(runMigrations(client, [migrations[0]!], { ledgerSchema: schema }), /ausente|missing/i);
  });

  it("rolls back both effects and ledger entry when a migration fails", async () => {
    await assert.rejects(runMigrations(client, [...migrations, {
      id: "002-broken", source: `insert into ${effects}(id) values ('rollback'); select nonexistent_column from ${effects}`,
    }], { ledgerSchema: schema }), /002-broken/);
    assert.equal((await client.unsafe(`select * from ${effects} where id='rollback'`)).length, 0);
    assert.equal((await client.unsafe(`select * from "${schema}".schema_migrations where id='002-broken'`)).length, 0);
    assert.deepEqual(await runMigrations(client, [...migrations, { id: "002-recovered", source: "select 1" }], { ledgerSchema: schema }), ["002-recovered"]);
  });
});
