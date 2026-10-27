/** Authorized occupancy deliberately contains no reservation or person id. */
export type ReservationBusyInterval = { startsAt: string; endsAt: string };
export type ReservationAvailabilityResponse = { items: ReservationBusyInterval[] };
export type ReservationAvailabilityQuery = {
  buildingId: string;
  areaId: string;
  /** Explicit instants (ISO 8601), with a positive range of at most 31 days. */
  from: string;
  to: string;
};

/** One of the caller's current apartments (GET /reservations/units). */
export type OwnUnit = { id: string; code: string };

/** GET /reservations/calendar: one area's period, for the administration only. */
export type ManagedReservation = {
  id: string; buildingId: string; areaId: string; userId: string; requesterName: string | null; unit: string | null;
  startsAt: string; endsAt: string; status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED"; notes: string | null;
};
export type ReservationCalendarEvent = { id: string; title: string; status: BuildingEventStatus; startsAt: string; endsAt: string };
export type ReservationCalendarResponse = { reservations: ManagedReservation[]; events: ReservationCalendarEvent[] };

export type BuildingEventStatus = "SCHEDULED" | "CANCELLED";
/** GET /v1/building-events. Totals are counts only; names are in the administration's answer list. */
export type BuildingEvent = {
  id: string; buildingId: string; title: string; description: string; location: string;
  areaId: string | null; areaName: string | null; startsAt: string; endsAt: string; rsvpUntil: string | null;
  capacity: number | null; maxGuests: number; status: BuildingEventStatus; version: number; answersOpen: boolean;
  attendingResponses: number; attendingPeople: number; declinedResponses: number;
  myResponse: { attending: boolean; guests: number } | null;
};
export type BuildingEventAnswer = { userId: string; name: string | null; unit: string | null; attending: boolean; guests: number; updatedAt: string };
