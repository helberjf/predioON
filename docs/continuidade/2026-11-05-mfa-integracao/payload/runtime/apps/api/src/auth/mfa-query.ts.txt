import { getTableColumns, sql, type GetColumnData, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export type MfaQueryProjection<T extends PgTable> = {
  [K in keyof T["_"]["columns"]]: SQL<GetColumnData<T["_"]["columns"][K]>>;
};

/** Preserve the table's DTO keys and decoders when FROM is an MFA SQL envelope.
 * Drizzle does not register a textual SQL alias as a table for Column selection.
 * SQL expressions retain those references without the table-membership check;
 * mapWith keeps timestamp/JSON decoding instead of trusting a raw execute cast.
 */
export function mfaQueryProjection<T extends PgTable>(table: T): MfaQueryProjection<T> {
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [
    key,
    sql`${column}`.mapWith(column),
  ])) as MfaQueryProjection<T>;
}
