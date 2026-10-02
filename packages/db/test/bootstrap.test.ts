import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import postgres from "postgres";

const run = promisify(execFile);
const adminUrl = process.env.TEST_MIGRATIONS_DATABASE_URL;
const cwd = fileURLToPath(new URL("../", import.meta.url));

async function isolated(test: (client: postgres.Sql, bootstrap: () => Promise<void>) => Promise<void>) {
  const name = `bootstrap_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  const url = new URL(adminUrl!); url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
    await test(client, async () => {
      await run(process.execPath, ["--import", "tsx", "src/bootstrap.ts"], {
        cwd, env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 30_000,
      });
    });
  } finally {
    await client.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
}

it("bootstraps once, preserves existing data and refuses a partially constrained schema", { skip: !adminUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await bootstrap();
    await client`insert into organizations(id,name,slug) values ('preserve','Preserve','preserve')`;
    await bootstrap();
    assert.equal((await client`select name from organizations where id='preserve'`)[0]?.name, "Preserve");
    await client`drop index users_email_uq`;
    await assert.rejects(bootstrap(), /Banco parcial/);
    assert.equal((await client`select name from organizations where id='preserve'`)[0]?.name, "Preserve");
  });
});

it("refuses an unknown nonempty database without modifying its data", { skip: !adminUrl }, async () => {
  await isolated(async (client, bootstrap) => {
    await client`create table existing_data (value text)`;
    await client`insert into existing_data values ('preserve')`;
    await assert.rejects(bootstrap(), /Banco parcial ou desconhecido/);
    assert.equal((await client`select value from existing_data`)[0]?.value, "preserve");
    assert.equal((await client`select to_regclass('public.organizations') as relation`)[0]?.relation, null);
  });
});
