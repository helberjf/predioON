import { useFeatures, useResource } from "@predioon/ui";
import type { AccessList } from "@predioon/shared";

/**
 * The API leaves out every gate the administration has not released to the
 * resident, so an empty list means there is nothing to open here and the
 * destination is left out. A failure other than a refusal keeps it, so a real
 * problem is still seen.
 */
export function useAccessAvailable(buildingId: string | null | undefined): boolean {
  const flags = useFeatures();
  const probe = useResource<AccessList>(buildingId && flags.routeAllowed("/acessos") ? `/access?buildingId=${encodeURIComponent(buildingId)}` : null);
  if (probe.loading || probe.errorStatus === 403) return false;
  return !probe.data || probe.data.items.some(gate => gate.buildingId === buildingId);
}
