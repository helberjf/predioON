import "./env.js";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
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

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `Configuração inválida no .env:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
  );
}

export const config = parsed.data;
