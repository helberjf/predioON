import { useState } from "react";
import type { DemoScenario, DemoScenarioState } from "@predioon/shared";
import { api, Badge, Button, Card, ErrorBanner, Field, PageHeading, ResourceFeedback, Select, useResource, type Paged } from "@predioon/ui";

type ScenarioView = DemoScenarioState & { scenarios: Array<{ key: DemoScenario; label: string }> };

/** Only when the API runs with DEMO_SCENARIOS=on. */
export function useDemoAvailable(): boolean {
  return useResource<{ enabled: boolean }>("/v1/demo").data?.enabled === true;
}

export function Demo() {
  const buildings = useResource<Paged<{ id: string; name: string }>>("/buildings");
  const [selected, setSelected] = useState("");
  const items = buildings.data?.items ?? [];
  const buildingId = items.some(b => b.id === selected) ? selected : items[0]?.id ?? "";
  return <>
    <PageHeading title="Demonstração" description="Dispare situações no prédio simulado durante uma apresentação. Nenhum equipamento real é acionado." />
    <Card><Field label="Condomínio"><Select value={buildingId} onChange={setSelected} options={items.map(b => ({ value: b.id, label: b.name }))} /></Field></Card>
    {buildingId ? <Scenarios key={buildingId} buildingId={buildingId} /> : <Card><ResourceFeedback resource={buildings} emptyText="Nenhum condomínio cadastrado." /></Card>}
  </>;
}

function Scenarios({ buildingId }: { buildingId: string }) {
  const path = `/v1/demo/scenarios/${encodeURIComponent(buildingId)}`;
  const state = useResource<ScenarioView>(path);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function choose(scenario: DemoScenario) {
    setBusy(true); setError("");
    try { await api.put(path, { scenario }); state.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível trocar o cenário."); }
    finally { setBusy(false); }
  }
  if (!state.data) return <Card><ResourceFeedback resource={state} emptyText="Cenários indisponíveis." /></Card>;
  const current = state.data.scenarios.find(item => item.key === state.data!.scenario);
  return <Card title="Cenário do prédio simulado" subtitle="O gateway de demonstração aplica a escolha em até 15 segundos; alertas, gráficos e consumo reagem como reagiriam ao equipamento real.">
    {error && <ErrorBanner message={error} />}
    <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">Agora: <Badge tone={state.data.scenario === "normal" ? "success" : "warning"}>{current?.label ?? state.data.scenario}</Badge>
      {state.data.updatedAt && <span>desde {new Date(state.data.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}</p>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {state.data.scenarios.map(item => <Button key={item.key} variant={item.key === state.data!.scenario ? "primary" : "secondary"} disabled={busy || item.key === state.data!.scenario} onClick={() => void choose(item.key)}>{item.label}</Button>)}
    </div>
  </Card>;
}
