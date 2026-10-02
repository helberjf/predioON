import "./env.js";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

// Explicit SQL preserves the order of composite keys and their foreign keys.
// Schema push is not a migration mechanism and may leave a partial database.
const baseline = await readFile(new URL("../drizzle/0000_baseline.sql", import.meta.url), "utf8");
const expectedTables = [...baseline.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(match => match[1]!);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para preparar o banco");
const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  await client.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(current_database() || ':bootstrap', 0))`;
    const tables = await tx<{ tablename: string }[]>`select tablename from pg_tables where schemaname='public'`;
    const existing = new Set(tables.map(table => table.tablename));
    if (expectedTables.every(table => existing.has(table))) {
      console.log("Estrutura inicial já presente; dados preservados. Aplique as migrations de infraestrutura.");
      return;
    }
    if (tables.length) throw new Error("Banco parcial ou desconhecido. A preparação não altera tabelas existentes; revise o histórico antes de continuar.");
    await tx.unsafe(baseline);
    console.log("Estrutura inicial criada atomicamente a partir do SQL versionado.");
  });
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("Banco parcial") ? error.message : "Falha na preparação inicial; nenhuma alteração foi confirmada. Verifique conectividade e permissões.");
  process.exitCode = 1;
} finally {
  await client.end();
}
