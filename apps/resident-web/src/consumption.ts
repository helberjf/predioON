import { useFeatures, useResource } from "@predioon/ui";

/**
 * Consumption reaches residents only when the condominium's administration
 * released it, and it starts not released. Ask once: a refusal means there is
 * nothing to show, and the destination is left out instead of leading to a
 * dead end. Any other failure keeps it, so a real problem is still seen.
 */
export function useConsumptionAvailable(buildingId: string | null | undefined): boolean {
  const flags = useFeatures();
  const probe = useResource<unknown>(buildingId && flags.routeAllowed("/consumo") ? `/monitoring/published?buildingId=${encodeURIComponent(buildingId)}` : null);
  return !probe.loading && probe.errorStatus !== 403;
}
