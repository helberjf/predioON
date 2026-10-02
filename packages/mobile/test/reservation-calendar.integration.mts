import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  ApiError,
  createApiClient,
  reservationAvailabilityPath,
  type SessionTokens,
} from "@predioon/api-client";
import { sqlClient } from "../../db/src/index.ts";
import { closeAppDb } from "../../db/src/runtime.ts";
import { hashPassword } from "../../../apps/api/src/auth/passwords.ts";
import { startTestServer } from "../../../apps/api/test/helpers.ts";
import {
  readReservationCalendar,
  reservationCalendarQuery,
} from "../src/reservation-calendar.ts";

const url = new URL(process.env.DATABASE_URL ?? "https://missing.invalid");
if (
  process.env.RUN_MOBILE_DB_TESTS !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw new Error(
    "Use an explicitly enabled isolated loopback database for mobile integration tests",
  );
after(async () => {
  await closeAppDb();
  await sqlClient.end();
});

test("native calendar reads private occupancy through the real API, rechecks conflict and revocation", async () => {
  const suffix = randomUUID(),
    org = `mobile-calendar-${suffix}`;
  const buildingId = `${org}-a`,
    foreign = `${org}-b`,
    user = `${org}-user`,
    neighbor = `${org}-neighbor`;
  const areaId = randomUUID(),
    otherArea = randomUUID(),
    foreignArea = randomUUID(),
    neighborBooking = randomUUID();
  const baseRole = `MOBILE_RESERVATION_${suffix}`,
    calendarRole = `MOBILE_CALENDAR_${suffix}`,
    binding = randomUUID();
  const future = new Date(Date.now() + 3 * 86_400_000);
  const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
  const query = reservationCalendarQuery(buildingId, areaId, date, true)!;
  const startsAt = new Date(
    Date.parse(query.from) + 19 * 3_600_000,
  ).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 3_600_000).toISOString();
  const server = await startTestServer();
  try {
    const hash = await hashPassword("predioon123");
    await sqlClient.begin(async (tx) => {
      await tx`insert into organizations(id,name,slug) values(${org},'Native calendar',${org})`;
      await tx`insert into buildings(id,organization_id,name,code) values(${buildingId},${org},'Own','OWN'),(${foreign},${org},'Foreign','OTHER')`;
      for (const id of [user, neighbor])
        await tx`insert into users(id,name,email,password_hash) values(${id},${id},${id + "@mobile.invalid"},${hash})`;
      for (const role of [baseRole, calendarRole])
        await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      for (const capability of [
        "common-areas:read",
        "reservations:read-own",
        "reservations:create-own",
        "reservations:cancel-own",
      ])
        await tx`insert into role_permissions(role_key,permission_key) values(${baseRole},${capability})`;
      await tx`insert into role_permissions(role_key,permission_key) values(${calendarRole},'reservations:read-calendar')`;
      await tx`insert into role_bindings(user_id,building_id,role_key) values(${user},${buildingId},${baseRole})`;
      await tx`insert into common_areas(id,building_id,name,requires_approval) values(${areaId},${buildingId},'Allowed area',false),(${otherArea},${buildingId},'Other area',false),(${foreignArea},${foreign},'Foreign area',false)`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${binding},${user},${buildingId},${calendarRole},'common_area',${areaId})`;
      await tx`insert into reservations(id,building_id,area_id,user_id,starts_at,ends_at,status,unit,notes) values(${neighborBooking},${buildingId},${areaId},${neighbor},${startsAt},${endsAt},'CONFIRMED','PRIVATE UNIT','PRIVATE NOTES')`;
    });
    let tokens: SessionTokens | null = null;
    const api = createApiClient({
      baseUrl: server.url,
      fetch,
      storage: {
        async getTokens() {
          return tokens;
        },
        async setTokens(value) {
          tokens = value;
        },
        async clearTokens() {
          tokens = null;
        },
      },
    });
    await api.login(user + "@mobile.invalid", "predioon123");
    const occupied = await readReservationCalendar(api, query);
    assert.deepEqual(occupied, {
      authorized: true,
      items: [{ startsAt, endsAt }],
    });
    const raw = await api.get<{ items: Array<Record<string, unknown>> }>(
      reservationAvailabilityPath(query),
    );
    assert.deepEqual(Object.keys(raw.items[0]!).sort(), ["endsAt", "startsAt"]);
    for (const secret of [neighborBooking, neighbor, "PRIVATE"])
      assert.equal(JSON.stringify(raw).includes(secret), false);
    for (const deniedQuery of [
      { ...query, areaId: otherArea },
      { ...query, buildingId: foreign, areaId: foreignArea },
    ])
      assert.deepEqual(await readReservationCalendar(api, deniedQuery), {
        authorized: false,
        items: [],
      });
    await assert.rejects(
      api.post("/reservations", { areaId, startsAt, endsAt }),
      (error) => error instanceof ApiError && error.status === 409,
    );
    assert.equal(
      (
        await sqlClient`select count(*)::int as total from reservations where user_id=${user}`
      )[0]!.total,
      0,
    );
    assert.equal(
      (
        await sqlClient`select count(*)::int as total from audit_logs where user_id=${user} and action='RESERVATION_CREATED'`
      )[0]!.total,
      0,
    );
    // Explicit external actor in the fixture; not a native UI action.
    await sqlClient`update reservations set status='CANCELLED' where id=${neighborBooking}`;
    assert.deepEqual(await readReservationCalendar(api, query), {
      authorized: true,
      items: [],
    });
    const created = await api.post<{ id: string; status: string }>(
      "/reservations",
      { areaId, startsAt, endsAt },
    );
    assert.equal(created.status, "CONFIRMED");
    assert.equal((await readReservationCalendar(api, query)).items.length, 1);
    await api.delete(`/reservations/${created.id}`);
    assert.deepEqual(await readReservationCalendar(api, query), {
      authorized: true,
      items: [],
    });
    assert.equal(
      (
        await sqlClient`select status from reservations where id=${created.id}`
      )[0]!.status,
      "CANCELLED",
    );
    await sqlClient`update role_bindings set active=false where id=${binding}`;
    assert.deepEqual(await readReservationCalendar(api, query), {
      authorized: false,
      items: [],
    });
    await assert.rejects(
      api.get(reservationAvailabilityPath(query)),
      (error) => error instanceof ApiError && error.status === 403,
    );
    assert.equal(
      (
        await api.get<{ items: unknown[] }>(
          `/reservations?buildingId=${buildingId}&mine=true`,
        )
      ).items.length,
      1,
    );
    await api.logout();
  } finally {
    await server.close();
    await sqlClient.begin(async (tx) => {
      await tx`delete from audit_logs where user_id in ${tx([user, neighbor])}`;
      await tx`delete from buildings where organization_id=${org}`;
      await tx`delete from organizations where id=${org}`;
      await tx`delete from users where id in ${tx([user, neighbor])}`;
      await tx`delete from roles where key in ${tx([baseRole, calendarRole])}`;
    });
  }
});
