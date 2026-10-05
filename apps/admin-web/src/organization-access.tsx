import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { PlatformAuthorizationResponse } from "@predioon/contracts/tenancy";
import { api, ApiError, Button, Card, ErrorBanner, LoadingState, useAuth } from "@predioon/ui";

type Capabilities = PlatformAuthorizationResponse["capabilities"];
type Snapshot = { capabilities: Capabilities | null; checking: boolean; error: string | null; readEpoch: number; manageEpoch: number };
const reads = (capabilities: Capabilities | null) => capabilities?.includes("organizations:read") === true;
const manages = (capabilities: Capabilities | null) => reads(capabilities) && capabilities?.includes("organizations:manage") === true;

function capabilitiesFrom(value: PlatformAuthorizationResponse): Capabilities {
  if (!value || !Array.isArray(value.capabilities) || value.capabilities.some(key => typeof key !== "string")) {
    throw new Error("A API retornou uma autorização de clientes inválida.");
  }
  // The finite projection never grants another module, including future keys.
  return value.capabilities.filter(key => key === "organizations:read" || key === "organizations:manage");
}

/** A page-owned, awaitable authorization read. A refresh requested during a slow
 * read supersedes that result and queues one new read, without concurrent loops. */
function createOrganizationAccess(session: { isValid(): boolean }) {
  let snapshot: Snapshot = { capabilities: null, checking: true, error: null, readEpoch: 0, manageEpoch: 0 };
  let last: Capabilities | null = null;
  let active = false, running = false, desired = 0, started = 0;
  let resolveRead: ((value: Capabilities | null) => void) | null = null;
  const listeners = new Set<() => void>();
  const current = () => active && session.isValid();
  function publish(next: Snapshot) { snapshot = next; for (const listener of listeners) listener(); }
  function settle(value: Capabilities | null) { const resolve = resolveRead; resolveRead = null; resolve?.(value); }
  async function pump(): Promise<void> {
    if (!current() || running || started === desired) return;
    running = true;
    const expected = desired; started = expected;
    try {
      const capabilities = capabilitiesFrom(await api.get<PlatformAuthorizationResponse>("/v1/authorization/platform"));
      if (!current() || expected !== desired) return;
      publish({ capabilities, checking: false, error: null,
        readEpoch: snapshot.readEpoch + Number(reads(last) && !reads(capabilities)),
        manageEpoch: snapshot.manageEpoch + Number(manages(last) && !manages(capabilities)) });
      last = capabilities;
      settle(capabilities);
    } catch (cause) {
      if (!current() || expected !== desired) return;
      publish({ ...snapshot, capabilities: null, checking: false,
        error: cause instanceof Error ? cause.message : "Não foi possível verificar o acesso a clientes." });
      settle(null);
    } finally {
      running = false;
      if (current() && started !== desired) void pump();
    }
  }
  function refresh(): Promise<Capabilities | null> {
    if (!current()) return Promise.resolve(null);
    // An older preflight must finish without writing, even if its fetch is slow.
    settle(null); desired++;
    publish({ ...snapshot, checking: true, error: null });
    const result = new Promise<Capabilities | null>(resolve => { resolveRead = resolve; });
    void pump();
    return result;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    current,
    refresh,
    start() { active = true; void refresh(); },
    stop() { active = false; desired++; settle(null); },
    invalidate() {
      if (!current()) return;
      last = [];
      publish({ ...snapshot, capabilities: null, error: null, checking: true,
        readEpoch: snapshot.readEpoch + 1, manageEpoch: snapshot.manageEpoch + 1 });
      void refresh();
    },
  };
}
type Access = ReturnType<typeof createOrganizationAccess>;
const Context = createContext<Access | null>(null);

