import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { sqlClient } from "@predioon/db";
import { identitySqlClient, closeIdentityDb } from "@predioon/db/identity";
import { createRuntimeSqlClient } from "../../../packages/db/src/runtime-connection.js";

after(async () => { await closeIdentityDb(); await sqlClient.end(); });

async function fixture(run: (network: Buffer, account: Buffer) => Promise<void>) {
  const network = randomBytes(32), account = randomBytes(32);
  try { await run(network, account); }
  finally {
    const [table] = await sqlClient`select to_regclass('public.auth_login_buckets') as name`;
    if (table?.name) await sqlClient`delete from auth_login_buckets where key_hash in ${sqlClient([network, account])}`;
  }
}

async function consume(network: Buffer, account: Buffer) {
  const [row] = await identitySqlClient`select public.identity_take_login_budget(${network},${account}) as retry_after`;
  assert.equal(typeof row?.retry_after, "number");
  return row!.retry_after as number;
}

test("login account budget is shared, recovers with elapsed time and never exceeds its capacity", async () => fixture(async (network, account) => {
  for (let attempt = 0; attempt < 20; attempt++) assert.equal(await consume(network, account), 0);
  const wait = await consume(network, account);
  assert.ok(wait > 0 && wait <= 45);
  await sqlClient`update auth_login_buckets set tokens=0, updated_at=clock_timestamp()-interval '901 seconds' where scope='account' and key_hash=${account}`;
  for (let attempt = 0; attempt < 20; attempt++) assert.equal(await consume(network, account), 0);
  assert.ok(await consume(network, account) > 0, "elapsed time cannot grant more than twenty attempts");
}));

test("concurrent database connections cannot overspend one account budget", async () => fixture(async (network, account) => {
  assert.equal(await consume(network, account), 0);
  await sqlClient`update auth_login_buckets set tokens=3, updated_at=clock_timestamp() where scope='account' and key_hash=${account}`;
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => consume(network, account)));
  assert.equal(outcomes.filter(value => value === 0).length, 3);
  assert.equal(outcomes.filter(value => value > 0).length, 9);
}));

test("concurrent creation of a new account bucket admits only its initial twenty attempts", async () => fixture(async (network, account) => {
  const outcomes = await Promise.all(Array.from({ length: 32 }, () => consume(network, account)));
  assert.equal(outcomes.filter(value => value === 0).length, 20);
  assert.equal(outcomes.filter(value => value > 0).length, 12);
}));

test("a backwards wall clock cannot refill or erase an existing restriction", async () => fixture(async (network, account) => {
  assert.equal(await consume(network, account), 0);
  await sqlClient`update auth_login_buckets set tokens=0, updated_at=clock_timestamp()+interval '2 seconds' where scope='account' and key_hash=${account}`;
  const wait = await consume(network, account);
  assert.ok(wait >= 46 && wait <= 47);
  const [row] = await sqlClient`select tokens from auth_login_buckets where scope='account' and key_hash=${account}`;
  assert.equal(Number(row!.tokens), 0);
}));

test("cleanup removes at most thirty-two fully expired buckets and preserves active limits", async () => fixture(async (network, account) => {
  const expired = Array.from({ length: 40 }, () => randomBytes(32));
  try {
    assert.equal(await consume(network, account), 0);
    await sqlClient`update auth_login_buckets set tokens=0 where scope='account' and key_hash=${account}`;
    for (const key of expired) await sqlClient`insert into auth_login_buckets(scope,key_hash,tokens,updated_at,expires_at)
      values('account',${key},0,clock_timestamp()-interval '31 minutes',clock_timestamp()-interval '1 minute')`;
    assert.ok(await consume(network, account) > 0);
    const [remaining] = await sqlClient`select count(*)::int as count from auth_login_buckets where key_hash in ${sqlClient(expired)}`;
    assert.equal(remaining!.count, 8);
    const [active] = await sqlClient`select count(*)::int as count from auth_login_buckets where scope='account' and key_hash=${account}`;
    assert.equal(active!.count, 1);
  } finally { await sqlClient`delete from auth_login_buckets where key_hash in ${sqlClient(expired)}`; }
}));

