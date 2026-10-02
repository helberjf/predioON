import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth.js";
import { useResource } from "./use-resource.js";
import { resolveBuildingSelection, type BuildingChoice } from "./building-scope-state.js";
import { Button, Card, ResourceFeedback } from "./components/primitives.js";
import { Field, Select } from "./components/fields.js";

type BuildingScope = {
  buildingId: string | null;
  buildings: BuildingChoice[];
  selectBuilding: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
};
const Context = createContext<BuildingScope | null>(null);

function rememberedBuilding(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

/** Mount with key=user.id so a different account cannot inherit forms or scope. */
export function BuildingScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = `predioon.building.${user?.id ?? "anonymous"}`;
  const resource = useResource<{ items: BuildingChoice[] }>(user ? "/buildings" : null);
  const [selected, setSelected] = useState(() => rememberedBuilding(storageKey));
  const buildings = (resource.data?.items ?? []).filter(building => building.active !== false);
  const buildingId = resolveBuildingSelection(buildings, selected);

  useEffect(() => {
    const refresh = () => resource.reload();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [resource.reload]);

  const selectBuilding = (id: string) => {
    if (!buildings.some(building => building.id === id)) return;
    setSelected(id);
    try { sessionStorage.setItem(storageKey, id); } catch { /* Private browsing may disable storage. */ }
  };

  return <Context.Provider value={{ buildingId, buildings, selectBuilding, loading: resource.loading, error: resource.error, reload: resource.reload }}>{children}</Context.Provider>;
}

export function useBuildingScope(): BuildingScope {
  const scope = useContext(Context);
  if (!scope) throw new Error("useBuildingScope precisa estar dentro de BuildingScopeProvider");
  return scope;
}

export function BuildingSelector() {
  const { buildingId, buildings, selectBuilding } = useBuildingScope();
  if (!buildingId || buildings.length < 2) return null;
  return <Field label="Condomínio em uso"><Select value={buildingId} onChange={selectBuilding} options={buildings.map(building => ({ value: building.id, label: building.name }))} /></Field>;
}

export function BuildingScopeFeedback() {
  const scope = useBuildingScope();
  const { signOut } = useAuth();
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6"><Card title="Seus condomínios"><ResourceFeedback resource={scope} emptyText="Sua conta não tem acesso a um condomínio ativo. Solicite o vínculo à administração." /><div className="mt-4"><Button variant="secondary" full onClick={() => void signOut()}>Sair da conta</Button></div></Card></main>;
}
