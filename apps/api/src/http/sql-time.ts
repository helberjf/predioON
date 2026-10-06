import { sql, type SQL } from "drizzle-orm";

/**
 * Raw SQL rows carry timestamps in PostgreSQL's text form, which strict
 * JavaScript engines (Hermes on the mobile apps) do not parse. Format them as
 * ISO-8601 UTC with milliseconds, exactly what `Date.prototype.toISOString` emits.
 */
export const isoTime = (column: SQL): SQL =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
