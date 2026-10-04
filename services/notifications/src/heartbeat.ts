import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AttemptResult } from "./protocol.js";

export type Heartbeat = { version: 1; pid: number; completedAt: string; outcome: AttemptResult };
export function heartbeatPath(environment: Record<string, string | undefined> = process.env): string {
  return resolve(environment.NOTIFICATION_HEALTH_FILE || resolve(tmpdir(), "predioon-notifications-health.json"));
}

export async function writeHeartbeat(path: string, outcome: AttemptResult): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  const state: Heartbeat = { version: 1, pid: process.pid, completedAt: new Date().toISOString(), outcome };
  try {
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

/** A separate probe checks an actual recent loop, not merely database connectivity. */
export async function healthyHeartbeat(path: string, now = Date.now()): Promise<boolean> {
  try {
    const source = await readFile(path, "utf8");
    if (source.length > 1_024) return false;
    const state = JSON.parse(source) as Heartbeat;
    if (state.version !== 1 || !Number.isSafeInteger(state.pid) || state.pid < 1 || typeof state.completedAt !== "string" ||
        !["empty", "delivered", "retry", "failed", "cancelled", "no_destination", "stale"].includes(state.outcome) ||
        Object.keys(state).sort().join(",") !== "completedAt,outcome,pid,version") return false;
    const completed = Date.parse(state.completedAt);
    if (!Number.isFinite(completed) || now - completed > 30_000 || completed - now > 1_000) return false;
    process.kill(state.pid, 0);
    return true;
  } catch { return false; }
}

export async function removeHeartbeat(path: string): Promise<void> {
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as Heartbeat;
    if (state.pid === process.pid) await unlink(path);
  } catch { /* A failed start or another process's heartbeat is not ours. */ }
}
