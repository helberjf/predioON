#!/usr/bin/env node
// Administrative CLI: projects the ingestion service's runtime file from the
// central administrative .env. The runtime never imports this module; it reads
// only services/ingest/.env.runtime, which must not carry the owner or any other
// workload's credentials.
//
//   node scripts/write-ingest-runtime-env.mjs [--source .env] [--target services/ingest/.env.runtime]
import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

/** Same allowlist as services/ingest/src/env.ts. */
export const INGEST_RUNTIME_KEYS = [
  "DATABASE_URL_INGEST", "DATABASE_URL_ACCESS_SERVICE",
  "MQTT_URL", "MQTT_USERNAME", "MQTT_PASSWORD", "MQTT_CLIENT_ID", "MQTT_CA_FILE", "MQTT_CERT_FILE", "MQTT_KEY_FILE",
  "GATEWAY_OFFLINE_TIMEOUT_SECONDS", "DEVICE_OFFLINE_TIMEOUT_SECONDS", "OFFLINE_SWEEP_INTERVAL_SECONDS", "ALERT_WEBHOOK_URL",
];
const services = [["DATABASE_URL_INGEST", "predioon_ingest"], ["DATABASE_URL_ACCESS_SERVICE", "predioon_access_service"]];
const forbiddenParameters = ["role", "options", "session_authorization", "user", "database", "client_encoding"];

/** Validates one restricted URL; errors name the variable, never its value. */
function target(environment, variable, role) {
  const invalid = () => new Error(`${variable}: use uma URL PostgreSQL com a role ${role}`);
  let url;
  try { url = new URL(environment[variable] ?? ""); } catch { throw invalid(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.password || url.pathname.length < 2) throw invalid();
  for (const [parameter, value] of url.searchParams) {
    if (parameter.includes("\0") || value.includes("\0") || forbiddenParameters.includes(parameter.trim().toLowerCase())) throw invalid();
  }
  try {
    if (decodeURIComponent(url.username) !== role) throw invalid();
    decodeURIComponent(url.password); decodeURIComponent(url.pathname);
  } catch { throw invalid(); }
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

/** Pure projection: the allowlisted keys present in `input`, validated before any write. */
export function projectIngestRuntimeEnvironment(input) {
  const [ingest, access] = services.map(([variable, role]) => target(input, variable, role));
  if (ingest !== access) throw new Error("DATABASE_URL_INGEST e DATABASE_URL_ACCESS_SERVICE devem apontar para o mesmo banco");
  const lines = INGEST_RUNTIME_KEYS.filter(key => input[key] !== undefined && input[key] !== "").map(key => {
    const value = input[key];
    if (/[\r\n"]/.test(value)) throw new Error(`${key}: valor com quebra de linha ou aspas não é suportado`);
    return `${key}="${value}"`;
  });
  return `# Gerado por scripts/write-ingest-runtime-env.mjs. Não versionar.\n${lines.join("\n")}\n`;
}

/** Creates `targetPath` exclusively; an existing different file is left untouched. */
export function writeIngestRuntimeEnvironment(sourcePath, targetPath) {
  const content = projectIngestRuntimeEnvironment(parseEnv(readFileSync(sourcePath, "utf8")));
  if (existsSync(targetPath)) {
    if (readFileSync(targetPath, "utf8") === content) return "unchanged";
    throw new Error(`${targetPath} já existe com outra configuração; revise-o ou remova-o manualmente antes de gerar de novo`);
  }
  // Write a private temporary file, then hard-link it into place: the link fails
  // if the target appeared meanwhile, so nobody ever sees a partial file.
  const temporary = join(dirname(targetPath), `.env.runtime.${randomUUID()}.tmp`);
  writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
  try { linkSync(temporary, targetPath); } finally { unlinkSync(temporary); }
  return "created";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const option = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
  const sourcePath = resolve(root, option("--source") ?? ".env");
  const targetPath = resolve(root, option("--target") ?? "services/ingest/.env.runtime");
  try {
    const result = writeIngestRuntimeEnvironment(sourcePath, targetPath);
    console.log(result === "created" ? "Ambiente da ingestão criado em services/ingest/.env.runtime." : "Ambiente da ingestão já estava atualizado.");
  } catch (error) {
    // Messages above never include values; a filesystem error may include only paths.
    console.error(error instanceof Error ? error.message : "Falha ao gerar o ambiente da ingestão");
    process.exitCode = 1;
  }
}
