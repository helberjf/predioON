export type BuildingChoice = { id: string; name: string; active?: boolean };

/** A remembered identifier is a preference, never evidence of tenant access. */
export function resolveBuildingSelection(buildings: readonly BuildingChoice[], selected: string | null): string | null {
  const available = buildings.filter(building => building.active !== false);
  return available.some(building => building.id === selected) ? selected : available[0]?.id ?? null;
}
