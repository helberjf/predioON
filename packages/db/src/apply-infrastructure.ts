import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const composeFile = fileURLToPath(new URL("../../../infrastructure/docker-compose.yml", import.meta.url));
const sqlFile = new URL("../../../infrastructure/001-timescale-rls.sql", import.meta.url);
const script = await readFile(sqlFile, "utf8");

const result = spawnSync(
  "docker",
  [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "predioon",
    "-d",
    "predioon",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ],
  {
    cwd: rootDir,
    input: script,
    encoding: "utf8",
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Falha ao aplicar TimescaleDB/RLS. docker compose retornou ${result.status}.`);
}

console.log("TimescaleDB, índices e políticas RLS aplicados.");
