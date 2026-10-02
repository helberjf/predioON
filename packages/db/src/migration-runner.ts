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

export function pendingMigrations(migrations: Migration[], history: Array<{ id: string; checksum: string }>): Migration[] {
  const expected = new Map(migrations.map(migration => [migration.id, migrationChecksum(migration.source)]));
  for (const row of history) {
    if (!expected.has(row.id)) throw new Error(`Migration aplicada ausente nesta versão: ${row.id}`);
    if (expected.get(row.id) !== row.checksum) throw new Error(`Migration aplicada foi alterada (checksum): ${row.id}`);
  }
  if (history.some((row, index) => migrations[index]?.id !== row.id)) throw new Error("Histórico de migrations fora de ordem; acrescente novas migrations ao final");
  return migrations.slice(history.length);
}

export async function runMigrations(
  client: postgres.Sql,
  migrations: Migration[],
  options: {
    ledgerSchema?: string;
    atomicInitialBatch?: boolean;
    runtimeRoles?: readonly string[];
    /** Read-only installation validation, under the same lock and before any DDL. */
    validateDatabase?: (connection: postgres.ReservedSql) => Promise<void>;
  } = {},
): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.ledgerSchema ?? "public")) throw new Error("Nome de schema inválido");
  const ids = migrations.map(migration => migration.id);
  if (new Set(ids).size !== ids.length) throw new Error("IDs de migration duplicados");
  if (ids.some(id => !/^\d{3,4}[-_][a-z0-9_-]+$/.test(id))) throw new Error("ID de migration inválido");
  if (ids.join("\n") !== [...ids].sort().join("\n")) throw new Error("Migrations fora de ordem");
  const runtimeRoles = options.runtimeRoles ?? [];
  if (runtimeRoles.some(role => !/^[a-z_][a-z0-9_]{0,62}$/.test(role))) throw new Error("Role de runtime inválida");
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
    await options.validateDatabase?.(connection);
    await connection.unsafe(`create table if not exists ${ledger} (
      id text primary key, checksum text not null, applied_at timestamptz not null default now()
    )`);
    async function protectLedger(): Promise<void> {
      // RLS also protects against an inherited table grant. Revoke explicit
      // grants after each migration: the legacy bootstrap grants ALL TABLES.
      await connection.unsafe(`alter table ${ledger} enable row level security`);
      await connection.unsafe(`revoke all on ${ledger} from public`);
      for (const role of runtimeRoles) {
        const [existing] = await connection`select 1 from pg_roles where rolname=${role}`;
        if (existing) await connection.unsafe(`revoke all on ${ledger} from "${role}"`);
      }
    }
    await protectLedger();
    const history = await connection.unsafe<Array<{ id: string; checksum: string }>>(`select id, checksum from ${ledger} order by id`);
    const pending = pendingMigrations(migrations, history);
    // An initial release is all-or-nothing; no intermediate policy is visible.
    // Callers must validate provenance before adopting an existing installation.
    const batches = options.atomicInitialBatch && history.length === 0
      ? (pending.length ? [pending] : []) : pending.map(migration => [migration]);
    for (const batch of batches) {
      let activeId = batch[0]!.id;
      await connection.unsafe("begin");
      try {
        for (const migration of batch) {
          activeId = migration.id;
          if (migration.execute) await migration.execute(connection);
          else await connection.unsafe(migration.source.replaceAll("\r\n", "\n"));
          await connection.unsafe(`insert into ${ledger} (id, checksum) values ($1, $2)`, [migration.id, expected.get(migration.id)!]);
        }
        await protectLedger();
        await connection.unsafe("commit");
        applied.push(...batch.map(migration => migration.id));
      } catch (error) {
        await connection.unsafe("rollback").catch(() => undefined);
        const code = (error as { code?: unknown })?.code;
        const suffix = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
        // Driver errors can carry SQL parameters, including provisioning secrets.
        throw new Error(`Migration ${activeId} não foi confirmada${suffix}; consulte schema_migrations antes de repetir`);
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
