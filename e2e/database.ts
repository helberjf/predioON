import postgres, { type Sql } from "postgres";

/** A fresh bounded owner connection only for exact-ID fixture setup/teardown.
 * Browser requests still use the real API and its restricted runtime roles. */
export async function withFixtureDatabase<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const runtime = new URL(process.env.DATABASE_URL_APP ?? "postgres://predioon_app:predioon_app@localhost:5436/predioon");
  const owner = new URL(process.env.DATABASE_URL ?? "postgres://predioon:predioon@localhost:5436/predioon");
  const localPostgres = (url: URL) => ["postgres:", "postgresql:"].includes(url.protocol)
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.search && !url.hash;
  if (!localPostgres(owner) || !localPostgres(runtime) || (owner.port || "5432") !== (runtime.port || "5432") || owner.pathname !== runtime.pathname) {
    throw new Error("A fixture SQL E2E exige DATABASE_URL no mesmo banco e porta loopback de DATABASE_URL_APP, sem parâmetros adicionais.");
  }
  const sql = postgres(owner.toString(), { max: 1, connect_timeout: 10 });
  try { return await run(sql); }
  finally { await sql.end({ timeout: 5 }); }
}