test("limited accounts still consume the network budget instead of rolling it back", async () => fixture(async (network, account) => {
  assert.equal(await consume(network, account), 0);
  await sqlClient`update auth_login_buckets set tokens=0, updated_at=clock_timestamp() where scope='account' and key_hash=${account}`;
  // One server-side statement avoids depending on HTTP or test-runner throughput.
  const [row] = await identitySqlClient`select array_agg(public.identity_take_login_budget(${network},${account})) as outcomes from generate_series(1,400)`;
  const outcomes = row!.outcomes as number[];
  assert.ok(outcomes.every(value => value > 0));
  assert.ok(outcomes.includes(1), "network eventually denies, even though every account attempt was denied too");
}));

test("a budget waiting for its row lock refills from the database time after the wait", async () => fixture(async (network, account) => {
  assert.equal(await consume(network, account), 0);
  let release!: () => void, locked!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const transaction = sqlClient.begin(async tx => {
    await tx`update auth_login_buckets set tokens=0, updated_at=clock_timestamp()-interval '44 seconds' where scope='account' and key_hash=${account}`;
    locked();
    await hold;
  });
  let result: Promise<number> | undefined;
  try {
    await ready;
    result = consume(network, account);
    await new Promise<void>(resolve => setTimeout(resolve, 1_200));
    release();
    await transaction;
    assert.equal(await result, 0);
  } finally {
    release();
    await transaction;
    await result?.catch(() => undefined);
  }
}));

test("authentication roles can consume only the public budget function, never read private buckets", async () => fixture(async (network, account) => {
  assert.equal(await consume(network, account), 0);
  await assert.rejects(identitySqlClient`select * from auth_login_buckets`, (error: unknown) => (error as { code?: string }).code === "42501");
  await assert.rejects(identitySqlClient`select identity_consume_login_bucket('account',${account})`, (error: unknown) => (error as { code?: string }).code === "42501");
  for (const [variable, role] of [["DATABASE_URL_APP", "predioon_app"], ["DATABASE_URL_BROKER_AUTH", "predioon_broker_auth"]] as const) {
    const client = createRuntimeSqlClient(variable, role, 1);
    try {
      await assert.rejects(client`select identity_take_login_budget(${network},${account})`, (error: unknown) => (error as { code?: string }).code === "42501");
      await assert.rejects(client`select * from auth_login_buckets`, (error: unknown) => (error as { code?: string }).code === "42501");
    } finally { await client.end(); }
  }
  await assert.rejects(identitySqlClient`select identity_take_login_budget(${Buffer.alloc(1)},${account})`, (error: unknown) => (error as { code?: string }).code === "22023");
}));

test("different network connections share one account bucket without overspending", async () => fixture(async (network, account) => {
  const networks = Array.from({ length: 32 }, () => randomBytes(32));
  try {
    const outcomes = await Promise.all(networks.map(key => consume(key, account)));
    assert.equal(outcomes.filter(value => value === 0).length, 20);
    assert.equal(outcomes.filter(value => value > 0).length, 12);
  } finally { await sqlClient`delete from auth_login_buckets where key_hash in ${sqlClient(networks)}`; }
}));

