import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Liveness of the ingestion process for the container health check. Every
 * interval the process records whether its MQTT session is connected and its
 * database answers; the probe (health.ts) accepts only a recent, complete
 * record from a live process. Same design as the notifications worker.
 */
export type IngestHeartbeat = { version: 1; pid: number; checkedAt: string; mqtt: boolean; database: boolean };
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_MAX_AGE_MS = 30_000;

export function heartbeatPath(environment: Record<string, string | undefined> = process.env): string {
  return resolve(environment.INGEST_HEALTH_FILE || resolve(tmpdir(), "predioon-ingest-health.json"));
}

export async function writeHeartbeat(path: string, state: Omit<IngestHeartbeat, "version" | "pid" | "checkedAt">, now = new Date()): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  const record: IngestHeartbeat = { version: 1, pid: process.pid, checkedAt: now.toISOString(), mqtt: state.mqtt, database: state.database };
  try {
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function healthyHeartbeat(path: string, now = Date.now()): Promise<boolean> {
  try {
    const source = await readFile(path, "utf8");
    if (source.length > 1_024) return false;
    const state = JSON.parse(source) as IngestHeartbeat;
    if (state.version !== 1 || !Number.isSafeInteger(state.pid) || state.pid < 1 || typeof state.checkedAt !== "string"
      || Object.keys(state).sort().join(",") !== "checkedAt,database,mqtt,pid,version") return false;
    if (state.mqtt !== true || state.database !== true) return false;
    const checked = Date.parse(state.checkedAt);
    if (!Number.isFinite(checked) || now - checked > HEARTBEAT_MAX_AGE_MS || checked - now > 1_000) return false;
    process.kill(state.pid, 0);
    return true;
  } catch { return false; }
}

/** Starts the periodic record; the returned function stops it and removes this process's file. */
export function startHeartbeat(isConnected: () => boolean, pingDatabase: () => Promise<unknown>, path = heartbeatPath(), intervalMs = HEARTBEAT_INTERVAL_MS): () => Promise<void> {
  let running: Promise<void> = Promise.resolve();
  const beat = () => {
    running = (async () => {
      let database = false;
      try { await pingDatabase(); database = true; } catch { /* reported as database: false */ }
      try { await writeHeartbeat(path, { mqtt: isConnected(), database }); } catch { /* the probe sees a stale file */ }
    })();
  };
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await running;
    try {
      const state = JSON.parse(await readFile(path, "utf8")) as IngestHeartbeat;
      if (state.pid === process.pid) await unlink(path);
    } catch { /* nothing of ours to remove */ }
  };
}
