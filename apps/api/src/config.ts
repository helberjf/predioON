import "./env.js";
import { z } from "zod";
import { parseTrustedProxyCidrs } from "./http/trusted-proxies.js";
import { loginBudgetSecret } from "./auth/login-budget-secret.js";

function runtimeUrlSchema(role: string) {
  const required = z.string().min(1);
  return process.env.NODE_ENV === "production" ? required : required.default(`postgres://${role}:${role}@localhost:5434/predioon`);
}

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL_APP: runtimeUrlSchema("predioon_app"),
  DATABASE_URL_IDENTITY: runtimeUrlSchema("predioon_identity"),
  DATABASE_URL_BROKER_AUTH: runtimeUrlSchema("predioon_broker_auth"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JWT_ACTIVE_KID: z.string().min(1).optional(),
  JWT_PRIVATE_KEY: z.string().min(1).optional(),
  JWT_PUBLIC_KEYS: z.string().min(1).optional(),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174,http://localhost:5175"),
  TRUST_PROXY_CIDRS: z.string().optional(),
  AUTH_RATE_LIMIT_KEY: z.string().optional(),
  MQTT_AUTH_SECRET: z.string().min(32).optional(),
  MQTT_INGEST_USERNAME: z.string().default("predioon_ingest"),
  MQTT_INGEST_PASSWORD: z.string().min(1).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Configuração inválida no .env:\n${details.join("\n")}`);
}

const signingConfigured = [parsed.data.JWT_ACTIVE_KID, parsed.data.JWT_PRIVATE_KEY, parsed.data.JWT_PUBLIC_KEYS].every(Boolean);
if (!signingConfigured && (parsed.data.NODE_ENV === "production" || [parsed.data.JWT_ACTIVE_KID, parsed.data.JWT_PRIVATE_KEY, parsed.data.JWT_PUBLIC_KEYS].some(Boolean))) {
  throw new Error("JWT_ACTIVE_KID, JWT_PRIVATE_KEY e JWT_PUBLIC_KEYS são obrigatórios juntos");
}

export const config = {
  ...parsed.data,
  authRateLimitKey: loginBudgetSecret(parsed.data.AUTH_RATE_LIMIT_KEY, parsed.data.NODE_ENV),
  trustedProxyCidrs: parseTrustedProxyCidrs(parsed.data.TRUST_PROXY_CIDRS),
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
};
