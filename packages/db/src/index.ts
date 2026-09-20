import "./env.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

/**
 * Owner connection: migrations, seed and the ingest service.
 * It bypasses RLS by design — ingestion writes telemetry for every building.
 * The API must use `withUserContext` from ./context.js instead.
 */
const client = postgres(process.env.DATABASE_URL ?? "postgres://predioon:predioon@localhost:5434/predioon");
export const db = drizzle(client, { schema });
export const sqlClient = client;

/** Transaction handle of the owner connection, used by the ingest service. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export * from "./schema.js";
export * from "./context.js";
