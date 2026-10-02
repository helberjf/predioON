import { OccurrencesPanel } from "@predioon/ui";

export function Occurrences({ buildingId, canManage = false }: { buildingId: string; canManage?: boolean }) {
  return <OccurrencesPanel buildingId={buildingId} canManage={canManage} />;
}
