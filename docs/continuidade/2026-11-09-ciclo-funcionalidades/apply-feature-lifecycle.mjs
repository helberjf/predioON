// Source-only portable overlay. It never installs, starts services or runs tests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const values = process.argv.slice(2);
assert.equal(values.length, 4, 'Use --candidate <restored1045> --output <fresh-directory>');
const args = new Map();
for (let i = 0; i < values.length; i += 2) {
  assert.ok(['--candidate', '--output'].includes(values[i]) && !args.has(values[i]));
  assert.ok(values[i + 1] && !values[i + 1].startsWith('--'));
  args.set(values[i], values[i + 1]);
}
assert.equal(args.size, 2);
const candidate = fs.realpathSync(path.resolve(args.get('--candidate')));
const output = path.resolve(args.get('--output'));
assert.ok(fs.statSync(candidate).isDirectory());
assert.ok(!fs.existsSync(output), 'Fresh output required; previous attempts are never overwritten');
assert.notEqual(candidate, output);
assert.ok(!output.startsWith(candidate + path.sep), 'Output cannot be inside candidate');
assert.ok(!candidate.startsWith(output + path.sep), 'Output cannot contain candidate');
assert.ok(!output.startsWith(packageRoot + path.sep), 'Output cannot be inside this package');

function relative(file) {
  assert.equal(typeof file, 'string');
  assert.ok(file && !path.isAbsolute(file) && !file.includes('\\'));
  assert.ok(!file.split('/').some(p => ['', '.', '..', 'node_modules', '.local', '.vite',
    '.vite-temp', '.cache', 'dist', '.env', '.env.runtime'].includes(p)));
  return file;
}
function safe(root, file) {
  const result = path.resolve(root, relative(file));
  assert.ok(result.startsWith(root + path.sep));
  return result;
}
function read(root, file) {
  const full = safe(root, file);
  assert.ok(fs.lstatSync(full).isFile() && !fs.lstatSync(full).isSymbolicLink());
  assert.ok(fs.realpathSync(full).startsWith(fs.realpathSync(root) + path.sep));
  return fs.readFileSync(full);
}
const packageFiles = JSON.parse(read(packageRoot, 'PACKAGE-HASHES.json'));
assert.equal(packageFiles.version, 1);
assert.equal(packageFiles.files.length, 5);
assert.equal(new Set(packageFiles.files.map(x => x.path)).size, 5);
for (const entry of packageFiles.files) {
  const bytes = read(packageRoot, entry.path);
  assert.equal(sha(bytes), entry.sha256, 'Package bytes changed: ' + entry.path);
  assert.equal(bytes.length, entry.bytes);
}
assert.ok(packageFiles.files.some(x => x.path === 'apply-feature-lifecycle.mjs'));
assert.ok(packageFiles.files.some(x => x.path === 'MANIFEST.json'));
assert.ok(packageFiles.files.some(x => x.path === 'README.md'));
assert.ok(packageFiles.files.some(x => x.path === '.gitattributes'));
const manifestBytes = read(packageRoot, 'MANIFEST.json');
const m = JSON.parse(manifestBytes);
assert.equal(m.version, 1);
assert.equal(m.status, 'SOURCE_ONLY_API_FEATURE_LIFECYCLE_OVERLAY_NOT_PRODUCTION');
assert.equal(m.parent.preparedSha256, 'c0d7479ab81c04667e1ed75e79275fab05e849a9d5c252e989514f713edec7be');
assert.equal(m.target.preparedSha256, '3a5f530aadbea9a098f9c27f841d8f67773b0184941fc72430809f8aabb5e786');
assert.equal(m.parent.composedFreeze.length, 1045);
assert.equal(m.target.composedFreeze.length, 1045);
assert.equal(m.overlays.length, 1);
const expectedPaths = ['apps/api/test/features-lifecycle.test.ts'];
assert.equal(m.runtimeProductModified, false);
assert.equal(m.qaPayloads, 1);
assert.equal(m.productCandidatePayloads, 0);
assert.deepEqual(m.overlays.map(x => x.path).sort(), expectedPaths);
assert.deepEqual(packageFiles.files.filter(x => x.path.startsWith('payload/')).map(x => x.path).sort(),
  m.overlays.map(x => x.payload).sort());
