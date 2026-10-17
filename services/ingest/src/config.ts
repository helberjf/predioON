import "./env.js";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL_INGEST: z.string().min(1),
  DATABASE_URL_ACCESS_SERVICE: z.string().min(1),
  MQTT_URL: z.string().min(1).default("mqtt://localhost:1883"),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().default("predioon-ingest"),
  MQTT_CA_FILE: z.string().optional(),
  MQTT_CERT_FILE: z.string().optional(),
  MQTT_KEY_FILE: z.string().optional(),
  GATEWAY_OFFLINE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  DEVICE_OFFLINE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  OFFLINE_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  ALERT_WEBHOOK_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
});

// The owner connection has no place in this process, not even unused.
if (process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL (conexão dona) não pode estar no ambiente da ingestão; use DATABASE_URL_INGEST e DATABASE_URL_ACCESS_SERVICE");
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `Configuração inválida da ingestão:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
  );
}

/** Host/port/database of a restricted URL; errors name the variable, never the value. */
function target(variable: "DATABASE_URL_INGEST" | "DATABASE_URL_ACCESS_SERVICE", role: string): string {
  let url: URL;
  try { url = new URL(parsed.data![variable]); } catch { throw new Error(`${variable} contém uma URL de banco inválida`); }
  let username: string;
  try { username = decodeURIComponent(url.username); } catch { throw new Error(`${variable} contém uma URL de banco inválida`); }
  if (username !== role) throw new Error(`${variable} deve usar a role ${role}`);
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

// Both workloads must reach the same database; the full URL boundary runs again
// inside the pool constructor, before the driver parses anything.
if (target("DATABASE_URL_INGEST", "predioon_ingest") !== target("DATABASE_URL_ACCESS_SERVICE", "predioon_access_service")) {
  throw new Error("DATABASE_URL_INGEST e DATABASE_URL_ACCESS_SERVICE devem apontar para o mesmo banco");
}

export const config = parsed.data;
