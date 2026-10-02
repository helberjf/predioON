import { useState } from "react";
import { Card, Field, ResourceFeedback, Select, TenancyPanel, useResource } from "@predioon/ui";

export function Tenancy() {
  const buildings = useResource<{ items: Array<{ id: string; name: string; active: boolean }> }>("/buildings");
  const [selected, setSelected] = useState("");
  const available = buildings.data?.items.filter(building => building.active) ?? [];
  const buildingId = available.some(building => building.id === selected) ? selected : available[0]?.id ?? "";
  return <>
    <Card><Field label="Condomínio"><Select value={buildingId} onChange={setSelected} options={available.map(building => ({ value: building.id, label: building.name }))} /></Field></Card>
    {buildingId ? <TenancyPanel key={buildingId} buildingId={buildingId} /> : <ResourceFeedback resource={buildings} emptyText="Nenhum condomínio ativo disponível." />}
  </>;
}
