import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@predioon/shared";
import { api, tokens } from "./api.js";

type Options = { enabled?: boolean };

/**
 * Live feed of platform events. EventSource reconnects on its own, so the hook only
 * has to keep the handler fresh and tear the connection down on unmount.
 */
export function useRealtime(onEvent: (event: RealtimeEvent) => void, { enabled = true }: Options = {}): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const access = tokens.access();
    if (!enabled || !access) return;

    const source = new EventSource(`${api.baseUrl}/events/stream?access_token=${encodeURIComponent(access)}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const forward = (event: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(event.data) as RealtimeEvent);
      } catch {
        // frame malformado: ignorar em vez de derrubar o painel
      }
    };

    for (const kind of ["telemetry", "alert", "device-status", "gateway-status"]) {
      source.addEventListener(kind, forward as EventListener);
    }

    return () => {
      source.close();
      setConnected(false);
    };
  }, [enabled]);

  return connected;
}
