import { OccurrencesPanel } from "@predioon/ui";

export function Occurrences({ buildingId }: { buildingId: string }) {
  return <OccurrencesPanel buildingId={buildingId} />;
}
