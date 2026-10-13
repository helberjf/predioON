import { useState } from "react";
import { Card, Field, LoadingState, ResourceFeedback, Select, TenancyPanel, useResource } from "@predioon/ui";
import { NoGrant, useGrantedBuildings } from "../granted-buildings.js";

export function Tenancy() {
  const buildings = useResource<{ items: Array<{ id: string; name: string; active: boolean }> }>("/buildings");
  const [selected, setSelected] = useState("");
  const active = buildings.data?.items.filter(building => building.active) ?? null;
  const granted = useGrantedBuildings(buildings.data ? active : null);
  const available = granted ?? [];
  const buildingId = available.some(building => building.id === selected) ? selected : available[0]?.id ?? "";
  if (buildings.data && !granted) return <LoadingState text="Verificando suas concessões…" />;
  if (granted && active?.length && !granted.length) return <NoGrant title="Unidades, equipes e permissões" />;
  return <>
    <Card><Field label="Condomínio"><Select value={buildingId} onChange={setSelected} options={available.map(building => ({ value: building.id, label: building.name }))} /></Field></Card>
    {buildingId ? <TenancyPanel key={buildingId} buildingId={buildingId} /> : <ResourceFeedback resource={buildings} emptyText="Nenhum condomínio ativo disponível." />}
  </>;
}
