import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Connection used by the API. It is a NON-OWNER role, so PostgreSQL row level security
 * actually applies to it (the owner would bypass every policy).
 */
const appClient = postgres(
  process.env.DATABASE_URL_APP ?? "postgres://predioon_app:predioon_app@localhost:5433/predioon",
  { max: 10 },
);

export const appDb = drizzle(appClient, { schema });

export type AppTransaction = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

export type UserContext = {
  userId: string;
  role: "PLATFORM_ADMIN" | "BUILDING_ADMIN" | "RESIDENT";
};

/**
 * Runs `fn` inside a transaction whose PostgreSQL settings identify the current user.
 * The policies in infrastructure/001-timescale-rls.sql read these settings through
 * app_current_user_id() and app_is_platform_admin().
 *
 * Every authenticated query must go through here: forgetting a WHERE building_id
 * then returns zero rows instead of leaking another building's data.
 */
export async function withUserContext<T>(
  context: UserContext,
  fn: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${context.userId}, true),
                 set_config('app.role', ${context.role}, true)`,
    );
    return fn(tx);
  });
}

export async function closeAppDb(): Promise<void> {
  await appClient.end();
}
