import type { AccessGateView, FinancialReport } from "@predioon/contracts";
import type { Feature } from "./scope.ts";

/** Additive audience filtering. API membership, feature checks and RLS remain authoritative. */
export function publishedReports(
  items: readonly FinancialReport[],
  buildingId: string,
  now = Date.now(),
): FinancialReport[] {
  return items.filter(
    (item) =>
      item.buildingId === buildingId &&
      item.publishedAt !== null &&
      Number.isFinite(Date.parse(item.publishedAt)) &&
      Date.parse(item.publishedAt) <= now,
  );
}
export function residentGates(
  items: readonly AccessGateView[],
  buildingId: string,
  features: readonly Feature[],
): AccessGateView[] {
  return items.filter(
    (item) =>
      item.buildingId === buildingId &&
      item.enabled &&
      item.allowResidents &&
      features.some(
        (feature) =>
          feature.enabled &&
          feature.key ===
            (item.kind === "GARAGE" ? "GARAGE_ACCESS" : "PEDESTRIAN_ACCESS"),
      ),
  );
}
export function safeReceiptUrl(value: string | null): string | null {
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export function validReportMonth(value: string): boolean {
  return value === "" || /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}
export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
