import "./env.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

/**
 * Owner connection: migrations, seed and administrative CLIs only.
 * It bypasses RLS by design, so no runtime process may import it: the API uses
 * `withUserContext` from ./context.js and the ingestion service uses the two
 * restricted entrypoints `@predioon/db/ingest` and `@predioon/db/access-service`.
 */
const client = postgres(process.env.DATABASE_URL ?? "postgres://predioon:predioon@localhost:5434/predioon");
export const db = drizzle(client, { schema });
export const sqlClient = client;

/** Transaction handle of the owner connection, for administrative tooling. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export * from "./schema.js";
export type { AppTransaction, UserContext } from "./context.js";
export * from "./features.js";
