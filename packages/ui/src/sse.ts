import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@predioon/shared";
import { api, tokens } from "./api.js";
import { startRealtimeConnection } from "./realtime-connection.js";
import { createFetchEventSource } from "./fetch-event-source.js";

type Options = { enabled?: boolean };

/** A failed stream validates the session and reconnects with the current token. */
export function useRealtime(onEvent: (event: RealtimeEvent) => void, { enabled = true }: Options = {}): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    return startRealtimeConnection({
      accessToken: tokens.access,
      validateSession: () => api.get("/auth/me"),
      openStream: access => createFetchEventSource(`${api.baseUrl}/events/stream`, access),
      schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
      onConnection: setConnected,
      onEvent: event => handler.current(event),
    });
  }, [enabled]);
  return connected;
}
