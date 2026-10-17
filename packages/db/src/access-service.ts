import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { createRuntimeSqlClient } from "./runtime-connection.js";
import type { DatabaseTransaction } from "./transaction.js";

export const accessServiceSqlClient = createRuntimeSqlClient("DATABASE_URL_ACCESS_SERVICE", "predioon_access_service", 10);
export const accessServiceDb = drizzle(accessServiceSqlClient, { schema });
export type AccessServiceTransaction = DatabaseTransaction;

export async function closeAccessServiceDb(): Promise<void> {
  await accessServiceSqlClient.end({ timeout: 5 });
}

export * from "./features.js";
export * from "./access-service-operations.js";
export type { DatabaseTransaction } from "./transaction.js";
export { verifyRestrictedDatabaseRole } from "./runtime-connection.js";
