import type { SupportConfigView, SupportLaunch, SupportRequestView } from "@predioon/shared";

export type SupportPendingRequest = { requestId: string; reason: string };

export function supportLaunchIsCurrent(launch: SupportLaunch | null, config: SupportConfigView | null, buildingId: string, currentRequest: SupportRequestView | undefined): boolean {
  return !!launch && !!config?.enabled && !!currentRequest
    && config.buildingId === buildingId && launch.request.buildingId === buildingId
    && currentRequest.id === launch.request.id && currentRequest.buildingId === buildingId
    && launch.request.status === "OPEN" && currentRequest.status === "OPEN"
    && launch.request.configRevision === config.revision
    && launch.request.anydeskId === config.anydeskId;
}

export function supportRequestForRetry(pending: SupportPendingRequest | null, reason: string, createId: () => string): SupportPendingRequest {
  const normalized = reason.trim();
  return pending?.reason === normalized ? pending : { requestId: createId(), reason: normalized };
}
