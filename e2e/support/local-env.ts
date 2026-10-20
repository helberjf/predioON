import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Picks up the disposable database written by `pnpm e2e:db up`. Variables already set
 * (CI, or a deliberate local override) win; database-target.ts still validates every URL. */
const file = resolve(__dirname, "../../.local/e2e.env");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
