import "./env.js";
import postgres from "postgres";
import { applyInfrastructure, checkInfrastructure, loadInfrastructureMigrations } from "./infrastructure-migrations.js";

/** Administrative CLI. Every script and its ledger entry share one connection. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--check") || args.length > 1) throw new Error("Uso: db:infra [--check]. --check consulta o histórico sem aplicar alterações.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL administrativa é obrigatória");
  // Validate the full release before connecting or modifying the ledger.
  const migrations = await loadInfrastructureMigrations();
  const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    if (args.includes("--check")) {
      const pending = await checkInfrastructure(client, migrations);
      if (pending.length) {
        console.error(`Migrations pendentes: ${pending.join(", ")}. Revise e execute pnpm db:infra (ou scripts/start-local.ps1 -Setup) antes de iniciar os serviços. Nenhuma alteração aplicada.`);
        process.exitCode = 2;
      } else console.log("Histórico verificado; nenhuma migration pendente. Nenhuma alteração aplicada.");
      return;
    }
    const applied = await applyInfrastructure(client, migrations);
    if (applied.length) console.log(`Infraestrutura confirmada: ${applied.join(", ")}.`);
    else console.log("Infraestrutura atualizada; checksums verificados, nenhuma migration reaplicada.");
  } finally { await client.end(); }
}

try { await main(); }
catch (error) {
  // Only controlled messages, never raw driver diagnostics or connection URLs.
  const message = error instanceof Error ? error.message : "";
  const safe = /^(Uso: |Migration |Migrations |Histórico |Sequência |002-app-role|Metacomando |Nome de migration |Nenhuma migration |Estrutura inicial |Banco legado |DATABASE_URL )/.test(message);
  console.error(safe ? message : "Falha ao aplicar infraestrutura; consulte o histórico e verifique conectividade/permissões sem alterar migrations já confirmadas.");
  process.exitCode = 1;
}
