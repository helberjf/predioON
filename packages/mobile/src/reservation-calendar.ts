import {
  reservationAvailabilityPath,
  type ApiClient,
} from "@predioon/api-client";
import type {
  ReservationAvailabilityQuery,
  ReservationAvailabilityResponse,
} from "@predioon/contracts";
import { readResourceAuthorization } from "./authorization.ts";

/** Local civil day, not a fixed 24-hour duration or a building-timezone guess. */
export function reservationCalendarQuery(
  buildingId: string,
  areaId: string,
  date: string,
  enabled: boolean,
): ReservationAvailabilityQuery | null {
  if (!enabled || !buildingId || !areaId || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return null;
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const from = new Date(year, month - 1, day);
  if (
    from.getFullYear() !== year ||
    from.getMonth() + 1 !== month ||
    from.getDate() !== day
  )
    return null;
  const to = new Date(year, month - 1, day + 1);
  return { buildingId, areaId, from: from.toISOString(), to: to.toISOString() };
}

export type ReservationCalendar = ReservationAvailabilityResponse & {
  authorized: boolean;
};

/** The SQL helper currently serializes timestamptz as PostgreSQL text. Hermes
 * must receive an explicit ISO offset and at most millisecond precision. */
function calendarInstant(value: string): string {
  const parts =
    typeof value === "string" &&
    /^(\d{4}-\d{2}-\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)$/.exec(
      value,
    );
  const invalid = () =>
    new Error("A ocupação recebida contém um intervalo inválido.");
  if (!parts) throw invalid();
  const day = parts[1]!,
    time = parts[2]!,
    fraction = parts[3] ?? "",
    zone = parts[4]!;
  const calendarDay = new Date(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(calendarDay.getTime()) ||
    calendarDay.toISOString().slice(0, 10) !== day
  )
    throw invalid();
  const offset =
    zone === "Z" || zone.includes(":")
      ? zone
      : zone.length === 3
        ? `${zone}:00`
        : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const instant = new Date(
    `${day}T${time}.${fraction.slice(0, 3).padEnd(3, "0")}${offset}`,
  );
  if (!Number.isFinite(instant.getTime())) throw invalid();
  return instant.toISOString();
}

export async function readReservationCalendar(
  api: Pick<ApiClient, "get">,
  query: ReservationAvailabilityQuery,
): Promise<ReservationCalendar> {
  const authorization = await readResourceAuthorization(api, {
    buildingId: query.buildingId,
    resourceType: "common_area",
    resourceId: query.areaId,
  });
  if (!authorization.capabilities.includes("reservations:read-calendar"))
    return { authorized: false, items: [] };
  // A current authorization hint never replaces the endpoint's own permission check.
  const response = await api.get<ReservationAvailabilityResponse>(
    reservationAvailabilityPath(query),
  );
  const items = response.items.map((interval) => {
    const startsAt = calendarInstant(interval.startsAt),
      endsAt = calendarInstant(interval.endsAt);
    if (Date.parse(endsAt) <= Date.parse(startsAt))
      throw new Error("A ocupação recebida contém um intervalo inválido.");
    return { startsAt, endsAt };
  });
  return { authorized: true, items };
}
