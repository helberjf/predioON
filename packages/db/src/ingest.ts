import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { createRuntimeSqlClient } from "./runtime-connection.js";
import type { DatabaseTransaction } from "./transaction.js";

export const ingestSqlClient = createRuntimeSqlClient("DATABASE_URL_INGEST", "predioon_ingest", 10);
export const ingestDb = drizzle(ingestSqlClient, { schema });
export type IngestTransaction = DatabaseTransaction;

export async function closeIngestDb(): Promise<void> {
  await ingestSqlClient.end({ timeout: 5 });
}

export {
  buildings, devices, gateways, ingestEvents, telemetry, alertRules, alerts,
  monitoringProfiles, usageCursors, dailyUsage, parkingLots, gates,
} from "./schema.js";
export * from "./ingest-projections.js";
export * from "./ingest-operations.js";
export * from "./features.js";
export type { DatabaseTransaction } from "./transaction.js";
export { verifyRestrictedDatabaseRole } from "./runtime-connection.js";
