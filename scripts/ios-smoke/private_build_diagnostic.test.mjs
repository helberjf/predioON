import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seal, openEnvelope, inspectEnvelope, writePlaintext, validateContext, MAX_LOG, RECIPIENT_KEY_ID } from './private_build_diagnostic.mjs';

// Disposable test keys only. Never load the workstation recipient's private key.
const pair = generateKeyPairSync('rsa', { modulusLength: 4096, publicExponent: 65537 });
const other = generateKeyPairSync('rsa', { modulusLength: 4096, publicExponent: 65537 });
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const context = { repository: 'helberjf/predioON', sha: 'a'.repeat(40), runId: '123', runAttempt: '1', stage: 'runner-build', exitCode: 70 };
const secret = Buffer.from('private-password/DSN/token ::error::\n\u0000á🔥 stderr');
const encoded = seal(secret, publicPem, context);
const rewrite = change => { const item = JSON.parse(encoded); change(item); return Buffer.from(JSON.stringify(item) + '\n'); };

test('real RSA4096/AES-GCM round trip preserves all bytes and randomizes each envelope', () => {
  assert.deepEqual(openEnvelope(encoded, privatePem, context), secret);
  const second = JSON.parse(seal(secret, publicPem, context));
  const first = JSON.parse(encoded);
  for (const field of ['iv', 'wrappedKey', 'ciphertext', 'tag']) assert.notEqual(first[field], second[field]);
  assert.equal(encoded.includes(secret), false);
  assert.equal(inspectEnvelope(encoded, context, publicPem).context.exitCode, 70);
});

test('context is closed, bounded, and does not accept caller-chosen repository or stages', () => {
  for (const patch of [{ repository: 'other/repo' }, { sha: 'bad' }, { runId: '../secret' }, { runAttempt: '0' }, { stage: 'runner-test' }, { exitCode: 0 }, { exitCode: true }, { extra: 'secret' }]) {
    assert.throws(() => validateContext({ ...context, ...patch }));
  }
  for (const patch of [{ sha: 'b'.repeat(40) }, { runId: '124' }, { runAttempt: '2' }, { exitCode: 65 }]) {
    assert.throws(() => openEnvelope(encoded, privatePem, { ...context, ...patch }));
  }
});

test('only bounded nonempty buffers and a public RSA4096 SPKI are admitted', () => {
  for (const payload of [Buffer.alloc(0), Buffer.alloc(MAX_LOG + 1), 'secret']) assert.throws(() => seal(payload, publicPem, context));
  const weak = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' });
  for (const key of [privatePem, publicPem + publicPem, 'secret', weak, ec]) assert.throws(() => seal(secret, key, context));
});

test('wrong recipient, key substitution and tampering in every authenticated part fail', () => {
  assert.throws(() => openEnvelope(encoded, other.privateKey, context));
  for (const field of ['iv', 'wrappedKey', 'ciphertext', 'tag']) {
    assert.throws(() => openEnvelope(rewrite(item => { const bytes = Buffer.from(item[field], 'base64'); bytes[0] ^= 1; item[field] = bytes.toString('base64'); }), privatePem, context));
  }
  assert.throws(() => openEnvelope(rewrite(item => { item.keyId = 'b'.repeat(64); }), privatePem, context));
  assert.throws(() => openEnvelope(rewrite(item => { item.context.runId = '124'; }), privatePem, { ...context, runId: '124' }));
});

test('rejects truncation, extra or duplicate keys, noncanonical JSON/base64 and short tags', () => {
  const invalid = [encoded.subarray(0, -5), Buffer.alloc(3 * 1024 * 1024 + 1), Buffer.from(' ' + encoded), Buffer.from(encoded.toString().replace('"version":1', '"version":1,"version":1'))];
  for (const mutate of [item => { item.extra = 'private'; }, item => { delete item.tag; }, item => { item.tag = Buffer.alloc(8).toString('base64'); }, item => { item.ciphertext += '\n'; }, item => { item.algorithm = 'none'; }, item => { item.version = 2; }]) invalid.push(rewrite(mutate));
  for (const value of invalid) assert.throws(() => openEnvelope(value, privatePem, context));
});

