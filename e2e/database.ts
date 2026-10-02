import postgres, { type Sql } from "postgres";
import { isDisposableDatabaseTarget, sameDatabaseTarget } from "./database-target";

/** A fresh bounded owner connection only for exact-ID fixture setup/teardown.
 * Browser requests still use the real API and its restricted runtime roles. */
export async function withFixtureDatabase<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const runtime = new URL(process.env.DATABASE_URL_APP ?? "postgres://predioon_app:predioon_app@localhost:5436/predioon");
  const owner = new URL(process.env.DATABASE_URL ?? "postgres://predioon:predioon@localhost:5436/predioon");
  if (!isDisposableDatabaseTarget(owner) || !isDisposableDatabaseTarget(runtime) || !sameDatabaseTarget(owner, runtime)) {
    throw new Error("A fixture SQL E2E exige owner/runtime no mesmo banco descartável: loopback local ou serviço postgres explícito do job GitHub, sem parâmetros adicionais.");
  }
  const sql = postgres(owner.toString(), { max: 1, connect_timeout: 10 });
  try { return await run(sql); }
  finally { await sql.end({ timeout: 5 }); }
}
