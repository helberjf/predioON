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
