import "./env.js";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://predioon:predioon@localhost:5432/predioon";
const sql = postgres(url, { max: 1, connect_timeout: 3 });

for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    await sql`select 1 as ready`;
    console.log("PostgreSQL pronto.");
    await sql.end();
    process.exit(0);
  } catch {
    process.stdout.write(`Aguardando PostgreSQL (${attempt}/30)...\r`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

await sql.end();
throw new Error("PostgreSQL não ficou disponível em 30 segundos.");
