import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const external = new Set();
for (const name of ["package.json", "../../packages/db/package.json", "../../packages/contracts/package.json", "../../packages/shared/package.json"]) {
  const manifest = JSON.parse(await readFile(resolve(root, name), "utf8"));
  for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
    if (!version.startsWith("workspace:")) external.add(dependency);
  }
}

// Vercel's TypeScript transform does not package workspace source exports.
// Inline our workspaces; keep regular packages (including native Argon2) traceable.
await build({
  absWorkingDir: root,
  entryPoints: ["src/app.ts"],
  outfile: "dist/vercel.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: [...external],
  logLevel: "info",
});
