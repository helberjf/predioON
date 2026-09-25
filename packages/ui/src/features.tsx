import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { FeatureKey, FeatureState } from "@predioon/shared";
import { api } from "./api.js";
import { featureEnabled, featureRevision, featureRouteAllowed } from "./feature-state.js";
import { useRealtime } from "./sse.js";
import { Button, Card, ErrorBanner, LoadingState } from "./components/primitives.js";

type FeatureContextValue = { items: FeatureState[] | null; loading: boolean; error: string | null; revision: string; refresh: () => void };
const Context = createContext<FeatureContextValue>({ items: null, loading: true, error: null, revision: "pending", refresh: () => undefined });

export function FeatureProvider({ buildingId, children }: { buildingId?: string; children: ReactNode }) {
  const path = buildingId ? `/features/buildings/${encodeURIComponent(buildingId)}` : "/features/global";
  const [snapshot, setSnapshot] = useState<{ path: string; items: FeatureState[] | null; error: string | null }>({ path, items: null, error: null });
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    // Close the visible workspace before validating a focus/event refresh.
    setSnapshot({ path, items: null, error: null });
    void api.get<{ items: FeatureState[] }>(path).then(result => {
      if (request === generation.current) setSnapshot({ path, items: result.items, error: null });
    }).catch((cause: unknown) => {
      if (request === generation.current) setSnapshot({ path, items: null, error: cause instanceof Error ? cause.message : "Não foi possível verificar as funcionalidades." });
    });
  }, [path]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      const request = ++generation.current;
      void api.get<{ items: FeatureState[] }>(path).then(result => {
        if (request === generation.current) setSnapshot({ path, items: result.items, error: null });
      }).catch((cause: unknown) => {
        if (request === generation.current) setSnapshot({ path, items: null, error: cause instanceof Error ? cause.message : "Falha ao verificar funcionalidades." });
      });
    }, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("predioon:features-changed", refresh);
    return () => { ++generation.current; clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("predioon:features-changed", refresh); };
  }, [path, refresh]);
  useRealtime(event => { if (event.kind === "features-changed" && (!event.buildingId || event.buildingId === "*" || !buildingId || event.buildingId === buildingId)) refresh(); });
  const current = snapshot.path === path ? snapshot : { path, items: null, error: null };
  return <Context.Provider value={{ items: current.items, loading: !current.items && !current.error, error: current.error, revision: current.items ? `${path}:${featureRevision(current.items)}` : `${path}:pending`, refresh }}>{children}</Context.Provider>;
}

export function useFeatures() {
  const value = useContext(Context);
  return { ...value, enabled: (key: FeatureKey) => featureEnabled(value.items, key), routeAllowed: (path: string) => featureRouteAllowed(path, value.items) };
}

/** Remount feature content on authoritative revisions: cached forms/readings cannot leak across changes. */
export function FeatureContent({ children, path, feature }: { children: ReactNode; path?: string; feature?: FeatureKey }) {
  const flags = useFeatures();
  if (flags.loading) return <LoadingState />;
  if (flags.error) return <Card><ErrorBanner message={`Funcionalidades indisponíveis: ${flags.error}`} /><Button variant="secondary" onClick={flags.refresh}>Tentar novamente</Button></Card>;
  if ((path && !flags.routeAllowed(path)) || (feature && !flags.enabled(feature))) return <Card><p role="status" className="text-sm text-slate-600">Esta funcionalidade está desativada para este condomínio. Consulte a administração.</p></Card>;
  return <Fragment key={flags.revision}>{children}</Fragment>;
}

export function Feature({ name, children }: { name: FeatureKey; children: ReactNode }) {
  return useFeatures().enabled(name) ? <>{children}</> : null;
}
