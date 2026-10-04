import { setImmediate } from "node:timers/promises";
import type { AttemptResult } from "./protocol.js";

/** NOTIFY coalesces into a hint. Every timed poll still reads the durable queue. */
export class NotificationWakeup {
  private pending = false;
  private waiting?: () => void;
  notify(): void {
    this.pending = true;
    this.waiting?.();
  }
  async wait(signal: AbortSignal, intervalMs = 1_000): Promise<void> {
    if (signal.aborted) return;
    if (this.pending) { this.pending = false; return; }
    await new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        this.waiting = undefined;
        this.pending = false;
        resolve();
      };
      const timer = setTimeout(done, intervalMs);
      this.waiting = done;
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  }
}

export async function notificationLoop(
  signal: AbortSignal,
  wakeup: NotificationWakeup,
  runOne: () => Promise<AttemptResult>,
  record: (result: AttemptResult) => Promise<void>,
): Promise<void> {
  while (!signal.aborted) {
    const result = await runOne();
    await record(result);
    if (signal.aborted) break;
    if (["empty", "database_error", "aborted"].includes(result)) await wakeup.wait(signal);
    // Always end and yield between deliveries; a shared acquisition cannot
    // repeatedly bypass the administrator waiting for the exclusive barrier.
    else await setImmediate();
  }
}
