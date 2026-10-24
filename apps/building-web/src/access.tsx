import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AccessList, Capability } from "@predioon/shared";
import { buildingRouteAllowed, type BuildingOverview, buildingRoutesNeedCoverage, Button, Card, ErrorBanner, LoadingState, useFeatures, useResource } from "@predioon/ui";

type BuildingAccess = {
  /** False until every answer the menu depends on arrived; background refreshes keep the last one. */
  ready: boolean;
  error: string | null;
  can: (capability: Capability) => boolean;
  allowed: (path: string) => boolean;
  refresh: () => void;
};
const Context = createContext<BuildingAccess | null>(null);

/**
 * What this account may open in the selected building. A resident who signs in
 * here gets the community pages only. These are display hints read from the
 * same authorization the APIs apply; a refusal is no access, any other failure
 * is reported instead of guessed.
 */
export function BuildingAccessProvider({ buildingId, children }: { buildingId: string; children: ReactNode }) {
  const flags = useFeatures();
  const scope = `buildingId=${encodeURIComponent(buildingId)}`;
  const authorization = useResource<{ capabilities: Capability[] }>(`/v1/authorization?${scope}`);
  const denied = authorization.errorStatus === 403;
  const capabilities = authorization.data?.capabilities ?? [];
  const known = Boolean(authorization.data) || denied;
  // Grants on single devices or alerts show only in the summary coverage.
  const overview = useResource<BuildingOverview>(known && buildingRoutesNeedCoverage(capabilities) ? `/overview/building?${scope}` : null);
  // The list leaves out every gate not released to this account, as in the resident portal.
  const probeGates = known && capabilities.includes("gates:read") && !capabilities.includes("gates:manage") && flags.routeAllowed("/acessos");
  const gates = useResource<AccessList>(probeGates ? `/access?${scope}` : null);
  const { reload: reloadAuthorization } = authorization, { reload: reloadOverview } = overview, { reload: reloadGates } = gates;
  const refresh = useCallback(() => { reloadAuthorization(); reloadOverview(); reloadGates(); }, [reloadAuthorization, reloadOverview, reloadGates]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    const interval = setInterval(refresh, 30_000);
    return () => { window.removeEventListener("focus", refresh); clearInterval(interval); };
  }, [refresh]);

  const overviewDenied = overview.errorStatus === 403;
  const error = (!denied && authorization.error) || (!overviewDenied && overview.error) || null;
  const coverageKnown = !buildingRoutesNeedCoverage(capabilities) || Boolean(overview.data) || overviewDenied;
  const gatesKnown = !probeGates || Boolean(gates.data) || gates.errorStatus != null;
  const ready = known && coverageKnown && gatesKnown && !error;
  const coverage = overview.data?.buildingId === buildingId ? overview.data.coverage : null;
  // Only a refusal hides the gates; another failure keeps them, so the problem is seen on the page.
  const gatesListed = gates.errorStatus != null ? gates.errorStatus !== 403 : gates.data?.items.some(gate => gate.buildingId === buildingId) === true;
  const value: BuildingAccess = {
    ready, error, refresh,
    can: capability => capabilities.includes(capability),
    allowed: path => ready && buildingRouteAllowed(path, { capabilities, coverage, gatesListed }),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBuildingAccess(): BuildingAccess {
  const access = useContext(Context);
  if (!access) throw new Error("BuildingAccessProvider ausente");
  return access;
}

/** A page outside this account's reach explains so instead of opening empty. */
export function RouteAccess({ path, children }: { path: string; children: ReactNode }) {
  const access = useBuildingAccess();
  if (access.error) return <Card><ErrorBanner message={`Não foi possível verificar o seu acesso: ${access.error}`} /><Button variant="secondary" onClick={access.refresh}>Tentar novamente</Button></Card>;
  if (!access.ready) return <LoadingState />;
  if (!access.allowed(path)) return <Card><p role="status" className="text-sm text-slate-600">Sua conta não tem acesso a esta área do condomínio.</p><Link to="/" className="mt-3 inline-block text-sm font-semibold text-sky-700 hover:underline">Voltar ao início</Link></Card>;
  return <>{children}</>;
}
