import type { AuthorizationResponse } from "@predioon/contracts/tenancy";
import type { BuildingOverview } from "@predioon/contracts";

export type Product = "resident" | "operations";
export type Screen =
  | "notices"
  | "tickets"
  | "reservations"
  | "transparency"
  | "access"
  | "overview"
  | "alerts"
  | "readings";
export type Grant = AuthorizationResponse["capabilities"][number];
export type Feature = { key: string; enabled: boolean };
export type Scope = {
  buildingId: string;
  capabilities: readonly Grant[];
  features: readonly Feature[];
  /** Current server projection for operation navigation, never action grants. */
  overview?: BuildingOverview | null;
  /** Current authorized gate collection; never an action or inventory grant. */
  access?: { buildingId: string; readable: boolean } | null;
};

export function transparencySections(scope: Scope) {
  const enabled = (key: string) =>
    scope.features.some((feature) => feature.key === key && feature.enabled);
  return {
    notices:
      scope.capabilities.includes("notices:read") && enabled("TRANSPARENCY"),
    finance:
      (scope.capabilities.includes("finance:read-published") ||
        scope.capabilities.includes("finance:read")) &&
      enabled("FINANCE"),
  };
}

/** Each reservation action follows its own current domain permission. */
export function reservationActions(scope: Scope) {
  const enabled = scope.features.some(
    (feature) => feature.key === "RESERVATIONS" && feature.enabled,
  );
  const has = (grant: Grant) => scope.capabilities.includes(grant);
  const readOwn = has("reservations:read-own");
  const manage = has("reservations:manage") && has("common-areas:read");
  const areas = enabled && has("common-areas:read");
  return {
    read: enabled && (readOwn || manage),
    areas,
    create: areas && readOwn && has("reservations:create-own"),
    cancel: enabled && (manage || (readOwn && has("reservations:cancel-own"))),
  };
}

export function screensFor(product: Product, scope: Scope): Screen[] {
  const transparency = transparencySections(scope);
  const has = (grant: Grant) => scope.capabilities.includes(grant);
  const feature = (key: string) =>
    scope.features.some((item) => item.key === key && item.enabled);
  if (product === "resident")
    return [
      ...(has("notices:read") && feature("NOTICES")
        ? ["notices" as const]
        : []),
      ...((has("occurrences:read-own") || has("occurrences:manage")) &&
      feature("TICKETS")
        ? ["tickets" as const]
        : []),
      ...(reservationActions(scope).read ? ["reservations" as const] : []),
      ...(transparency.notices || transparency.finance
        ? ["transparency" as const]
        : []),
      ...(("access" in scope
        ? scope.access?.buildingId === scope.buildingId && scope.access.readable
        : has("gates:read")) &&
      (feature("GARAGE_ACCESS") || feature("PEDESTRIAN_ACCESS"))
        ? ["access" as const]
        : []),
    ];
  if ("overview" in scope) {
    const overview =
      scope.overview?.buildingId === scope.buildingId ? scope.overview : null;
    if (!overview) return [];
    const tickets =
      feature("TICKETS") &&
      overview.coverage.occurrences !== "none" &&
      overview.occurrenceVisibility !== "none";
    const summary =
      tickets ||
      [
        overview.coverage.devices,
        overview.coverage.gateways,
        overview.coverage.alerts,
        overview.coverage.telemetry,
      ].some((value) => value !== "none");
    return [
      ...(summary ? ["overview" as const] : []),
      ...(overview.coverage.alerts !== "none" ? ["alerts" as const] : []),
      ...(overview.coverage.telemetry !== "none" ? ["readings" as const] : []),
      ...(tickets ? ["tickets" as const] : []),
    ];
  }
  return [
    ...(["telemetry:read", "devices:read", "alerts:read"].some((grant) =>
      scope.capabilities.includes(grant as Grant),
    )
      ? ["overview" as const]
      : []),
    ...(has("alerts:read") ? ["alerts" as const] : []),
    ...(has("telemetry:read") ? ["readings" as const] : []),
    ...(has("occurrences:manage") && feature("TICKETS")
      ? ["tickets" as const]
      : []),
  ];
}

/** UI filtering is additive; the API is always the authorization boundary. */
export function ownedTickets<T extends { openedBy: string | null }>(
  items: readonly T[],
  userId: string,
  product: Product,
): T[] {
  return items.filter(
    (item) => product === "operations" || item.openedBy === userId,
  );
}

export function validateApiUrl(value: string, development: boolean): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Informe o endereço da API sem credenciais, parâmetros ou fragmentos.",
    );
  if (url.protocol !== "https:" && !(development && url.protocol === "http:"))
    throw new Error("A API deve usar HTTPS.");
  return url.toString().replace(/\/+$/, "");
}

export function reservationWindow(
  date: string,
  time: string,
  hoursValue: string,
  maxHours: number,
  now = Date.now(),
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error("Use data AAAA-MM-DD e horário HH:MM.");
  const startsAt = new Date(`${date}T${time}:00`);
  const [year, month, day] = date.split("-").map(Number);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    startsAt.getFullYear() !== year ||
    startsAt.getMonth() + 1 !== month ||
    startsAt.getDate() !== day
  )
    throw new Error("Informe uma data válida.");
  const hours = Number(hoursValue);
  if (!Number.isFinite(hours) || hours <= 0 || hours > maxHours)
    throw new Error(
      `Informe uma duração maior que zero e de até ${maxHours} horas.`,
    );
  if (startsAt.getTime() <= now) throw new Error("Escolha um horário futuro.");
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + hours * 3_600_000).toISOString(),
  };
}
