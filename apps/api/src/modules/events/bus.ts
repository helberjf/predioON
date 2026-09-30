import { appSqlClient } from "@predioon/db/runtime";
import { REALTIME_CHANNEL, RealtimeEventSchema, type RealtimeEvent } from "@predioon/shared";

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();
let started = false;

/**
 * One PostgreSQL LISTEN for the whole process, fanned out in memory.
 * The ingest service is the only publisher (NOTIFY), so no extra broker sits between them.
 */
export async function startRealtimeBus(): Promise<void> {
  if (started) return;
  started = true;

  await appSqlClient.listen(REALTIME_CHANNEL, (payload) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const event = RealtimeEventSchema.safeParse(parsed);
    if (!event.success) return;
    for (const listener of listeners) listener(event.data);
  });

  console.log(`Barramento de tempo real ouvindo "${REALTIME_CHANNEL}".`);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
