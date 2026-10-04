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
        const [current] = await tx`select r.rolname from pg_roles r where r.rolname=${role}
          and not r.rolsuper and not r.rolbypassrls and not r.rolcreatedb and not r.rolcreaterole and not r.rolinherit and not r.rolreplication
          and not exists(select 1 from pg_auth_members m where m.member=r.oid or (r.rolname='predioon_notifications' and m.roleid=r.oid))
          and not exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=r.oid and d.deptype='o')`;
        if (!current) throw new Error("Aplique a migração de roles restritas antes do provisionamento");
        // PostgreSQL quotes both the fixed identifier and the password as SQL data.
        // The generated statement is never printed or passed through a shell.
        const [statement] = await tx`select format('ALTER ROLE %I LOGIN PASSWORD %L', ${role}::text, ${password}::text) as ddl`;
        await tx.unsafe(statement!.ddl as string);
      }
    });
    console.log("Credenciais provisionadas: predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications.");
  } finally { await client.end(); }
}

try { await provision(); }
catch {
  // Driver errors can include a query containing a password. Never print them.
  console.error("Falha ao provisionar credenciais. Confira as cinco variáveis DATABASE_URL*, a conexão administrativa e as migrations 015/038.");
  process.exitCode = 1;
}
