import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { createRuntimeSqlClient } from "./runtime-connection.js";

export const identitySqlClient = createRuntimeSqlClient("DATABASE_URL_IDENTITY", "predioon_identity", 10);
export const identityDb = drizzle(identitySqlClient, { schema });
export async function closeIdentityDb(): Promise<void> { await identitySqlClient.end({ timeout: 5 }); }
