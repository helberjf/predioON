import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import postgres from "postgres";
import { applyInfrastructure, checkInfrastructure, infrastructureMigration, loadInfrastructureMigrations } from "../src/infrastructure-migrations.js";
import { migrationChecksum } from "../src/migration-runner.js";

const run = promisify(execFile);
const ownerUrl = process.env.TEST_MIGRATIONS_DATABASE_URL;
const infra = new URL("../../../infrastructure/", import.meta.url);
const cwd = fileURLToPath(new URL("../", import.meta.url));

it("adapts only the reviewed 002 source and includes its executable adapter in the checksum", async () => {
  const source = await readFile(new URL("002-app-role.sql", infra), "utf8");
  const migration = infrastructureMigration("002-app-role.sql", source);
  assert.ok(migration.execute);
  assert.notEqual(migrationChecksum(migration.source), migrationChecksum(source));
  assert.equal(migrationChecksum(infrastructureMigration("002-app-role.sql", source.replaceAll("\n", "\r\n")).source), migrationChecksum(migration.source));
  assert.throws(() => infrastructureMigration("002-app-role.sql", source + "\nselect 1;"), /002.*revis/i);
  assert.throws(() => infrastructureMigration("029-future.sql", "\\gexec\n"), /metacomando/i);
});

it("loads Windows-safe paths containing spaces and #, and refuses missing script numbers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "predioon # migrations "));
  try {
    await writeFile(join(directory, "001-initial.sql"), "select 1;");
    assert.deepEqual((await loadInfrastructureMigrations(directory)).map(item => item.id), ["001-initial"]);
    await writeFile(join(directory, "003-gap.sql"), "select 3;");
    await assert.rejects(loadInfrastructureMigrations(directory), /sequência/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function isolated(test: (client: postgres.Sql, bootstrap: () => Promise<void>, url: string) => Promise<void>) {
  const name = `infra_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(ownerUrl!, { max: 1, onnotice: () => {} });
  const url = new URL(ownerUrl!); url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 3, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
    await test(client, async () => {
      await run(process.execPath, ["--import", "tsx", "src/bootstrap.ts"], {
        cwd, env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 30_000,
      });
    }, url.toString());
  } finally {
    await client.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
}

// This captures the last legacy release independently from later domain work.
async function legacyRelease() {
  const names = (await readdir(infra)).filter(name => /^\d{3}-.*\.sql$/.test(name) && Number.parseInt(name, 10) <= 26).sort();
  return Promise.all(names.map(async name => infrastructureMigration(name, await readFile(new URL(name, infra), "utf8"))));
}

it("refuses infrastructure before bootstrap without creating a ledger or changing unknown data", { skip: !ownerUrl }, async () => {
  await isolated(async client => {
    await assert.rejects(applyInfrastructure(client, await legacyRelease()), /bootstrap|inicial/i);
    assert.equal((await client`select to_regclass('public.schema_migrations') as name`)[0]?.name, null);
    await client`create table existing_data(value text)`;
    await client`insert into existing_data values ('preserved')`;
    await assert.rejects(applyInfrastructure(client, await legacyRelease()), /bootstrap|inicial/i);
    assert.equal((await client`select value from existing_data`)[0]?.value, "preserved");
  });
});

it("applies the real legacy chain atomically, preserves existing data, then performs no SQL replay", { skip: !ownerUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await bootstrap();
    const migrations = await legacyRelease();
    const results = await Promise.allSettled([applyInfrastructure(client, migrations), applyInfrastructure(client, migrations)]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    assert.equal(results.flatMap(result => result.status === "fulfilled" ? result.value : []).length, migrations.length);
    await client`insert into organizations(id,name,slug) values ('preserve','Preserved organization','preserve')`;
    assert.equal((await client`select count(*)::int as count from schema_migrations`)[0]?.count, migrations.length);
    assert.equal((await client`select extname from pg_extension where extname='timescaledb'`).length, 1);
    assert.equal((await client`select to_regclass('public.telemetry') as relation`)[0]?.relation, "telemetry");
    await client`update permissions set active=false where key='notices:read'`;
    const rolesBefore = await client`select rolname, rolcanlogin, rolpassword from pg_authid where rolname in ('predioon_app','predioon_identity','predioon_broker_auth') order by rolname`;
    assert.deepEqual(await applyInfrastructure(client, migrations), []);
    assert.equal((await client`select name from organizations where id='preserve'`)[0]?.name, "Preserved organization");
    assert.equal((await client`select active from permissions where key='notices:read'`)[0]?.active, false);
    assert.deepEqual(await client`select rolname, rolcanlogin, rolpassword from pg_authid where rolname in ('predioon_app','predioon_identity','predioon_broker_auth') order by rolname`, rolesBefore);
    for (const role of ["predioon_app", "predioon_identity", "predioon_broker_auth"]) {
      const [access] = await client`select has_table_privilege(${role},'schema_migrations','SELECT,INSERT,UPDATE,DELETE') as allowed`;
      assert.equal(access?.allowed, false, `${role} must have no ledger privilege`);
      await assert.rejects(client.begin(async tx => {
        await tx.unsafe(`set local role "${role}"`);
        await tx`delete from schema_migrations`;
      }), (error: unknown) => (error as { code?: string }).code === "42501");
    }
    await bootstrap();
  });
});

it("refuses legacy history without restoring revoked grants or changing data, credentials or policies", { skip: !ownerUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await bootstrap();
    const migrations = await legacyRelease();
    await applyInfrastructure(client, migrations);
    await client`drop table schema_migrations`;
    await client`insert into organizations(id,name,slug) values ('legacy','Existing deployment','legacy')`;
    await client`delete from role_permissions where role_key='RESIDENT' and permission_key='notices:read'`;
    const before = await client`select rolname, rolcanlogin, rolpassword from pg_authid where rolname in ('predioon_app','predioon_identity','predioon_broker_auth') order by rolname`;
    const policies = await client`select * from pg_policies where schemaname='public' order by tablename,policyname`;
    const grants = await client`select * from role_permissions order by role_key,permission_key`;
    await assert.rejects(applyInfrastructure(client, migrations), /Banco legado sem histórico/);
    assert.equal((await client`select name from organizations where id='legacy'`)[0]?.name, "Existing deployment");
    assert.equal((await client`select 1 from role_permissions where role_key='RESIDENT' and permission_key='notices:read'`).length, 0, "adoption must preserve a deliberately removed grant");
    assert.deepEqual(await client`select rolname, rolcanlogin, rolpassword from pg_authid where rolname in ('predioon_app','predioon_identity','predioon_broker_auth') order by rolname`, before);
    assert.deepEqual(await client`select * from pg_policies where schemaname='public' order by tablename,policyname`, policies);
    assert.deepEqual(await client`select * from role_permissions order by role_key,permission_key`, grants);
    assert.equal((await client`select to_regclass('public.schema_migrations') as name`)[0]?.name, null);
  });
});

it("refuses data inserted before first installation and preserves an incomplete schema", { skip: !ownerUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await bootstrap();
    await client`create table previous_installation(value text)`;
    await assert.rejects(applyInfrastructure(client, await legacyRelease()), /Banco legado sem histórico/);
    await client`drop table previous_installation`;
    await client`insert into organizations(id,name,slug) values ('existing','Existing','existing')`;
    await assert.rejects(applyInfrastructure(client, await legacyRelease()), /Banco legado sem histórico/);
    assert.equal((await client`select name from organizations where id='existing'`)[0]?.name, "Existing");
    assert.equal((await client`select to_regclass('public.schema_migrations') as name`)[0]?.name, null);
    await client`drop index users_email_uq`;
    await assert.rejects(applyInfrastructure(client, await legacyRelease()), /Estrutura inicial incompleta/);
    assert.equal((await client`select name from organizations where id='existing'`)[0]?.name, "Existing");
  });
});

it("runs the administrative CLI against the complete current release, then verifies without replay", { skip: !ownerUrl }, async () => {
  await isolated(async (client, bootstrap, url) => {
    await bootstrap();
    const command = (...args: string[]) => run(process.execPath, ["--import", "tsx", "src/apply-infrastructure.ts", ...args], {
      cwd, env: { ...process.env, DATABASE_URL: url }, timeout: 60_000,
    });
    await assert.rejects(command("--check"), error => {
      const result = error as { code?: number; stderr?: string };
      return result.code === 2 && Boolean(result.stderr?.includes("Migrations pendentes:"));
    });
    assert.equal((await client`select to_regclass('public.schema_migrations') as name`)[0]?.name, null);
    assert.match((await command()).stdout, /Infraestrutura confirmada:/);
    const history = await client`select id,checksum,applied_at from schema_migrations order by id`;
    assert.equal(history.length, (await loadInfrastructureMigrations()).length);
    assert.match((await command()).stdout, /nenhuma migration reaplicada/);
    assert.match((await command("--check")).stdout, /nenhuma migration pendente/);
    assert.deepEqual(await client`select id,checksum,applied_at from schema_migrations order by id`, history);
    for (const operation of ["select * from schema_migrations", "delete from schema_migrations", "insert into schema_migrations(id,checksum) values('999-forged','forged')"]) {
      await assert.rejects(client.begin(async tx => {
        await tx`set local role predioon_notifications`;
        await tx.unsafe(operation);
      }), error => (error as { code?: string }).code === "42501", "the fourth runtime cannot read or mutate the applied ledger");
    }
    await bootstrap();
  });
});

it("reports initial and subsequent pending migrations without creating a ledger or changing history", { skip: !ownerUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await bootstrap();
    const migrations = await legacyRelease();
    assert.deepEqual(await checkInfrastructure(client, migrations), migrations.map(item => item.id));
    assert.equal((await client`select to_regclass('public.schema_migrations') as name`)[0]?.name, null);
    await applyInfrastructure(client, migrations);
    const history = await client`select * from schema_migrations order by id`;
    assert.deepEqual(await checkInfrastructure(client, migrations), []);
    assert.deepEqual(await checkInfrastructure(client, [...migrations, { id: "027-next", source: "select 1" }]), ["027-next"]);
    await assert.rejects(checkInfrastructure(client, [{ ...migrations[0]!, source: "select 2" }, ...migrations.slice(1)]), /checksum/);
    await assert.rejects(checkInfrastructure(client, migrations.slice(0,-1)), /ausente/);
    assert.deepEqual(await client`select * from schema_migrations order by id`, history);
  });
});

it("reports another migration executor without waiting or altering its database", { skip: !ownerUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await bootstrap();
    const lock = await client.reserve();
    try {
      await lock`select pg_advisory_lock(hashtextextended(current_database() || ':public',0))`;
      await assert.rejects(checkInfrastructure(client, await legacyRelease()), /execução/);
      assert.equal((await client`select to_regclass('public.schema_migrations') as name`)[0]?.name, null);
    } finally {
      await lock`select pg_advisory_unlock(hashtextextended(current_database() || ':public',0))`;
      lock.release();
    }
  });
});
