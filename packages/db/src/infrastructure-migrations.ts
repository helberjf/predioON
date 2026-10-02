import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { baselineHasLegacyState, inspectBaseline } from "./baseline-schema.js";
import { migrationChecksum, pendingMigrations, runMigrations, type Migration } from "./migration-runner.js";

const infraDir = fileURLToPath(new URL("../../../infrastructure/", import.meta.url));
const reviewedRoleSource = "a51ad8b42db58e49fd89df157f1edb506e82a4bdf825bbc815cd5fbd128d292a";

/** A deliberately narrow adapter, not a general-purpose psql interpreter. */
export function infrastructureMigration(filename: string, input: string): Migration {
  if (!/^\d{3,4}-[a-z0-9-]+\.sql$/.test(filename)) throw new Error(`Nome de migration inválido: ${filename}`);
  const id = filename.slice(0, -4);
  const source = input.replaceAll("\r\n", "\n");
  if (filename === "002-app-role.sql") {
    if (migrationChecksum(source) !== reviewedRoleSource) throw new Error("002-app-role.sql mudou: revise explicitamente seu adaptador antes de aplicar");
    // Preserve the original grants/policies. Credentials remain exclusively in
    // db:provision-runtime; adopting a deployment must not reset its password.
    const remainingSql = source.slice(source.indexOf("GRANT USAGE ON SCHEMA public TO predioon_app;"));
    const executable = `-- Native adapter 002 v1: no credentials or external connection.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='predioon_app') THEN
    CREATE ROLE predioon_app NOLOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO predioon_app', current_database());
END $$;
${remainingSql}`;
    return { id, source: `${source}\n-- Reviewed native adapter source follows:\n${executable}`,
      execute: async connection => { await connection.unsafe(executable); } };
  }
  if (/^\s*\\/m.test(source)) throw new Error(`Metacomando psql sem adaptador revisado: ${filename}`);
  return { id, source };
}

export async function loadInfrastructureMigrations(directory: string = infraDir): Promise<Migration[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
  if (!names.length) throw new Error("Nenhuma migration de infraestrutura encontrada");
  const migrations = await Promise.all(names.map(async name => infrastructureMigration(name, await readFile(join(directory, name), "utf8"))));
  if (migrations.some((migration, index) => Number.parseInt(migration.id, 10) !== index + 1)) {
    throw new Error("Sequência de migrations incompleta ou duplicada; não aplique uma versão parcial");
  }
  return migrations;
}

export async function applyInfrastructure(client: postgres.Sql, migrations: Migration[]): Promise<string[]> {
  return runMigrations(client, migrations, {
    atomicInitialBatch: true,
    runtimeRoles: ["predioon_app", "predioon_identity", "predioon_broker_auth"],
    validateDatabase: async connection => { await validateInstallation(connection); },
  });
}

/** Runs under either executor's exclusive lock or checker's shared lock. */
async function validateInstallation(connection: postgres.ReservedSql): Promise<boolean> {
  if (!(await inspectBaseline(connection)).complete) throw new Error("Estrutura inicial incompleta: execute db:bootstrap e revise o banco antes das migrations");
  const [ledger] = await connection`select to_regclass('public.schema_migrations') is not null as present`;
  const ledgerPresent = Boolean(ledger?.present);
  if (ledgerPresent && (await connection`select 1 from public.schema_migrations limit 1`).length) return true;
  // The official Timescale image preinstalls its extension in template1;
  // extension presence alone is not evidence of an earlier app install.
  const [legacy] = await connection`select exists(select 1 from pg_policies where schemaname='public')
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and left(p.proname,4)='app_') as present`;
  if (legacy?.present || await baselineHasLegacyState(connection)) {
    throw new Error("Banco legado sem histórico de migrations: nenhuma alteração aplicada. Preserve o backup e valide a versão instalada para uma adoção explícita; não reaplique os scripts nem crie checksums manualmente.");
  }
  return ledgerPresent;
}

/** Read-only status. Never creates/hardens the ledger or executes migration SQL. */
export async function checkInfrastructure(client: postgres.Sql, migrations: Migration[]): Promise<string[]> {
  const connection = await client.reserve();
  let locked = false;
  try {
    const [result] = await connection`select pg_try_advisory_lock_shared(hashtextextended(current_database() || ':public',0)) as locked`;
    locked = Boolean(result?.locked);
    if (!locked) throw new Error("Migration em execução por outro processo; aguarde sua conclusão e verifique novamente");
    const ledgerPresent = await validateInstallation(connection);
    const history = ledgerPresent ? await connection<{ id: string; checksum: string }[]>`select id,checksum from public.schema_migrations order by id` : [];
    return pendingMigrations(migrations, history).map(migration => migration.id);
  } finally {
    try {
      if (locked) await connection`select pg_advisory_unlock_shared(hashtextextended(current_database() || ':public',0))`;
    } finally { connection.release(); }
  }
}
