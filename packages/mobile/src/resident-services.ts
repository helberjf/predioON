import type {
  AccessGateView,
  BuildingEvent,
  FinancialReport,
} from "@predioon/contracts";
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

export function reservationResultMessage(status: string): string {
  if (status === "CONFIRMED") return "Reserva confirmada.";
  if (status === "PENDING") return "Reserva enviada para aprovação.";
  return "Reserva registrada. Consulte a situação na lista.";
}

/** Events of this building only, soonest first; the API already hides what a resident may not see. */
export function buildingEvents(
  items: readonly BuildingEvent[],
  buildingId: string,
): BuildingEvent[] {
  return items
    .filter((item) => item.buildingId === buildingId)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}
/** Places still open for everyone, or null when the event has no limit. */
export function eventSpotsLeft(
  event: Pick<BuildingEvent, "capacity" | "attendingPeople">,
): number | null {
  return event.capacity === null
    ? null
    : Math.max(0, event.capacity - event.attendingPeople);
}
/** Companions are kept inside the event's limit and are zero for "não vou". */
export function eventGuests(
  attending: boolean,
  guests: number,
  maxGuests: number,
): number {
  if (!attending || !Number.isFinite(guests)) return 0;
  return Math.min(Math.max(0, Math.trunc(guests)), Math.max(0, maxGuests));
}
export function eventAnswerPath(eventId: string): string {
  return `/v1/building-events/${encodeURIComponent(eventId)}/response`;
}
export function eventResultMessage(title: string, attending: boolean): string {
  return attending
    ? `Presença confirmada em "${title}".`
    : `Você avisou que não vai a "${title}".`;
}
