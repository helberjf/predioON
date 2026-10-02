import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient } from "@predioon/api-client";
import {
  reservationCalendarQuery,
  readReservationCalendar,
} from "../src/reservation-calendar.ts";

const buildingId = "calendar-building";
const areaId = "11111111-1111-4111-8111-111111111111";
const target = { buildingId, resourceType: "common_area", resourceId: areaId };

test("native calendar requires a current area, feature and valid civil date", () => {
  for (const date of [
    "",
    "2030-02-30",
    "2030-02-29",
    "2030-13-01",
    "2030-00-01",
    "2030-01-00",
    "2030-01",
    "2030-01-01T12:00Z",
  ])
    assert.equal(
      reservationCalendarQuery(buildingId, areaId, date, true),
      null,
    );
  assert.equal(
    reservationCalendarQuery(buildingId, areaId, "2032-02-29", false),
    null,
  );
  assert.equal(reservationCalendarQuery("", areaId, "2032-02-29", true), null);
  assert.equal(
    reservationCalendarQuery(buildingId, "", "2032-02-29", true),
    null,
  );
  for (const date of ["2032-02-29", "2030-12-31", "2030-04-30"]) {
    const query = reservationCalendarQuery(buildingId, areaId, date, true)!;
    assert.equal(query.buildingId, buildingId);
    assert.equal(query.areaId, areaId);
    assert.equal(new Date(query.from).getDate(), Number(date.slice(8)));
    assert.equal(new Date(query.from).getHours(), 0);
    assert.equal(new Date(query.to).getDate(), 1);
    assert.equal(new Date(query.to).getHours(), 0);
  }
});

test("native calendar uses the whole local day across 23 and 25 hour clock changes", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    for (const [date, hours] of [
      ["2026-03-08", 23],
      ["2026-11-01", 25],
    ] as const) {
      const query = reservationCalendarQuery(buildingId, areaId, date, true)!;
      assert.equal(
        Date.parse(query.to) - Date.parse(query.from),
        hours * 3_600_000,
      );
      assert.equal(new Date(query.from).getHours(), 0);
      assert.equal(new Date(query.to).getHours(), 0);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

function reader(responses: unknown[]) {
  const calls: string[] = [];
  const api = {
    async get(path: string) {
      calls.push(path);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  } as Pick<ApiClient, "get">;
  return { api, calls };
}

test("calendar reauthorizes the exact area and returns only occupancy instants", async () => {
  const query = reservationCalendarQuery(
    buildingId,
    areaId,
    "2030-12-20",
    true,
  )!;
  const interval = { startsAt: query.from, endsAt: query.to };
  const { api, calls } = reader([
    { ...target, capabilities: ["reservations:read-calendar"] },
    {
      items: [
        {
          ...interval,
          id: "private-reservation",
          userId: "neighbor",
          unit: "private",
          notes: "private",
        },
      ],
    },
  ]);
  assert.deepEqual(await readReservationCalendar(api, query), {
    authorized: true,
    items: [interval],
  });
  const authorization = new URL(calls[0]!, "https://api.invalid");
  const occupancy = new URL(calls[1]!, "https://api.invalid");
  assert.equal(authorization.searchParams.get("resourceType"), "common_area");
  assert.equal(authorization.searchParams.get("resourceId"), areaId);
  assert.equal(occupancy.pathname, "/reservations/availability");
  assert.deepEqual(Object.fromEntries(occupancy.searchParams), query);
});

test("creation, ownership and unrelated contexts cannot authorize calendar reads", async () => {
  const query = reservationCalendarQuery(
    buildingId,
    areaId,
    "2030-12-20",
    true,
  )!;
  for (const capabilities of [
    [],
    ["reservations:create-own", "reservations:read-own"],
    ["reservations:manage"],
  ]) {
    const { api, calls } = reader([{ ...target, capabilities }]);
    assert.deepEqual(await readReservationCalendar(api, query), {
      authorized: false,
      items: [],
    });
    assert.equal(calls.length, 1);
  }
  for (const mismatch of [
    { buildingId: "foreign" },
    { resourceId: "other" },
    { resourceType: "reservation" },
  ]) {
    const { api, calls } = reader([
      { ...target, ...mismatch, capabilities: ["reservations:read-calendar"] },
    ]);
    await assert.rejects(
      readReservationCalendar(api, query),
      /escopo solicitado/,
    );
    assert.equal(calls.length, 1);
  }
});

test("calendar canonicalizes actual PostgreSQL timestamps before using the native Date parser", async () => {
  const query = reservationCalendarQuery(
    buildingId,
    areaId,
    "2030-12-20",
    true,
  )!;
  const { api } = reader([
    { ...target, capabilities: ["reservations:read-calendar"] },
    {
      items: [
        {
          startsAt: "2030-12-20 19:00:00.123456-03",
          endsAt: "2030-12-20 23:00:00+00",
        },
      ],
    },
  ]);
  assert.deepEqual(await readReservationCalendar(api, query), {
    authorized: true,
    items: [
      {
        startsAt: "2030-12-20T22:00:00.123Z",
        endsAt: "2030-12-20T23:00:00.000Z",
      },
    ],
  });
  for (const startsAt of [
    "2030-12-20T22:00:00.123Z",
    "2030-12-20T19:00:00.123-03:00",
    "2030-12-20 22:00:00.123000+00",
    "2030-12-20T19:00:00.123-0300",
  ]) {
    const response = reader([
      { ...target, capabilities: ["reservations:read-calendar"] },
      { items: [{ startsAt, endsAt: "2030-12-20T23:00:00Z" }] },
    ]);
    assert.deepEqual(
      (await readReservationCalendar(response.api, query)).items,
      [
        {
          startsAt: "2030-12-20T22:00:00.123Z",
          endsAt: "2030-12-20T23:00:00.000Z",
        },
      ],
    );
  }
  for (const startsAt of [
    "2030-02-29T12:00:00Z",
    "2030-04-31 12:00:00+00",
    "2030-12-20T24:00:00Z",
    "2030-12-20T19:00:00",
    "2030-12-20 19:00:00+25",
    "2030-12-20T12:60:00Z",
  ]) {
    const response = reader([
      { ...target, capabilities: ["reservations:read-calendar"] },
      { items: [{ startsAt, endsAt: "2030-12-21T23:00:00Z" }] },
    ]);
    await assert.rejects(
      readReservationCalendar(response.api, query),
      /intervalo inválido/,
    );
  }
});

test("calendar denial, network failure and invalid response do not become available slots", async () => {
  const { ApiError } = await import("@predioon/api-client");
  const query = reservationCalendarQuery(
    buildingId,
    areaId,
    "2030-12-20",
    true,
  )!;
  const denied = reader([new ApiError(403, "Forbidden")]);
  assert.deepEqual(await readReservationCalendar(denied.api, query), {
    authorized: false,
    items: [],
  });
  assert.equal(denied.calls.length, 1);
  const allowed = { ...target, capabilities: ["reservations:read-calendar"] };
  for (const response of [
    new Error("offline"),
    new ApiError(403, "Revogado"),
    { items: [{ startsAt: "invalid", endsAt: query.to }] },
    { items: [{ startsAt: query.to, endsAt: query.from }] },
  ]) {
    const { api, calls } = reader([allowed, response]);
    await assert.rejects(readReservationCalendar(api, query));
    assert.equal(
      calls.length,
      2,
      "Never replay the read or perform a mutation",
    );
  }
});
