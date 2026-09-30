import type postgres from "postgres";
import { createHash } from "node:crypto";

export type Migration = {
  id: string;
  source: string;
  execute?: (transaction: postgres.ReservedSql) => Promise<void>;
};

export function migrationChecksum(source: string): string {
  return createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
}

export async function runMigrations(
  client: postgres.Sql,
  migrations: Migration[],
  options: { ledgerSchema?: string } = {},
): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.ledgerSchema ?? "public")) throw new Error("Nome de schema inválido");
  const ids = migrations.map(migration => migration.id);
  if (new Set(ids).size !== ids.length) throw new Error("IDs de migration duplicados");
  if (ids.some(id => !/^\d{3,4}[-_][a-z0-9_-]+$/.test(id))) throw new Error("ID de migration inválido");
  if (ids.join("\n") !== [...ids].sort().join("\n")) throw new Error("Migrations fora de ordem");
  const schema = options.ledgerSchema ?? "public";
  const ledger = `"${schema}".schema_migrations`;
  const expected = new Map(migrations.map(migration => [migration.id, migrationChecksum(migration.source)]));
  // Keep the session lock and each BEGIN/COMMIT on this one reserved connection.
  const connection = await client.reserve();
  let locked = false;
  const applied: string[] = [];
  try {
    await connection`select pg_advisory_lock(hashtextextended(current_database() || ':' || ${schema}, 0))`;
    locked = true;
    await connection.unsafe(`create table if not exists ${ledger} (
      id text primary key, checksum text not null, applied_at timestamptz not null default now()
    )`);
    // No runtime policy: inherited broad legacy grants cannot modify this ledger.
    await connection.unsafe(`alter table ${ledger} enable row level security`);
    await connection.unsafe(`revoke all on ${ledger} from public`);
    const history = await connection.unsafe<Array<{ id: string; checksum: string }>>(`select id, checksum from ${ledger} order by id`);
    for (const row of history) {
      if (!expected.has(row.id)) throw new Error(`Migration aplicada ausente nesta versão: ${row.id}`);
      if (expected.get(row.id) !== row.checksum) throw new Error(`Migration aplicada foi alterada (checksum): ${row.id}`);
    }
    if (history.some((row, index) => ids[index] !== row.id)) throw new Error("Histórico de migrations fora de ordem; acrescente novas migrations ao final");
    for (const migration of migrations.slice(history.length)) {
      await connection.unsafe("begin");
      try {
        if (migration.execute) await migration.execute(connection);
        else await connection.unsafe(migration.source.replaceAll("\r\n", "\n"));
        await connection.unsafe(`insert into ${ledger} (id, checksum) values ($1, $2)`, [migration.id, expected.get(migration.id)!]);
        await connection.unsafe("commit");
        applied.push(migration.id);
      } catch (error) {
        await connection.unsafe("rollback").catch(() => undefined);
        const code = (error as { code?: unknown })?.code;
        const suffix = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
        // Driver errors can carry SQL parameters, including provisioning secrets.
        throw new Error(`Migration ${migration.id} não foi confirmada${suffix}; consulte schema_migrations antes de repetir`);
      }
    }
    return applied;
  } finally {
    try {
      if (locked) await connection`select pg_advisory_unlock(hashtextextended(current_database() || ':' || ${schema}, 0))`;
    } finally {
      connection.release();
    }
  }
}
