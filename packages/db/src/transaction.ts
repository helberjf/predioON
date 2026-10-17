import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";

/** Structural transaction contract; importing this type never constructs a pool. */
export type DatabaseTransaction = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];
