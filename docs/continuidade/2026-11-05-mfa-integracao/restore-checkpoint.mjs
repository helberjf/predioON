import { readFile, writeFile, mkdir, access, realpath, chmod } from 'node:fs/promises';
import { dirname, basename, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, safePath, git, tree, blobs } from './git-blobs.mjs';
const here = dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--base-checkout' || args[2] !== '--output') throw new Error('Usage: --base-checkout REPOSITORY_WITH_PINNED_COMMIT --output NEW_EXTERNAL_PATH');
const base = await realpath(resolve(args[1])), requested = resolve(args[3]);
const output = join(await realpath(dirname(requested)), basename(requested));
const folded = path => process.platform === 'win32' ? path.toLowerCase() : path;
for (const denied of [base, here]) if (folded(output) === folded(denied) || folded(output).startsWith(folded(denied + sep))) throw new Error('Output must be outside base and package');
const headBefore = git(base, 'rev-parse', 'HEAD');
const integrity = JSON.parse(await readFile(join(here, 'PACKAGE-HASHES.json'), 'utf8'));
for (const [path, expected] of Object.entries(integrity)) if (!safePath(path) || digest(await readFile(join(here, path))) !== expected) throw new Error(`Package metadata mismatch: ${path}`);
const manifest = JSON.parse(await readFile(join(here, 'MANIFEST.json'), 'utf8'));
if (manifest.version !== 2) throw new Error('Canonical package V2 required');
const actualTree = new Map(tree(base, manifest.baseCommit).filter(row => !row.path.startsWith('docs/')).map(row => [row.path, row]));
if (actualTree.size !== manifest.baseFreeze.length) throw new Error('Canonical tree count mismatch');
for (const row of manifest.baseFreeze) {
  const actual = actualTree.get(row.path);
  if (!safePath(row.path) || actual?.gitObject !== row.gitObject || actual?.mode !== row.mode) throw new Error(`Pinned tree mismatch: ${row.path}`);
}
const indexed = new Map(manifest.baseFreeze.map(row => [row.path, row]));
for (const file of manifest.files) {
  if (!safePath(file.path) || !safePath(file.payload) || file.path.includes('baseline-reproducer')) throw new Error('Unsafe candidate path');
  if (digest(await readFile(join(here, file.payload))) !== file.afterSha256) throw new Error(`Candidate mismatch: ${file.path}`);
  if (file.kind !== 'qa-explicit' && (indexed.get(file.path)?.sha256 ?? null) !== file.beforeSha256) throw new Error(`Canonical patch base mismatch: ${file.path}`);
}
for (const row of manifest.qaSupport) if (!safePath(row.path) || digest(await readFile(join(here, row.path))) !== row.sha256) throw new Error('QA support mismatch');
try { await access(output); throw new Error('Output exists; no overwrite'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output);
const reader = blobs(base);
try {
  for (const row of manifest.baseFreeze) {
    const bytes = await reader.read(row.gitObject);
    if (digest(bytes) !== row.sha256) throw new Error(`Canonical blob hash mismatch: ${row.path}`);
    const dest = join(output, row.path);
    await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, bytes); await chmod(dest, parseInt(row.mode, 8) & 0o777);
  }
  await reader.close();
} catch (error) { reader.abort(); throw error; }
for (const file of manifest.files) {
  const dest = join(output, file.path); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, await readFile(join(here, file.payload)));
  if (digest(await readFile(dest)) !== file.afterSha256) throw new Error(`Restored candidate mismatch: ${file.path}`);
}
for (const row of manifest.qaSupport) { const dest = join(output, row.path); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, await readFile(join(here, row.path))); }
const changed = new Set(manifest.files.map(row => row.path));
for (const row of manifest.baseFreeze) if (!changed.has(row.path) && digest(await readFile(join(output, row.path))) !== row.sha256) throw new Error(`Restored base mismatch: ${row.path}`);
if (git(base, 'rev-parse', 'HEAD') !== headBefore) throw new Error('Source repository HEAD changed concurrently; inspect receipt');
await writeFile(join(output, 'MFA-RESTORE-RECEIPT.json'), JSON.stringify({ baseCommit: manifest.baseCommit, sourceHeadBefore: headBefore,
  canonicalBaseFiles: manifest.baseFreeze.length, candidateFiles: manifest.files.length, qaSupportFiles: manifest.qaSupport.length,
  status: 'SOURCE_ONLY_NOT_TESTED_NOT_APPLIED', dependenciesInstalled: false, migrationsApplied: false, databaseStarted: false }, null, 2) + '\n');
console.log('Canonical Git source and candidate payloads restored. No dependencies/tests/services/migrations executed.');
