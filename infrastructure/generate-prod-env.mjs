import { randomBytes, generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// No force option: rerunning must never rotate an installed platform's keys.
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(process.argv[2] ?? resolve(root, "infrastructure/.env.prod"));
const template = await readFile(new URL(".env.prod.example", import.meta.url), "utf8");
const pair = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const values = Object.fromEntries([
  "POSTGRES_PASSWORD", "APP_DB_PASSWORD", "IDENTITY_DB_PASSWORD", "BROKER_AUTH_DB_PASSWORD",
  "NOTIFICATIONS_DB_PASSWORD", "INGEST_DB_PASSWORD", "ACCESS_SERVICE_DB_PASSWORD",
  "AUTH_RATE_LIMIT_KEY", "MFA_ENCRYPTION_KEY", "MQTT_INGEST_PASSWORD", "EMQX_DASHBOARD_PASSWORD", "MQTT_AUTH_SECRET",
].map(key => [key, randomBytes(48).toString("base64url")]));
values.JWT_ACTIVE_KID = "primary-" + new Date().toISOString().slice(0, 10);
values.JWT_PRIVATE_KEY = "'" + pair.privateKey.replaceAll("\n", "\\n") + "'";
values.JWT_PUBLIC_KEYS = "'" + JSON.stringify({ [values.JWT_ACTIVE_KID]: pair.publicKey }) + "'";
const output = template.replace(/^([A-Z][A-Z0-9_]*)=.*$/gm, (line, key) => key in values ? key + "=" + values[key] : line);
try {
  await writeFile(destination, output, { flag: "wx", mode: 0o600 });
  console.log("Ambiente criado com permissão 600. Edite domínio, e-mail e MQTT_CERTS_DIR antes do setup: " + destination);
} catch (error) {
  if (error?.code === "EEXIST") console.error("Destino já existe; nenhuma chave foi substituída.");
  else console.error("Não foi possível gravar o ambiente; confira o diretório e suas permissões.");
  process.exitCode = 1;
}
