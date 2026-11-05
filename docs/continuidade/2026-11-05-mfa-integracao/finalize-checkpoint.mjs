import { readFile, writeFile, mkdir, access, copyFile, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, safePath, git, tree, blobs } from './git-blobs.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const keys = ['--base-checkout', '--base-commit', '--output'];
if (keys.some(key => !args.get(key)) || [...args.keys()].some(key => !keys.includes(key))) throw new Error('Required: --base-checkout PATH --base-commit SHA40 --output NEW_EXTERNAL_PATH');
const base = await realpath(resolve(args.get('--base-checkout'))), requested = resolve(args.get('--output'));
const output = join(await realpath(dirname(requested)), basename(requested));
const folded = path => process.platform === 'win32' ? path.toLowerCase() : path;
for (const denied of [base, here]) if (folded(output) === folded(denied) || folded(output).startsWith(folded(denied + sep))) throw new Error('Output must be new and outside base/package');
const inventory = JSON.parse(await readFile(join(here, 'INVENTORY.json'), 'utf8'));
const commit = args.get('--base-commit');
if (commit !== inventory.approvedBaseCommit || git(base, 'rev-parse', 'HEAD') !== commit) throw new Error('Wrong approved published base commit');
if (git(base, 'diff', 'HEAD', '--name-only')) throw new Error('Base tracked checkout must be clean while finalizing');
const reader = blobs(base), baseFreeze = [];
try {
  for (const entry of tree(base, commit).filter(entry => !entry.path.startsWith('docs/'))) {
    const bytes = await reader.read(entry.gitObject);
    // Raw is diagnostic only. Restoring never compares or copies checkout bytes.
    baseFreeze.push({ ...entry, sha256: digest(bytes), observedRawSha256: digest(await readFile(join(base, entry.path))) });
  }
  await reader.close();
} catch (error) { reader.abort(); throw error; }
const indexed = new Map(baseFreeze.map(row => [row.path, row]));
const publishedDependencies = [];
const publicationAllowlist = ['apps/api/src/auth/mfa-query.ts', 'apps/api/test/mfa-query.test.ts'];
const files = [];
for (const original of inventory.files) {
  const file = { ...original };
  if (!safePath(file.path) || !safePath(file.payload) || file.path.includes('baseline-reproducer')) throw new Error('Unsafe candidate path');
  const actual = indexed.get(file.path);
  if (publicationAllowlist.includes(file.path) && actual?.sha256 === file.afterSha256) {
    publishedDependencies.push({ path: file.path, sha256: actual.sha256 }); continue;
  }
  if (file.kind !== 'qa-explicit' && (actual?.sha256 ?? null) !== file.beforeGitSha256) throw new Error(`Canonical before mismatch: ${file.path}`);
  file.beforeObservedRawSha256 = file.beforeSha256;
  file.beforeSha256 = file.beforeGitSha256;
  delete file.beforeGitSha256; delete file.beforeGitObject;
  if (digest(await readFile(join(here, file.payload))) !== file.afterSha256) throw new Error(`Payload drift: ${file.path}`);
  files.push(file);
}
if (publishedDependencies.length !== 2) throw new Error('Both reviewed query files must already be published');
if (git(base, 'rev-parse', 'HEAD') !== commit) throw new Error('Head changed during packaging');
try { await access(output); throw new Error('Output exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output);
for (const file of files) { await mkdir(dirname(join(output, file.payload)), { recursive: true }); await copyFile(join(here, file.payload), join(output, file.payload)); }
const qaPaths = ['qaSupport/renderer/package.json', 'qaSupport/renderer/tsconfig.json', 'qaSupport/renderer/DEPENDENCIES.json', 'qaSupport/renderer/prepare-renderer.mjs', 'qaSupport/renderer/README.md'];
const qaSupport = [];
for (const path of qaPaths) {
  const bytes = await readFile(join(here, path));
  await mkdir(dirname(join(output, path)), { recursive: true }); await writeFile(join(output, path), bytes);
  qaSupport.push({ path, sha256: digest(bytes) });
}
const manifest = { version: 2, status: 'PARTIAL_CANDIDATE_NOT_FOR_ROLLOUT', baseCommit: commit,
  sourceRepresentation: 'Exact canonical Git blob bytes and executable mode; no CRLF/LF text normalization',
  files, baseFreeze, publishedDependencies, qaSupport, excludes: inventory.excluded,
  rawCanonicalDifferences: baseFreeze.filter(row => row.sha256 !== row.observedRawSha256).map(row => row.path) };
await writeFile(join(output, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
const metadata = ['restore-checkpoint.mjs', 'git-blobs.mjs', 'README.md', '.gitattributes'];
for (const path of metadata) await copyFile(join(here, path), join(output, path));
const integrity = {};
for (const path of ['MANIFEST.json', ...metadata]) integrity[path] = digest(await readFile(join(output, path)));
await writeFile(join(output, 'PACKAGE-HASHES.json'), JSON.stringify(integrity, null, 2) + '\n');
console.log(JSON.stringify({ output, baseCommit: commit, runtimeFiles: files.filter(row => row.kind !== 'qa-explicit').length,
  explicitQaFiles: files.filter(row => row.kind === 'qa-explicit').length, qaSupportFiles: qaSupport.length,
  canonicalBaseFiles: baseFreeze.length, rawCanonicalDifferences: manifest.rawCanonicalDifferences,
  manifestSha256: integrity['MANIFEST.json'] }, null, 2));