const target = new Map(m.target.composedFreeze.map(x => [relative(x.file), x]));
const parent = new Map(m.parent.composedFreeze.map(x => [relative(x.file), x]));
assert.equal(parent.size, 1045); assert.equal(target.size, 1045);
const expected = new Map(parent);
for (const [file, entry] of parent) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  const bytes = read(candidate, file);
  assert.equal(sha(bytes), entry.sha256, 'Restored parent differs: ' + file);
  assert.equal(bytes.length, entry.bytes);
}
for (const overlay of m.overlays) {
  assert.equal(parent.get(overlay.path)?.sha256 ?? null, overlay.beforeSha256);
  assert.equal(parent.get(overlay.path)?.bytes ?? null, overlay.beforeBytes);
  const bytes = read(packageRoot, overlay.payload);
  assert.equal(sha(bytes), overlay.afterSha256);
  assert.equal(bytes.length, overlay.afterBytes);
  if (overlay.beforeSha256 === null) assert.ok(!fs.existsSync(safe(candidate, overlay.path)));
  expected.set(overlay.path, { file: overlay.path, sha256: overlay.afterSha256, bytes: overlay.afterBytes });
}
assert.equal(expected.size, 1045);
assert.deepEqual([...expected.keys()].sort(), [...target.keys()].sort());
for (const [file, entry] of expected) assert.deepEqual(entry, target.get(file));

// Validation precedes the first mutation. Copy only the explicit1045 inventory;
// no traversal, dotenv, node_modules, cache, media or support-directory copying.
fs.mkdirSync(output, { recursive: false });
for (const [file, entry] of parent) {
  const bytes = read(candidate, file);
  assert.equal(sha(bytes), entry.sha256, 'Parent changed before copy: ' + file);
  const destination = safe(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  fs.chmodSync(destination, fs.statSync(safe(candidate, file)).mode & 0o777);
}
for (const overlay of m.overlays) {
  const bytes = read(packageRoot, overlay.payload);
  assert.equal(sha(bytes), overlay.afterSha256, 'Payload changed before copy');
  const destination = safe(output, overlay.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: overlay.beforeSha256 === null ? 'wx' : 'w' });
}
for (const [file, entry] of target) {
  const bytes = read(output, file);
  assert.equal(sha(bytes), entry.sha256, 'Final target mismatch: ' + file);
  assert.equal(bytes.length, entry.bytes);
}
for (const [file, entry] of parent) assert.equal(sha(read(candidate, file)), entry.sha256, 'Input parent changed');
const receipt = {
  version: 1, status: 'SOURCE_ONLY_NOT_TESTED_NOT_APPLIED', recordedUtc: new Date().toISOString(),
  manifestSha256: sha(manifestBytes), packageHashesSha256: sha(read(packageRoot, 'PACKAGE-HASHES.json')),
  parentPreparedSha256: m.parent.preparedSha256, targetPreparedSha256: m.target.preparedSha256,
  parentFilesVerified: 1045, overlaysVerified: 1, targetFilesVerified: 1045,
  targetInventorySha256: sha(Buffer.from(JSON.stringify(m.target.composedFreeze))),
  parentBeforeAfterUnchanged: true, targetHashComparisonPassed: true,
  sourceFilesOnly: true, dependenciesCopied: false, cachesCopied: false, environmentCopied: false,
  dependenciesInstalled: false, migrationsApplied: false, servicesStarted: false, testsExecuted: false,
  productionAccepted: false,
};
fs.writeFileSync(path.join(output, 'API-FEATURE-LIFECYCLE-RESTORE-RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));
