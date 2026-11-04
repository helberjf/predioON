import { ApiError, type WebSessionCoordinator, type MfaRestriction } from "@predioon/api-client";

type State = { epoch: string; blocked: boolean; authorizationEpoch?: string; restriction?: MfaRestriction };
type LockProvider = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
type Environment = {
  namespace: string;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  locks?: LockProvider;
  newId(): string;
  subscribe(listener: () => void): () => void;
  publish(): void;
};
const changed = () => new ApiError(0, "A sessão mudou em outra aba. Tente novamente.", "SESSION_CHANGED");
const unsupported = () => new ApiError(0, "Este navegador precisa permitir armazenamento local e bloqueios entre abas para entrar com segurança. Use uma versão atual em HTTPS ou localhost.", "BROWSER_UNSUPPORTED");

/** Persisted values separate identity epoch, authorization epoch and logout intent.
 * Restriction hints change authorization only; they never replace family identity.
 * A hint never proves MFA or grants access; the API remains authoritative.
 * Intents are written synchronously; the last intent wins. Network cookie changes
 * all hold the same Web Lock, including body consumption and identity checks. */
export function createWebSessionCoordinator(environment: Environment): WebSessionCoordinator & { dispose(): void } {
  const key = `predioon.web-session.${environment.namespace}`;
  const listeners = new Set<(available: boolean, restriction?: MfaRestriction) => void>();
  let current: State | null = null;
  let cleanedLegacy = false;
  function supported() { if (!environment.locks) throw unsupported(); }
  function read(): State {
    try {
      if (!cleanedLegacy) {
        environment.storage.removeItem("predioon.access");
        environment.storage.removeItem("predioon.refresh");
        cleanedLegacy = true;
      }
      supported();
      const raw = environment.storage.getItem(key);
      if (!raw) return { epoch: "initial", blocked: false };
      const parsed = JSON.parse(raw) as Partial<State>;
      if (typeof parsed.epoch !== "string" || !parsed.epoch || typeof parsed.blocked !== "boolean") throw unsupported();
      if (parsed.restriction !== undefined && parsed.restriction !== "enrollment-required"
        && parsed.restriction !== "verification-required") throw unsupported();
      if ((parsed.restriction === undefined) !== (parsed.authorizationEpoch === undefined)) throw unsupported();
      if (parsed.authorizationEpoch !== undefined && (typeof parsed.authorizationEpoch !== "string" || !parsed.authorizationEpoch)) throw unsupported();
      if (parsed.blocked && parsed.restriction !== undefined) throw unsupported();
      return { epoch: parsed.epoch, blocked: parsed.blocked,
        ...(parsed.restriction ? { restriction: parsed.restriction, authorizationEpoch: parsed.authorizationEpoch } : {}) };
    } catch { throw unsupported(); }
  }
  function sync(): boolean {
    const next = read();
    const previous = current;
    current = next;
    if (!previous) return false;
    const identityChanged = next.epoch !== previous.epoch || next.blocked !== previous.blocked;
    if (identityChanged) {
      // A different family/intent invalidates everything even if it has a hint.
      for (const listener of listeners) listener(!next.blocked);
    } else if (next.authorizationEpoch !== previous.authorizationEpoch || next.restriction !== previous.restriction) {
      if (next.restriction) for (const listener of listeners) listener(!next.blocked, next.restriction);
    }
    // Authorization changes notify consumers without aborting bootstrap/auth gates.
    return identityChanged;
  }
  function write(next: State) {
    try { environment.storage.setItem(key, JSON.stringify(next)); }
    catch { throw unsupported(); }
    current = next;
    environment.publish();
  }
  function assertCurrent() { if (sync()) throw changed(); }
  function block() {
    // Explicit identity changes must work even after this tab missed an event.
    sync();
    write({ epoch: environment.newId(), blocked: true });
  }
  const unsubscribe = environment.subscribe(() => {
    try { sync(); }
    catch { for (const listener of listeners) listener(false); }
  });
  return {
    assertCurrent,
    blocked() { assertCurrent(); return current!.blocked; },
    beginIdentityChange: block,
    blockSession: block,
    recheckSession(restriction) {
      // A delayed rejection cannot override a newer login/logout intent.
      assertCurrent();
      if (current!.blocked) throw changed();
      if (restriction !== "enrollment-required" && restriction !== "verification-required") throw unsupported();
      write({ epoch: current!.epoch, blocked: false, authorizationEpoch: environment.newId(), restriction });
    },
    gate(kind) {
      assertCurrent();
      const snapshot = current!;
      const assertSnapshot = () => {
        assertCurrent();
        if (current!.epoch !== snapshot.epoch || current!.blocked !== snapshot.blocked) throw changed();
      };
      return operation => environment.locks!.request(key, async () => {
        assertSnapshot();
        if (kind === "refresh" && snapshot.blocked) throw new ApiError(401, "Entre novamente para continuar.");
        const result = await operation();
        assertSnapshot();
        if (kind === "login") write({ epoch: snapshot.epoch, blocked: false });
        return result;
      });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { unsubscribe(); listeners.clear(); },
  };
}

/** Browser integration stays outside the shared native/API transport. */
export function browserSessionCoordinator(baseUrl: string): ReturnType<typeof createWebSessionCoordinator> {
  const origin = typeof location === "undefined" ? "unavailable" : location.origin;
  const namespace = webSessionNamespace(origin, baseUrl);
  const channelName = `predioon.web-session.${namespace}`;
  let channel: BroadcastChannel | null = null;
  // Node also exposes BroadcastChannel; create it only inside a browser document.
  if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel(channelName); } catch { /* Storage events and synchronous epoch checks remain available. */ }
  }
  const coordinator = createWebSessionCoordinator({
    namespace,
    storage: {
      getItem: key => globalThis.localStorage.getItem(key),
      setItem: (key, value) => globalThis.localStorage.setItem(key, value),
      removeItem: key => globalThis.localStorage.removeItem(key),
    },
    locks: globalThis.navigator?.locks,
    newId: () => crypto.randomUUID(),
    subscribe: listener => {
      if (typeof window === "undefined") return () => {};
      const onStorage = (event: StorageEvent) => { if (event.key === channelName || event.key === null) listener(); };
      channel?.addEventListener("message", listener);
      window.addEventListener("storage", onStorage);
      window.addEventListener("pageshow", listener);
      window.addEventListener("focus", listener);
      return () => {
        channel?.removeEventListener("message", listener);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("pageshow", listener);
        window.removeEventListener("focus", listener);
      };
    },
    publish: () => channel?.postMessage({ type: "session-state-changed" }),
  });
  return { ...coordinator, dispose() { coordinator.dispose(); channel?.close(); } };
}

export function webSessionNamespace(portalOrigin: string, baseUrl: string): string {
  return encodeURIComponent(`${portalOrigin}|${new URL(baseUrl, portalOrigin === "unavailable" ? undefined : portalOrigin).origin}`);
}
