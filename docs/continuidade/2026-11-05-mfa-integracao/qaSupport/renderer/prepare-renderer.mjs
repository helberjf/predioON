// Explicit source/dependency staging only; no installation, renderer or test run.
import { readFile, writeFile, mkdir, realpath, access, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, basename, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== '--restored-source' || args[2] !== '--dependency-checkout' || args[4] !== '--output') throw new Error('Required: --restored-source PATH --dependency-checkout PATH --output NEW_PATH');
const source = await realpath(resolve(args[1])), dependencies = await realpath(resolve(args[3]));
const requested = resolve(args[5]), output = join(await realpath(dirname(requested)), basename(requested));
const folded = path => process.platform === 'win32' ? path.toLowerCase() : path;
for (const forbidden of [source, dependencies, here]) if (folded(output) === folded(forbidden) || folded(output).startsWith(folded(forbidden + sep))) throw new Error('QA output must be new and external');
const config = JSON.parse(await readFile(join(here, 'DEPENDENCIES.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (digest(await readFile(join(dependencies, 'pnpm-lock.yaml'))) !== config.pnpmLockSha256) throw new Error('Installed dependency checkout lock differs');
if (Number(process.versions.node.split('.')[0]) !== config.nodeMajor) throw new Error('Use the recorded Node major');
const mobileRequire = createRequire(join(dependencies, 'packages/mobile/package.json'));
const uiRequire = createRequire(join(dependencies, 'packages/ui/package.json'));
const reactPackage = mobileRequire.resolve('react/package.json');
const rendererPackage = mobileRequire.resolve('react-test-renderer/package.json');
const rendererRequire = createRequire(rendererPackage);
const tsxPackage = join(dependencies, `node_modules/.pnpm/tsx@${config.tsx}/node_modules/tsx/package.json`);
const tsxRequire = createRequire(tsxPackage);
const esbuildPackage = tsxRequire.resolve('esbuild/package.json');
const esbuildRequire = createRequire(esbuildPackage);
const expected = [
  [reactPackage, config.react], [rendererPackage, config.reactTestRenderer],
  [rendererRequire.resolve('react-is/package.json'), config.reactIs],
  [rendererRequire.resolve('scheduler/package.json'), config.scheduler],
  [tsxPackage, config.tsx], [esbuildPackage, config.esbuild],
  [esbuildRequire.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`), config.esbuild],
  [uiRequire.resolve('lucide-react/package.json'), config.lucide],
];
const versions = [];
for (const [path, version] of expected) {
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  if (pkg.version !== version) throw new Error(`Installed ${pkg.name} version differs from recorded ${version}`);
  versions.push({ name: pkg.name, version: pkg.version });
}
if (await realpath(rendererRequire.resolve('react/package.json')) !== await realpath(reactPackage)) throw new Error('Renderer resolves a different React singleton');
const lucide = await readFile(join(dirname(uiRequire.resolve('lucide-react/package.json')), 'dist/cjs/lucide-react.js'));
if (digest(lucide) !== config.lucideCjsSha256) throw new Error('Lucide CJS artifact differs');
try { await access(output); throw new Error('Output exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output);
const sourceFreeze = [];
for (const path of config.sourcePaths) {
  if (path.includes('..') || path.includes('node_modules') || !path.startsWith('packages/')) throw new Error('Unexpected QA source path');
  const bytes = await readFile(join(source, path));
  await mkdir(dirname(join(output, path)), { recursive: true }); await writeFile(join(output, path), bytes);
  sourceFreeze.push({ path, sha256: digest(bytes) });
}
await mkdir(join(output, 'test'));
for (const name of ['browser-fixture.ts', 'mfa-ceremony.render.test.tsx']) {
  const bytes = await readFile(join(source, 'qa/render-v6/test', name));
  await writeFile(join(output, 'test', name), bytes); sourceFreeze.push({ path: `test/${name}`, sha256: digest(bytes) });
}
for (const name of ['package.json', 'tsconfig.json']) await writeFile(join(output, name), await readFile(join(here, name)));
await mkdir(join(output, 'node_modules/@predioon'), { recursive: true });
const link = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
for (const [name, packagePath] of [['react', reactPackage], ['react-test-renderer', rendererPackage], ['tsx', tsxPackage]]) {
  await link(dirname(packagePath), join(output, 'node_modules', name));
}
for (const name of ['api-client', 'contracts']) await link(join(output, 'packages', name), join(output, 'node_modules/@predioon', name));
await mkdir(join(output, 'node_modules/lucide-react'));
await writeFile(join(output, 'node_modules/lucide-react/index.cjs'), lucide);
await writeFile(join(output, 'node_modules/lucide-react/package.json'), JSON.stringify({ name: 'lucide-react', version: config.lucide, main: 'index.cjs' }) + '\n');
const qaRequire = createRequire(join(output, 'package.json'));
const iconRequire = createRequire(join(output, 'node_modules/lucide-react/package.json'));
if (await realpath(qaRequire.resolve('react/package.json')) !== await realpath(iconRequire.resolve('react/package.json'))) throw new Error('QA icons resolve another React');
await writeFile(join(output, 'RENDER-STAGING.json'), JSON.stringify({ status: 'STAGED_NOT_EXECUTED', node: process.versions.node,
  versions, sourceFreeze, command: config.command, limits: config.limit }, null, 2) + '\n');
console.log('Renderer QA staged only. Run its recorded command separately after resource authorization.');
