import { ApiError, type ApiClient } from "@predioon/api-client";
import type { BuildingOverview } from "@predioon/contracts";
import type { AuthorizationResponse } from "@predioon/contracts/tenancy";

type Reader = Pick<ApiClient, "get">;
type AuthorizationTarget = Omit<AuthorizationResponse, "capabilities">;
export type OperationsAccess = {
  buildingId: string;
  capabilities: AuthorizationResponse["capabilities"];
  overview: BuildingOverview | null;
};

/** Denial is empty authorization; a network/server/session error is not denial. */
export async function readResourceAuthorization(
  api: Reader,
  target: AuthorizationTarget,
): Promise<AuthorizationResponse> {
  const params = new URLSearchParams({ buildingId: target.buildingId });
  if (target.resourceType && target.resourceId) {
    params.set("resourceType", target.resourceType);
    params.set("resourceId", target.resourceId);
  }
  try {
    const result = await api.get<AuthorizationResponse>(
      `/v1/authorization?${params}`,
    );
    if (
      result.buildingId !== target.buildingId ||
      result.resourceType !== target.resourceType ||
      result.resourceId !== target.resourceId
    )
      throw new Error(
        "A resposta de autorização não corresponde ao escopo solicitado.",
      );
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403)
      return { ...target, capabilities: [] };
    throw error;
  }
}

export async function readOperationsAccess(
  api: Reader,
  buildingId: string,
): Promise<OperationsAccess> {
  const [authorization, overview] = await Promise.all([
    readResourceAuthorization(api, { buildingId }),
    api
      .get<BuildingOverview>(
        `/overview/building?buildingId=${encodeURIComponent(buildingId)}`,
      )
      .catch((error) => {
        if (error instanceof ApiError && error.status === 403) return null;
        throw error;
      }),
  ]);
  if (overview && overview.buildingId !== buildingId)
    throw new Error("O resumo não corresponde ao escopo solicitado.");
  return { buildingId, capabilities: authorization.capabilities, overview };
}

export type AlertSubject = {
  id: string;
  buildingId: string;
  deviceId: string | null;
  gatewayId: string | null;
};
export function alertTargets(alert: AlertSubject): AuthorizationTarget[] {
  return [
    {
      buildingId: alert.buildingId,
      resourceType: "alert",
      resourceId: alert.id,
    },
    ...(alert.deviceId
      ? [
          {
            buildingId: alert.buildingId,
            resourceType: "device" as const,
            resourceId: alert.deviceId,
          },
        ]
      : []),
    ...(alert.gatewayId
      ? [
          {
            buildingId: alert.buildingId,
            resourceType: "gateway" as const,
            resourceId: alert.gatewayId,
          },
        ]
      : []),
  ];
}

/** These are display hints; the transition endpoint rechecks the current parents. */
export function alertActionScope(
  buildingId: string,
  alert: AlertSubject,
  authorizations: readonly AuthorizationResponse[],
) {
  const targets = alertTargets(alert);
  const capabilities = new Set(
    authorizations
      .filter(
        (authorization) =>
          buildingId === alert.buildingId &&
          targets.some(
            (target) =>
              authorization.buildingId === target.buildingId &&
              authorization.resourceType === target.resourceType &&
              authorization.resourceId === target.resourceId,
          ),
      )
      .flatMap((authorization) => authorization.capabilities),
  );
  return {
    acknowledge:
      capabilities.has("alerts:read") && capabilities.has("alerts:acknowledge"),
    resolve:
      capabilities.has("alerts:read") && capabilities.has("alerts:resolve"),
  };
}

export function occurrenceSummary(overview: BuildingOverview) {
  if (
    overview.coverage.occurrences === "none" ||
    overview.occurrenceVisibility === "none" ||
    overview.counts.open_occurrences === null
  )
    return {
      value: "Indisponível",
      detail: "Contagem fora do escopo atual ou módulo indisponível.",
    };
  return {
    value: String(overview.counts.open_occurrences),
    detail: {
      own: "Somente os chamados abertos por você.",
      scoped: "Somente chamados concedidos ao seu perfil.",
      all: "Todos os chamados autorizados deste condomínio.",
    }[overview.occurrenceVisibility],
  };
}
