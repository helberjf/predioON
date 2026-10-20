// Banco descartável da suíte Playwright, num contêiner próprio em loopback.
//
//   node scripts/e2e-db.mjs up       cria (ou reaproveita) o contêiner, aplica migrations e seed
//   node scripts/e2e-db.mjs reset    apaga o contêiner e recria do zero
//   node scripts/e2e-db.mjs down     apaga o contêiner e o arquivo de ambiente
//   node scripts/e2e-db.mjs status   mostra o contêiner e a porta
//
// E2E_DB_PORT muda a porta (padrão 5446). A 5434 é do desenvolvimento e a 5436 já foi usada por
// outras sessões nesta máquina. O contêiner leva um label de posse: o script só reaproveita,
// reinicia ou apaga um contêiner que ele mesmo criou, nunca um homônimo de outra sessão.
// O resultado fica em .local/e2e.env, lido por playwright.config.ts e pelas fixtures.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";

const IMAGE = "timescale/timescaledb:2.17.2-pg16"; // mesma imagem do job browser.yml
const PORT = Number(process.env.E2E_DB_PORT ?? 5446);
const NAME = `predioon-playwright-db-${PORT}`;
const OWNER = "org.predioon.e2e-db=scripts/e2e-db.mjs";
const ENV_FILE = ".local/e2e.env";
const windows = process.platform === "win32";

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) fail("E2E_DB_PORT precisa ser uma porta entre 1024 e 65535.");

const url = role => role === "predioon"
  ? `postgres://predioon:predioon@127.0.0.1:${PORT}/predioon`
  : `postgres://${role}:${role}@127.0.0.1:${PORT}/predioon`;
// Todas as sete: os scripts do banco leem o .env da raiz, que aponta para o banco de desenvolvimento.
const environment = {
  DATABASE_URL: url("predioon"),
  DATABASE_URL_APP: url("predioon_app"),
  DATABASE_URL_IDENTITY: url("predioon_identity"),
  DATABASE_URL_BROKER_AUTH: url("predioon_broker_auth"),
  DATABASE_URL_NOTIFICATIONS: url("predioon_notifications"),
  DATABASE_URL_INGEST: url("predioon_ingest"),
  DATABASE_URL_ACCESS_SERVICE: url("predioon_access_service"),
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: windows, ...options });
  if (result.status !== 0) fail(`Falhou: ${command} ${args.join(" ")}`);
}

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) fail(`Docker indisponível ou comando recusado: docker ${args.join(" ")}\n${result.stderr ?? ""}`);
  return result.stdout.trim();
}

function containerState() {
  const state = docker(["ps", "-a", "--filter", `name=^${NAME}$`, "--format", "{{.State}}"]);
  if (state && !docker(["ps", "-a", "--filter", `name=^${NAME}$`, "--filter", `label=${OWNER}`, "--format", "{{.Names}}"])) {
    fail(`Já existe um contêiner ${NAME} que este script não criou. Não vou mexer nele: escolha outra porta com E2E_DB_PORT.`);
  }
  return state;
}

const portInUse = () => new Promise(resolve => {
  const socket = createConnection({ host: "127.0.0.1", port: PORT });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

function removeContainer() {
  if (containerState()) docker(["rm", "-f", "-v", NAME]);
  rmSync(ENV_FILE, { force: true });
}

async function up() {
  const state = containerState();
  if (state === "running") {
    console.log(`${NAME} já está rodando em 127.0.0.1:${PORT}; reaplicando migrations e seed.`);
  } else if (state) {
    docker(["start", NAME]);
  } else {
    if (await portInUse()) fail(`A porta ${PORT} já está ocupada por outro processo. Escolha outra com E2E_DB_PORT.`);
    docker(["run", "-d", "--name", NAME, "--label", OWNER, "--memory", "1g",
      "-e", "POSTGRES_USER=predioon", "-e", "POSTGRES_PASSWORD=predioon", "-e", "POSTGRES_DB=predioon",
      "-e", "TIMESCALEDB_TELEMETRY=off", "-p", `127.0.0.1:${PORT}:5432`, IMAGE]);
  }
  const env = { ...process.env, ...environment, NODE_ENV: "test", SEED_PHYSICAL_FEATURES: "enabled" };
  for (const script of ["db:wait", "db:bootstrap", "db:infra", "db:provision-runtime", "db:seed"]) run("pnpm", [script], { env });
  mkdirSync(".local", { recursive: true });
  writeFileSync(ENV_FILE, `# Gerado por scripts/e2e-db.mjs: banco descartável ${NAME}.\n`
    + Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  console.log(`Banco descartável pronto em 127.0.0.1:${PORT}. Ambiente salvo em ${ENV_FILE}.`);
}

const command = process.argv[2] ?? "up";
if (command === "up") await up();
else if (command === "reset") { removeContainer(); await up(); }
else if (command === "down") { removeContainer(); console.log(`${NAME} removido.`); }
else if (command === "status") console.log(containerState() ? `${NAME}: ${containerState()} em 127.0.0.1:${PORT}` : `${NAME} não existe.`);
else fail("Uso: node scripts/e2e-db.mjs up|reset|down|status");