test('plaintext is created exclusively only after tag verification and never on failure', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ios-crypto-test-')));
  try {
    const output = join(directory, 'log.txt');
    assert.throws(() => writePlaintext(rewrite(item => { item.tag = Buffer.alloc(16).toString('base64'); }), privatePem, context, output, {}));
    assert.equal(existsSync(output), false);
    writePlaintext(encoded, privatePem, context, output, {});
    assert.deepEqual(readFileSync(output), secret);
    assert.throws(() => writePlaintext(encoded, privatePem, context, output, {}));
    assert.deepEqual(readFileSync(output), secret);
    assert.throws(() => writePlaintext(encoded, privatePem, context, join(directory, 'ci.txt'), { GITHUB_ACTIONS: 'true' }));
    assert.equal(existsSync(join(directory, 'ci.txt')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI cannot decrypt in CI and emits neither arguments nor exceptions', () => {
  const command = fileURLToPath(new URL('./private_build_diagnostic.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [command, 'open', 'private-password-path'], { env: { GITHUB_ACTIONS: 'true' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Private diagnostic unavailable\n');
});

test('exact maximum payload survives real encryption without truncation', () => {
  const payload = Buffer.alloc(MAX_LOG, 0x61);
  assert.deepEqual(openEnvelope(seal(payload, publicPem, context), privatePem, context), payload);
});

test('local CLI decrypts disposable test material only, silently and without overwriting', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ios-crypto-local-')));
  try {
    const source = join(directory, 'envelope.json');
    const key = join(directory, 'test-key.pem');
    const expected = join(directory, 'context.json');
    const output = join(directory, 'log.txt');
    writeFileSync(source, encoded, { mode: 0o600 });
    writeFileSync(key, privatePem, { mode: 0o600 });
    writeFileSync(expected, JSON.stringify(context), { mode: 0o600 });
    const args = [fileURLToPath(new URL('./private_build_diagnostic.mjs', import.meta.url)), 'open', source, key, expected, output];
    const blocked = spawnSync(process.execPath, args, { env: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123' }, encoding: 'utf8' });
    assert.notEqual(blocked.status, 0);
    assert.equal(blocked.stdout, '');
    assert.equal(blocked.stderr, 'Private diagnostic unavailable\n');
    assert.equal(existsSync(output), false);
    const first = spawnSync(process.execPath, args, { env: {}, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, '');
    assert.equal(first.stderr, '');
    assert.deepEqual(readFileSync(output), secret);
    const second = spawnSync(process.execPath, args, { env: {}, encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.equal(second.stdout, '');
    assert.equal(second.stderr, 'Private diagnostic unavailable\n');
    assert.deepEqual(readFileSync(output), secret);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('checked-in public recipient matches the pinned fingerprint without reading a private key', () => {
  const pem = readFileSync(new URL('./diagnostic-recipient-public.pem', import.meta.url), 'utf8');
  assert.equal(JSON.parse(seal(Buffer.from('test-only'), pem, context)).keyId, RECIPIENT_KEY_ID);
});

test('CLI refuses missing, malformed, private and unpinned public recipients without leaking data', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ios-crypto-policy-')));
  try {
    const scripts = join(directory, 'scripts', 'ios-smoke');
    mkdirSync(scripts, { recursive: true });
    const command = join(scripts, 'private_build_diagnostic.mjs');
    writeFileSync(command, readFileSync(new URL('./private_build_diagnostic.mjs', import.meta.url)));
    const destination = join(scripts, 'diagnostic-recipient-public.pem');
    const output = join(directory, '.local', 'ios-auth', 'encrypted-diagnostic');
    mkdirSync(output, { recursive: true });
    for (const pem of [undefined, 'SENTINEL-invalid-key', privatePem, publicPem]) {
      if (pem !== undefined) writeFileSync(destination, pem);
      const result = spawnSync(process.execPath, [command, 'seal'], {
        cwd: directory, input: secret, encoding: 'utf8',
        env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS', IOS_DIAGNOSTIC_CONTEXT: JSON.stringify(context) },
      });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Private diagnostic unavailable\n');
      assert.equal(existsSync(join(output, 'runner-build.envelope.json')), false);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('plaintext cannot follow a symbolic-link destination or parent', { skip: process.platform === 'win32' ? 'Windows symlink privileges are unavailable; POSIX test remains required' : false }, () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ios-crypto-links-')));
  try {
    const real = join(directory, 'real');
    mkdirSync(real);
    const linked = join(directory, 'linked');
    symlinkSync(real, linked, 'dir');
    assert.throws(() => writePlaintext(encoded, privatePem, context, join(linked, 'log.txt'), {}));
    assert.equal(existsSync(join(real, 'log.txt')), false);
    const target = join(real, 'existing.txt');
    writeFileSync(target, 'keep');
    const output = join(directory, 'log.txt');
    symlinkSync(target, output);
    assert.throws(() => writePlaintext(encoded, privatePem, context, output, {}));
    assert.equal(readFileSync(target, 'utf8'), 'keep');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
