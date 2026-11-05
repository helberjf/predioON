import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function safePath(path) {
  return typeof path === 'string' && !isAbsolute(path) && !/[\\\r\n\0:]/.test(path)
    && !path.split('/').some(part => ['', '.', '..', '.git', '.env', 'node_modules'].includes(part));
}
export function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }).trim();
}
export function tree(repo, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Exact commit required');
  const bytes = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '-z', '--full-tree', commit], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return bytes.toString('utf8').split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' '), path = record.slice(tab + 1);
    if (tab < 0 || !safePath(path) || type !== 'blob' || !['100644', '100755'].includes(mode) || !/^[0-9a-f]{40}$/.test(oid)) throw new Error(`Unsupported Git path/type/mode: ${path}`);
    return { path, mode, gitObject: oid };
  });
}

/** One owned Git process. Binary payload is consumed by byte count, never UTF8. */
export function blobs(repo) {
  const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Git cat-file exited ${code}`))); });
  exit.catch(() => undefined);
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
  const iterator = child.stdout[Symbol.asyncIterator]();
  let chunk = Buffer.alloc(0), offset = 0;
  async function available() {
    if (offset < chunk.length) return;
    const next = await iterator.next();
    if (next.done) throw new Error(`Unexpected Git EOF ${diagnostic}`);
    chunk = next.value; offset = 0;
  }
  async function byte() { await available(); return chunk[offset++]; }
  return {
    async read(oid) {
      if (!/^[0-9a-f]{40}$/.test(oid)) throw new Error('Only inventoried Git object IDs are accepted');
      if (!child.stdin.write(oid + '\n')) await once(child.stdin, 'drain');
      const header = [];
      for (;;) { const value = await byte(); if (value === 10) break; if (header.length > 256) throw new Error('Invalid Git header'); header.push(value); }
      const match = /^([0-9a-f]{40}) blob ([0-9]+)$/.exec(Buffer.from(header).toString('ascii'));
      if (!match || match[1] !== oid) throw new Error('Git object response mismatch');
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size > 64 * 1024 * 1024) throw new Error('Unexpected oversized source blob');
      const result = Buffer.allocUnsafe(size);
      let written = 0;
      while (written < size) {
        await available();
        const count = Math.min(size - written, chunk.length - offset);
        chunk.copy(result, written, offset, offset + count); offset += count; written += count;
      }
      if (await byte() !== 10) throw new Error('Invalid Git blob separator');
      return result;
    },
    async close() { child.stdin.end(); await exit; },
    abort() { child.kill(); },
  };
}