test("migration reapplication preserves consumed budgets and restores private function authority", async () => fixture(async (network, account) => {
  await consume(network, account);
  const migration = await readFile(new URL("../../../infrastructure/035-login-throttling.sql", import.meta.url), "utf8");
  const before = await sqlClient`select * from auth_login_buckets where key_hash in ${sqlClient([network, account])} order by scope`;
  await sqlClient.begin(async tx => {
    await tx`grant execute on function identity_consume_login_bucket(text,bytea) to public`;
    await tx`grant execute on function identity_take_login_budget(bytea,bytea) to predioon_app`;
    await tx.unsafe(migration); await tx.unsafe(migration);
    const [authority] = await tx`select
      has_function_privilege('predioon_app','identity_take_login_budget(bytea,bytea)','EXECUTE') as app,
      has_function_privilege('predioon_identity','identity_consume_login_bucket(text,bytea)','EXECUTE') as private,
      has_function_privilege('predioon_identity','identity_take_login_budget(bytea,bytea)','EXECUTE') as identity,
      (select proowner from pg_proc where oid='identity_take_login_budget(bytea,bytea)'::regprocedure)=
      (select proowner from pg_proc where oid='identity_lock_account_active(text)'::regprocedure) as owner`;
    assert.deepEqual(authority, { app: false, private: false, identity: true, owner: true });
  });
  assert.deepEqual(await sqlClient`select * from auth_login_buckets where key_hash in ${sqlClient([network, account])} order by scope`, before);
}));

test("actual cleanup plans use bounded expiry and tuple lookups among ten thousand active buckets", async t => fixture(async (network, account) => {
  const prefix = randomBytes(16).toString("hex");
  type PlanNode = { Plans?: PlanNode[]; [key: string]: unknown };
  type CapturedPlan = { "Query Text": string; Plan: PlanNode };
  const plans: CapturedPlan[] = [];
  const require = createRequire(import.meta.url);
  const postgres = createRequire(require.resolve("@predioon/db"))("postgres") as (url: string, options: object) => typeof sqlClient;
  const instrumented = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: (notice: { message: string }) => {
    const start = notice.message.indexOf("{"); if (start < 0) return;
    const plan = JSON.parse(notice.message.slice(start)) as CapturedPlan;
    if (/WITH expired AS/i.test(plan["Query Text"])) plans.push(plan);
  } });
  try {
    await sqlClient`insert into auth_login_buckets(scope,key_hash,tokens,updated_at,expires_at)
      select 'account',decode(md5(${prefix}||n)||md5(${prefix}||'-'||n),'hex'),0,
        clock_timestamp()-interval '31 minutes',
        case when n<=40 then clock_timestamp()-interval '1 minute' else clock_timestamp()+interval '30 minutes' end
      from generate_series(1,10040) n`;
    await sqlClient`analyze auth_login_buckets`;
    await instrumented.begin(async tx => {
      await tx`LOAD 'auto_explain'`;
      await tx`SET LOCAL auto_explain.log_nested_statements=on`;
      await tx`SET LOCAL auto_explain.log_analyze=on`;
      await tx`SET LOCAL auto_explain.log_timing=off`;
      await tx`SET LOCAL auto_explain.log_format=json`;
      await tx`SET LOCAL auto_explain.log_level=notice`;
      await tx`SET LOCAL auto_explain.log_min_duration=0`;
      await tx`SET LOCAL ROLE predioon_identity`;
      await tx`select identity_take_login_budget(${network},${account})`;
    });
    assert.equal(plans.length, 1, "capture the function's actual nested cleanup statement");
    const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
    const scans = nodes(plans[0]!.Plan).filter(node => node["Relation Name"] === "auth_login_buckets" && Number(node["Actual Loops"]) > 0 && node["Node Type"] !== "ModifyTable");
    await mkdir(new URL("../../../.local/", import.meta.url), { recursive: true });
    await writeFile(new URL("../../../.local/login-budget-cleanup-plan.json", import.meta.url), JSON.stringify(plans, null, 2));
    assert.ok(scans.some(node => node["Index Name"] === "auth_login_buckets_expiry_idx"));
    for (const scan of scans) {
      assert.notEqual(scan["Node Type"], "Seq Scan", "cleanup must not scan active historical buckets");
      assert.ok(Number(scan["Actual Rows"]) <= 32);
    }
    t.diagnostic(`Actual cleanup: ${scans.map(scan => scan["Node Type"]).join(", ")}; each bounded by 32 rows`);
  } finally {
    await instrumented.end();
    await sqlClient`delete from auth_login_buckets where key_hash in (
      select decode(md5(${prefix}||n)||md5(${prefix}||'-'||n),'hex') from generate_series(1,10040) n)`;
  }
}));