export function OrganizationAccessProvider({ children }: { children: ReactNode }) {
  const { user, accessIntents } = useAuth();
  // Auth invalidates the prior reference synchronously, also for same-account login.
  const access = useMemo(() => createOrganizationAccess(accessIntents), [user?.id, accessIntents]);
  useEffect(() => {
    access.start();
    const refresh = () => { if (document.visibilityState === "visible") void access.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 30_000);
    return () => { access.stop(); clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [access]);
  return <Context.Provider value={access}>{children}</Context.Provider>;
}

export function useOrganizationAccess() {
  const access = useContext(Context);
  if (!access) throw new Error("OrganizationAccessProvider ausente");
  const snapshot = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  return { ...snapshot, canRead: reads(snapshot.capabilities), canManage: manages(snapshot.capabilities),
    refresh: access.refresh, invalidate: access.invalidate, current: access.current, access };
}

export function OrganizationAccessFeedback() {
  const access = useOrganizationAccess();
  if (access.checking && !access.capabilities) return <LoadingState text="Verificando acesso a clientes…" />;
  return <Card>
    {access.error ? <ErrorBanner message={`Acesso a clientes indisponível: ${access.error}`} /> : <p role="status" className="mb-3 text-sm text-slate-600">Você não tem permissão para consultar clientes.</p>}
    <Button variant="secondary" disabled={access.checking} onClick={() => void access.refresh()}>Tentar novamente</Button>
  </Card>;
}

/** Only these explicit routes inherit the old platform entry requirement. */
const LEGACY_ROUTES = new Set(["/", "/predios", "/gateways", "/dispositivos", "/alertas", "/usuarios", "/unidades-equipes", "/funcionalidades", "/auditoria", "/operacao", "/suporte-remoto"]);
export function organizationRouteAllowed(path: string, legacy: boolean, canRead: boolean): boolean {
  const pathname = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return pathname === "/sessoes" || (pathname === "/clientes" ? canRead : legacy && LEGACY_ROUTES.has(pathname));
}

/** Mutations belong to the current view and session. No retry/replay is added. */
export function useOrganizationMutation() {
  const { access } = useOrganizationAccess();
  const location = useLocation();
  const generation = useRef(0), mounted = useRef(false), sending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    const invalidate = () => { generation.current++; };
    const visibility = () => { if (document.visibilityState !== "visible") invalidate(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", invalidate);
    return () => { mounted.current = false; invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", invalidate); };
  }, [access, location.key]);
  const cancelPendingIntent = () => { generation.current++; setError(null); };
  async function run<T>(required: "read" | "manage", operation: () => Promise<T>, succeeded: (value: T) => void) {
    if (sending.current || !mounted.current || !access.current() || document.visibilityState !== "visible") return;
    sending.current = true; setBusy(true); setError(null);
    const expected = generation.current;
    const authorization = access.getSnapshot();
    let submitted = false;
    const current = () => {
      const latest = access.getSnapshot();
      // Publication precedes React's effect cleanup. A committed response from
      // an earlier authorization epoch cannot update the new view, even after regrant.
      return mounted.current && generation.current === expected && access.current() && document.visibilityState === "visible"
        && latest.readEpoch === authorization.readEpoch
        && (required === "read" || latest.manageEpoch === authorization.manageEpoch);
    };
    try {
      const capabilities = await access.refresh();
      if (!current()) return;
      // A newer focus/revocation may supersede this completed response before
      // its continuation runs. Never start a fresh request with an older grant.
      if (access.getSnapshot().capabilities !== capabilities || access.getSnapshot().checking) return;
      if (!(required === "manage" ? manages(capabilities) : reads(capabilities))) {
        if (capabilities) throw new Error("Sua permissão mudou. A ação não foi enviada.");
        throw new Error("Não foi possível confirmar sua permissão. A ação não foi enviada.");
      }
      submitted = true;
      const result = await operation();
      if (current()) succeeded(result);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.status === 403) access.invalidate();
      if (!(cause instanceof ApiError && cause.code === "SESSION_CHANGED")) {
        const uncertain = submitted && cause instanceof ApiError && (cause.code === "NETWORK_ERROR" || cause.code === "INVALID_RESPONSE");
        setError(uncertain ? "Não foi possível confirmar se a alteração foi concluída. Atualize a lista antes de tentar novamente."
          : cause instanceof Error ? cause.message : "Não foi possível confirmar a resposta da operação. Atualize a lista antes de tentar novamente.");
      }
    } finally {
      sending.current = false;
      if (mounted.current && access.current()) setBusy(false);
    }
  }
  return { busy, error, setError, run, cancelPendingIntent };
}
