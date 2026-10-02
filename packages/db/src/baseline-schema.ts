import { readFile } from "node:fs/promises";
import type postgres from "postgres";

export const baseline = await readFile(new URL("../drizzle/0000_baseline.sql", import.meta.url), "utf8");
const expectedTables = [...baseline.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(match => match[1]!);
const expectedConstraints = [...baseline.matchAll(/ADD CONSTRAINT "([a-z_]+)"/g)].map(match => match[1]!);
const expectedIndexes = [...baseline.matchAll(/CREATE (?:UNIQUE )?INDEX "([a-z_]+)"/g)].map(match => match[1]!);

/** The same validation is used before bootstrap and before adopting migrations. */
export async function inspectBaseline(client: Pick<postgres.Sql, "unsafe">): Promise<{ empty: boolean; complete: boolean }> {
  const tables = await client.unsafe<{ tablename: string }[]>("select tablename from pg_tables where schemaname='public'");
  const existing = new Set(tables.map(table => table.tablename));
  if (!expectedTables.every(table => existing.has(table))) return { empty: tables.length === 0, complete: false };
  const constraints = await client.unsafe<{ name: string }[]>(`select conname as name from pg_constraint
    where connamespace='public'::regnamespace and convalidated`);
  const indexes = await client.unsafe<{ name: string }[]>(`select c.relname as name from pg_index i
    join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and i.indisvalid`);
  const constraintNames = new Set(constraints.map(item => item.name));
  const indexNames = new Set(indexes.map(item => item.name));
  return { empty: false, complete: expectedConstraints.every(name => constraintNames.has(name)) && expectedIndexes.every(name => indexNames.has(name)) };
}

/** Fresh installs contain only the empty baseline and an optional empty ledger. */
export async function baselineHasLegacyState(client: Pick<postgres.Sql, "unsafe">): Promise<boolean> {
  const tables = await client.unsafe<{ tablename: string }[]>("select tablename from pg_tables where schemaname='public'");
  if (tables.some(({ tablename }) => tablename !== "schema_migrations" && !expectedTables.includes(tablename))) return true;
  for (const table of expectedTables) {
    // Names come only from the checked-in baseline's identifier regex above.
    const [row] = await client.unsafe<{ present: boolean }[]>(`select exists(select 1 from public."${table}") as present`);
    if (row?.present) return true;
  }
  return false;
}
