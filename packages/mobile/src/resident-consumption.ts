import { ApiError, type ApiClient } from "@predioon/api-client";
import type { Product, Scope } from "./scope.ts";

export type ConsumptionKind = "ENERGY" | "WATER";
export type ConsumptionUnit = "kWh" | "m³";
export type ConsumptionSample = {
  day: string;
  quantity: number;
  incomplete: boolean;
};
export type ConsumptionItem = {
  kind: ConsumptionKind;
  unit: ConsumptionUnit;
  today: number | null;
  history: ConsumptionSample[];
};
/** Local copy of the public 051 projection, never the private monitoring DTO. */
export type ResidentConsumption = {
  buildingId: string;
  day: string;
  items: ConsumptionItem[];
};
const failureMessage = "Não foi possível carregar o consumo do condomínio.";
const dayMilliseconds = 86_400_000;

/** Local identity only: the HTTP endpoint accepts just the real buildingId. */
export function residentConsumptionKey(
  product: Product,
  userId: string,
  scope: Scope,
): string | null {
  const revisions = ["ENERGY_CONSUMPTION", "WATER_CONSUMPTION"].map((key) => {
    const feature = scope.features.find((feature) => feature.key === key);
    return [
      key,
      feature?.enabled === true,
      feature?.version ?? null,
      feature?.globalVersion ?? null,
      feature?.resumedAt ?? null,
    ];
  });
  if (
    product !== "resident" ||
    !scope.capabilities.includes("monitoring:read-published") ||
    !revisions.some((revision) => revision[1])
  ) return null;
  return JSON.stringify(["consumption", userId, scope.buildingId, revisions]);
}

function invalid(): never {
  throw new ApiError(200, failureMessage, "INVALID_RESPONSE");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function civilDay(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) invalid();
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function quantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid();
  return value;
}

export function consumptionDays(day: string): string[] {
  const last = Date.parse(`${civilDay(day)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(last - (6 - index) * dayMilliseconds).toISOString().slice(0, 10),
  );
}

function parseConsumption(value: unknown, buildingId: string): ResidentConsumption {
  const body = record(value);
  if (!buildingId || body.buildingId !== buildingId) invalid();
  const day = civilDay(body.day);
  const window = new Set(consumptionDays(day));
  if (!Array.isArray(body.items) || body.items.length > 2) invalid();
  const kinds = new Set<ConsumptionKind>();
  const items = body.items.map((value): ConsumptionItem => {
    const item = record(value);
    const kind = item.kind;
    if (kind !== "ENERGY" && kind !== "WATER") invalid();
    if (kinds.has(kind)) invalid();
    kinds.add(kind);
    const unit = kind === "ENERGY" ? "kWh" : "m³";
    if (
      item.unit !== unit ||
      !Array.isArray(item.history) ||
      item.history.length > 7
    ) invalid();
    const today = item.today === null ? null : quantity(item.today);
    const days = new Set<string>();
    const history = item.history.map((value): ConsumptionSample => {
      const sample = record(value);
      const sampleDay = civilDay(sample.day);
      if (
        !window.has(sampleDay) ||
        days.has(sampleDay) ||
        typeof sample.incomplete !== "boolean"
      ) invalid();
      days.add(sampleDay);
      return {
        day: sampleDay,
        quantity: quantity(sample.quantity),
        incomplete: sample.incomplete,
      };
    });
    if (today !== (history.find((sample) => sample.day === day)?.quantity ?? null)) invalid();
    return { kind, unit, today, history };
  });
  return { buildingId, day, items };
}

/** Only an observed typed 403 is denial. Other failures remain sanitized errors. */
export async function readResidentConsumption(
  api: Pick<ApiClient, "get">,
  buildingId: string,
): Promise<ResidentConsumption | null> {
  try {
    const body = await api.get<unknown>(
      `/monitoring/published?buildingId=${encodeURIComponent(buildingId)}`,
    );
    return parseConsumption(body, buildingId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null;
    throw new ApiError(
      error instanceof ApiError ? error.status : 0,
      failureMessage,
      error instanceof ApiError ? error.code : "NETWORK_ERROR",
    );
  }
}

export function consumptionRows(day: string, item: ConsumptionItem) {
  return consumptionDays(day).map((day) => {
    const sample = item.history.find((sample) => sample.day === day);
    return {
      day,
      quantity: sample?.quantity ?? null,
      incomplete: sample?.incomplete ?? false,
    };
  });
}
export function consumptionDayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
export function consumptionQuantity(value: number | null, unit: ConsumptionUnit): string {
  if (value === null) return "Sem medição";
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    formatted = value.toFixed(1).replace(".", ",");
  }
  return `${formatted} ${unit}`;
}
