import "./env.js";
import postgres from "postgres";
import { runtimeRoleCredentials } from "./runtime-role-credentials.js";

/** Administrative CLI only. Runtime processes never import this module. */
async function provision(): Promise<void> {
  const credentials = runtimeRoleCredentials(process.env);
  const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await client.begin(async tx => {
      for (const { role, password } of credentials) {
        const [current] = await tx`select rolname from pg_roles where rolname=${role}
          and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolinherit`;
        if (!current) throw new Error("Aplique a migração de roles restritas antes do provisionamento");
        // PostgreSQL quotes both the fixed identifier and the password as SQL data.
        // The generated statement is never printed or passed through a shell.
        const [statement] = await tx`select format('ALTER ROLE %I LOGIN PASSWORD %L', ${role}::text, ${password}::text) as ddl`;
        await tx.unsafe(statement!.ddl as string);
      }
    });
    console.log("Credenciais provisionadas: predioon_app, predioon_identity, predioon_broker_auth.");
  } finally { await client.end(); }
}

try { await provision(); }
catch {
  // Driver errors can include a query containing a password. Never print them.
  console.error("Falha ao provisionar credenciais. Confira as quatro variáveis DATABASE_URL*, a conexão administrativa e a migração 015.");
  process.exitCode = 1;
}
