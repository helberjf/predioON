import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { createRuntimeSqlClient } from "./runtime-connection.js";

export const brokerAuthSqlClient = createRuntimeSqlClient("DATABASE_URL_BROKER_AUTH", "predioon_broker_auth", 5);
export const brokerAuthDb = drizzle(brokerAuthSqlClient, { schema });
export async function closeBrokerAuthDb(): Promise<void> { await brokerAuthSqlClient.end({ timeout: 5 }); }
