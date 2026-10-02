import "./env.js";
import postgres from "postgres";
import { baseline, inspectBaseline } from "./baseline-schema.js";

// Explicit SQL preserves the order of composite keys and their foreign keys.
// Schema push is not a migration mechanism and may leave a partial database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para preparar o banco");
const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  await client.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(current_database() || ':bootstrap', 0))`;
    const state = await inspectBaseline(tx);
    if (state.complete) {
      console.log("Estrutura inicial já presente; dados preservados. Aplique as migrations de infraestrutura.");
      return;
    }
    if (!state.empty) throw new Error("Banco parcial ou desconhecido. Faltam tabelas, constraints ou índices da estrutura inicial; revise o histórico antes de continuar.");
    await tx.unsafe(baseline);
    console.log("Estrutura inicial criada atomicamente a partir do SQL versionado.");
  });
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("Banco parcial") ? error.message : "Falha na preparação inicial; nenhuma alteração foi confirmada. Verifique conectividade e permissões.");
  process.exitCode = 1;
} finally {
  await client.end();
}
