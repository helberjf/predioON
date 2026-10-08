import { useFeatures, useResource } from "@predioon/ui";

/**
 * Consumption is granted per meter, so the condominium's capability list cannot
 * tell whether this person has any. Ask once: a refusal means there is nothing
 * to show, and the destination is left out instead of leading to a dead end.
 * Any other failure keeps it, so a real problem is still seen on the screen.
 */
export function useConsumptionAvailable(buildingId: string | null | undefined): boolean {
  const flags = useFeatures();
  const probe = useResource<unknown>(buildingId && flags.routeAllowed("/consumo") ? `/monitoring?buildingId=${encodeURIComponent(buildingId)}` : null);
  return !probe.loading && probe.errorStatus !== 403;
}
