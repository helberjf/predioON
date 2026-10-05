/** Optional encrypted transport. Plaintext and exceptions never belong in CI output. */
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, fsyncSync, lstatSync, openSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LOG = 2 * 1024 * 1024;
export const MAX_ENVELOPE = 3 * 1024 * 1024;
export const RECIPIENT_KEY_ID = 'f792f93f45f280e421b4d5f643de2523d17f8a909be69bb34bb4bb48af28b8b2';
const ALGORITHM = 'RSA-OAEP-SHA256+A256GCM';
const LABEL = Buffer.from('predioon/ios-runner-build/v1');
const fail = () => { throw new Error('Invalid private diagnostic'); };
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value)) === JSON.stringify(expected);
const canonical = value => Buffer.from(JSON.stringify(value) + '\n');

export function validateContext(value) {
  if (!keys(value, ['repository', 'sha', 'runId', 'runAttempt', 'stage', 'exitCode']) || value.repository !== 'helberjf/predioON' ||
      typeof value.sha !== 'string' || !/^[a-f0-9]{40}$/.test(value.sha) ||
      typeof value.runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value.runId) ||
      typeof value.runAttempt !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value.runAttempt) ||
      value.stage !== 'runner-build' || !Number.isInteger(value.exitCode) || value.exitCode === 0 || Math.abs(value.exitCode) > 255) fail();
  return value;
}

function publicRecipient(pem) {
  if (typeof pem !== 'string' || pem.length > 8192 || !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/.test(pem.replaceAll('\r\n', '\n'))) fail();
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 4096 || key.asymmetricKeyDetails?.publicExponent !== 65537n) fail();
  return { key, id: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex') };
}

function header(keyId, context) {
  return { version: 1, algorithm: ALGORITHM, keyId, context: validateContext(context) };
}

export function seal(plaintext, publicPem, context) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length < 1 || plaintext.length > MAX_LOG) fail();
  const recipient = publicRecipient(publicPem);
  const metadata = header(recipient.id, context);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(canonical(metadata));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = publicEncrypt({ key: recipient.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: LABEL }, key);
    return canonical({ ...metadata, iv: iv.toString('base64'), wrappedKey: wrappedKey.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  } finally { key.fill(0); }
}

function decode(value, length, cap = length) {
  if (typeof value !== 'string' || value.length > Math.ceil(cap / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < length || bytes.length > cap || bytes.toString('base64') !== value) fail();
  return bytes;
}

export function inspectEnvelope(encoded, expected, publicPem) {
  validateContext(expected);
  if (!Buffer.isBuffer(encoded) || encoded.length > MAX_ENVELOPE) fail();
  const item = JSON.parse(encoded.toString('utf8'));
  if (!keys(item, ['version', 'algorithm', 'keyId', 'context', 'iv', 'wrappedKey', 'ciphertext', 'tag']) ||
      !canonical(item).equals(encoded) || item.version !== 1 || item.algorithm !== ALGORITHM ||
      typeof item.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(item.keyId) ||
      !canonical(validateContext(item.context)).equals(canonical(expected))) fail();
  if (publicPem !== undefined && publicRecipient(publicPem).id !== item.keyId) fail();
  decode(item.iv, 12); decode(item.wrappedKey, 512); decode(item.ciphertext, 1, MAX_LOG); decode(item.tag, 16);
  return item;
}

export function openEnvelope(encoded, privatePem, expected) {
  const privateKey = typeof privatePem === 'object' && privatePem?.type === 'private' ? privatePem : createPrivateKey(privatePem);
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const item = inspectEnvelope(encoded, expected, publicPem);
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: LABEL }, decode(item.wrappedKey, 512));
  let partial;
  try {
    if (key.length !== 32) fail();
    const decipher = createDecipheriv('aes-256-gcm', key, decode(item.iv, 12), { authTagLength: 16 });
    decipher.setAAD(canonical(header(item.keyId, item.context)));
    decipher.setAuthTag(decode(item.tag, 16));
    partial = decipher.update(decode(item.ciphertext, 1, MAX_LOG));
    return Buffer.concat([partial, decipher.final()]);
  } finally { key.fill(0); partial?.fill(0); }
}

function noLinkedParents(path) {
  let parent = dirname(resolve(path));
  while (true) {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

function writeNew(path, bytes) {
  noLinkedParents(path);
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); }
  catch { closeSync(fd); unlinkSync(path); fail(); }
  closeSync(fd);
}

export function writePlaintext(encoded, privatePem, expected, output, environment = process.env) {
  if ('GITHUB_ACTIONS' in environment || 'GITHUB_RUN_ID' in environment) fail();
  const bytes = openEnvelope(encoded, privatePem, expected);
  try { writeNew(output, bytes); }
  finally { bytes.fill(0); }
}

function readBounded(path, cap) {
  noLinkedParents(path);
  if (lstatSync(path).isSymbolicLink()) fail();
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > cap) fail();
    const buffer = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < buffer.length) { const count = readSync(fd, buffer, total, buffer.length - total, null); if (!count) break; total += count; }
    const after = fstatSync(fd);
    const linked = lstatSync(path);
    if (linked.isSymbolicLink() || linked.dev !== after.dev || linked.ino !== after.ino || total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail();
    return buffer.subarray(0, total);
  } finally { closeSync(fd); }
}

async function main() {
  if (!process.versions.node.startsWith('24.')) fail();
  const base = dirname(fileURLToPath(import.meta.url));
  const root = resolve(base, '../..');
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'seal' && args.length === 0 && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_OS === 'macOS') {
    const context = validateContext(JSON.parse(process.env.IOS_DIAGNOSTIC_CONTEXT ?? 'null'));
    const publicPem = readBounded(join(base, 'diagnostic-recipient-public.pem'), 8192).toString('utf8');
    if (publicRecipient(publicPem).id !== RECIPIENT_KEY_ID) fail();
    const chunks = []; let total = 0;
    for await (const chunk of process.stdin) { total += chunk.length; if (total > MAX_LOG) fail(); chunks.push(chunk); }
    const plaintext = Buffer.concat(chunks);
    try { writeNew(join(root, '.local/ios-auth/encrypted-diagnostic/runner-build.envelope.json'), seal(plaintext, publicPem, context)); }
    finally { plaintext.fill(0); for (const chunk of chunks) chunk.fill(0); }
  } else if (mode === 'open' && args.length === 4 && !('GITHUB_ACTIONS' in process.env) && !('GITHUB_RUN_ID' in process.env)) {
    // Local operator must provision a private directory/NTFS ACL first. No plaintext stdout.
    const [envelopePath, privateKeyPath, expectedPath, outputPath] = args;
    const key = readBounded(privateKeyPath, 8192);
    try { writePlaintext(readBounded(envelopePath, MAX_ENVELOPE), key, validateContext(JSON.parse(readBounded(expectedPath, 4096).toString('utf8'))), outputPath); }
    finally { key.fill(0); }
  } else fail();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Private diagnostic unavailable\n'); process.exitCode = 1; });
}
