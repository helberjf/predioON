import "./env.js";
import postgres from "postgres";
import { runtimeDatabaseUrl } from "./runtime-connection.js";

/** One purpose-specific client. This entrypoint never constructs an owner pool. */
export function createNotificationSqlClient(onclose: () => void): postgres.Sql {
  try {
    return postgres(runtimeDatabaseUrl("DATABASE_URL_NOTIFICATIONS", "predioon_notifications"), {
      max: 1, connect_timeout: 5, idle_timeout: 0, onclose, onnotice: () => {},
    });
  } catch {
    throw new Error("DATABASE_URL_NOTIFICATIONS: configuração de banco restrita inválida");
  }
}

export { verifyRestrictedDatabaseRole } from "./runtime-connection.js";
