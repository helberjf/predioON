import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The only keys the ingestion runtime may receive. The central .env carries the
 * owner and other workloads' credentials, so it is never read here.
 */
export const INGEST_RUNTIME_KEYS = [
  "DATABASE_URL_INGEST", "DATABASE_URL_ACCESS_SERVICE",
  "MQTT_URL", "MQTT_USERNAME", "MQTT_PASSWORD", "MQTT_CLIENT_ID", "MQTT_CA_FILE", "MQTT_CERT_FILE", "MQTT_KEY_FILE",
  "GATEWAY_OFFLINE_TIMEOUT_SECONDS", "DEVICE_OFFLINE_TIMEOUT_SECONDS", "OFFLINE_SWEEP_INTERVAL_SECONDS", "ALERT_WEBHOOK_URL",
] as const;

// Absent file is fine when the container injects the variables directly.
const runtimeFile = fileURLToPath(new URL("../.env.runtime", import.meta.url));
if (existsSync(runtimeFile)) {
  const values = parse(readFileSync(runtimeFile));
  const allowed = new Set<string>(INGEST_RUNTIME_KEYS);
  // Name the key, never its value: a misplaced owner URL must not reach a log.
  const foreign = Object.keys(values).filter(key => !allowed.has(key));
  if (foreign.length) throw new Error(`services/ingest/.env.runtime contém chaves não permitidas: ${foreign.join(", ")}`);
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
}
