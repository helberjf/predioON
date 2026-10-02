import type { RealtimeEvent } from "@predioon/shared";

export type RealtimeSource = {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
  addEventListener(kind: string, callback: (event: { data: string }) => void): void;
};
type Options = {
  accessToken(): string | null;
  validateSession(): Promise<unknown>;
  openStream(token: string): RealtimeSource;
  schedule(callback: () => void, delay: number): () => void;
  onConnection(connected: boolean): void;
  onEvent(event: RealtimeEvent): void;
};

/** One connection owns its callbacks. Session validation uses the HTTP client's shared refresh. */
export function startRealtimeConnection(options: Options): () => void {
  let stopped = false, failures = 0;
  let source: RealtimeSource | null = null, cancelTimer: (() => void) | null = null;

  function retry(): void {
    if (stopped || cancelTimer || !options.accessToken()) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    cancelTimer = options.schedule(() => {
      cancelTimer = null;
      if (stopped || !options.accessToken()) return;
      void options.validateSession().then(() => { if (!stopped) connect(); }).catch(() => retry());
    }, delay);
  }
  function connect(): void {
    if (stopped || source) return;
    const token = options.accessToken();
    if (!token) return;
    let current: RealtimeSource;
    try { current = options.openStream(token); }
    catch { retry(); return; }
    source = current;
    const ownsConnection = () => !stopped && source === current;
    current.onopen = () => {
      if (!ownsConnection()) return;
      failures = 0; options.onConnection(true);
    };
    current.onerror = () => {
      if (!ownsConnection()) return;
      source = null; current.close(); options.onConnection(false); retry();
    };
    for (const kind of ["telemetry", "alert", "device-status", "gateway-status", "features-changed"]) {
      current.addEventListener(kind, event => {
        if (!ownsConnection()) return;
        let parsed: RealtimeEvent;
        try { parsed = JSON.parse(event.data) as RealtimeEvent; } catch { return; }
        options.onEvent(parsed);
      });
    }
  }
  connect();
  return () => {
    stopped = true;
    cancelTimer?.(); cancelTimer = null;
    source?.close(); source = null;
    options.onConnection(false);
  };
}
