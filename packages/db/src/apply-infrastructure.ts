/**
 * Applies every infrastructure/*.sql file in name order, inside the database container.
 * All scripts are idempotent, so this can be re-run after adding tables.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const composeFile = fileURLToPath(new URL("../../../infrastructure/docker-compose.yml", import.meta.url));
const infraDir = fileURLToPath(new URL("../../../infrastructure/", import.meta.url));

function runSql(script: string, label: string): void {
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "exec", "-T", "db",
     "psql", "-U", "predioon", "-d", "predioon", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { cwd: rootDir, input: script, encoding: "utf8" },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Falha ao aplicar ${label}. docker compose retornou ${result.status}.`);
  }
}

const files = (await readdir(infraDir)).filter((name) => name.endsWith(".sql")).sort();

for (const name of files) {
  console.log(`Aplicando ${name}...`);
  runSql(await readFile(new URL(name, `file://${infraDir}`), "utf8"), name);
}

console.log(`Infraestrutura aplicada (${files.length} script(s)): TimescaleDB, RLS e role da aplicação.`);
