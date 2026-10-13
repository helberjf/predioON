import { useState } from "react";
import { AccessPanel, Card, FeatureContent, FeatureProvider, Field, LoadingState, MonitoringPanel, ParkingPanel, ResourceFeedback, Select, useFeatures, useResource } from "@predioon/ui";
import { NoGrant, useGrantedBuildings } from "../granted-buildings.js";
import type { Paged } from "@predioon/ui";
export function Operations() {
  const buildings = useResource<Paged<{ id: string; name: string }>>("/buildings");
  const [selected, setSelected] = useState("");
  const granted = useGrantedBuildings(buildings.data?.items);
  const available = granted ?? [];
  const buildingId = available.some(b => b.id === selected) ? selected : available[0]?.id ?? "";
  const heading = <h1 className="text-2xl font-bold text-slate-900">Operação dos imóveis</h1>;
  if (buildings.data && !granted) return <>{heading}<LoadingState text="Verificando suas concessões…" /></>;
  if (granted && buildings.data?.items.length && !granted.length) return <>{heading}<NoGrant title="Operação" /></>;
  return <>
    {heading}
    <Card><Field label="Imóvel"><Select value={buildingId} onChange={setSelected} options={available.map(b => ({ value: b.id, label: b.name }))} /></Field></Card>
    {!buildingId ? <ResourceFeedback resource={buildings} emptyText="Cadastre um imóvel para configurar a operação." /> : <FeatureProvider key={buildingId} buildingId={buildingId}><FeatureContent path="/operacao"><BuildingOperations buildingId={buildingId} /></FeatureContent></FeatureProvider>}
  </>;
}
function BuildingOperations({ buildingId }: { buildingId: string }) {
  const flags = useFeatures();
  const options = [{ value: "consumo", label: "Consumo, bomba e análise" }, { value: "acessos", label: "Portões e acessos" }, { value: "vagas", label: "Vagas de carros e motos" }].filter(option => flags.routeAllowed(`/${option.value}`));
  const [selected, setSelected] = useState("");
  const view = options.some(option => option.value === selected) ? selected : options[0]?.value;
  return <><Card><Field label="Módulo"><Select value={view ?? ""} onChange={setSelected} options={options} /></Field></Card><div key={view}>{view === "consumo" ? <MonitoringPanel buildingId={buildingId} canManage /> : view === "acessos" ? <AccessPanel buildingId={buildingId} /> : view === "vagas" ? <ParkingPanel buildingId={buildingId} /> : null}</div></>;
}
