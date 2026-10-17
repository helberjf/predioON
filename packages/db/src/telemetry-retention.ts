import "./env.js";
import postgres from "postgres";
import { parseRetentionArguments, UsageError } from "./telemetry-retention-policy.js";

/**
 * Administrative CLI (owner connection only). Shows how much raw telemetry the
 * installation keeps and, on explicit request, installs or removes the
 * TimescaleDB retention policy. Dropping chunks cannot be undone, so nothing
 * here runs from migrations, seeds or services.
 *
 *   pnpm db:telemetry-retention                       status only
 *   pnpm db:telemetry-retention --months 24 --confirm keep the last 24 months
 *   pnpm db:telemetry-retention --off                 keep everything again
 */
type Status = { size: string; chunks: number; oldest: Date | null; newest: Date | null; policy: string | null };

async function status(sql: postgres.Sql): Promise<Status> {
  const [row] = await sql<Status[]>`
    select pg_size_pretty(hypertable_size('public.telemetry')) as size,
      (select count(*)::int from show_chunks('public.telemetry')) as chunks,
      (select min(time) from public.telemetry) as oldest, (select max(time) from public.telemetry) as newest,
      (select config->>'drop_after' from timescaledb_information.jobs
        where proc_name='policy_retention' and hypertable_schema='public' and hypertable_name='telemetry') as policy`;
  return row!;
}

function print(current: Status): void {
  const day = (value: Date | null) => value ? value.toISOString().slice(0, 10) : "—";
  console.log(`Telemetria bruta: ${current.size} em ${current.chunks} blocos semanais; de ${day(current.oldest)} a ${day(current.newest)}.`);
  console.log(current.policy ? `Retenção: leituras com mais de ${current.policy} são removidas.` : "Retenção: desligada (todas as leituras são mantidas).");
}

async function main(): Promise<void> {
  const request = parseRetentionArguments(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new UsageError("Defina DATABASE_URL com a conexão administrativa.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (request.kind !== "status") {
      await sql.begin(async tx => {
        await tx`select remove_retention_policy('public.telemetry', if_exists => true)`;
        if (request.kind === "set") await tx`select add_retention_policy('public.telemetry', make_interval(months => ${request.months}))`;
      });
    }
    print(await status(sql));
  } finally { await sql.end(); }
}

try { await main(); }
catch (error) {
  // Driver errors can carry the connection string; only our own messages are printed.
  console.error(error instanceof UsageError ? error.message : "Falha ao consultar ou alterar a retenção. Confira DATABASE_URL e a extensão TimescaleDB.");
  process.exitCode = 1;
}
