import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sqlClient } from "../../packages/db/src/index.ts";
import { closeAppDb } from "../../packages/db/src/runtime.ts";
import { startTestServer, call } from "../../apps/api/test/helpers.ts";
import {
  cleanup,
  createFixture,
  cancelNeighbor,
  revokeCalendar,
  snapshot,
} from "./fixture.mts";

after(async () => {
  await closeAppDb();
  await sqlClient.end();
});

test("native reservation fixture proves private calendar, conflict, own cancellation, pending approval and current revocation", async () => {
  const password = "AndroidReservationPassword123";
  const server = await startTestServer();
  let f: Awaited<ReturnType<typeof createFixture>> | undefined;
  try {
    f = await createFixture(password);
    const account = f.accounts["resident-mobile"]!;
    const login = await call(server.url, "/auth/login", {
      method: "POST",
      body: { email: account.email, password },
    });
    assert.equal(login.status, 200);
    const token: string = (await login.json()).accessToken;
    const { date, nextDate } = f;
    const request = (path: string, method = "GET", body?: unknown) =>
      call(server.url, path, { token, method, body });
    const availability = (areaId: string) =>
      `/reservations/availability?${new URLSearchParams({ buildingId: account.buildingId, areaId, from: date + "T00:00:00.000Z", to: nextDate + "T00:00:00.000Z" })}`;
    const buildings = await request("/buildings");
    assert.deepEqual(
      (await buildings.json()).items.map((b: { id: string }) => b.id),
      [account.buildingId],
    );
    const areas = await request(
      `/common-areas?buildingId=${account.buildingId}`,
    );
    assert.deepEqual(
      (await areas.json()).items.map((a: { id: string }) => a.id).sort(),
      [f.ids.autoArea, f.ids.pendingArea].sort(),
    );
    const occupied = await request(availability(f.ids.autoArea!));
    assert.equal(occupied.status, 200);
    const calendar = await occupied.json();
    assert.equal(calendar.items.length, 1);
    assert.deepEqual(Object.keys(calendar.items[0]).sort(), [
      "endsAt",
      "startsAt",
    ]);
    for (const secret of f.forbidden)
      assert.equal(JSON.stringify(calendar).includes(secret), false);
    assert.deepEqual(
      (await (await request(availability(f.ids.pendingArea!))).json()).items,
      [],
    );
    assert.ok(
      [403, 404].includes(
        (await request(availability(f.ids.foreignArea!))).status,
      ),
    );
    assert.equal(
      (await request(`/reservations/${f.ids.neighborBooking}`, "DELETE"))
        .status,
      404,
    );
    const before = await snapshot(f);
    const body = {
      areaId: f.ids.autoArea,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
    };
    assert.equal((await request("/reservations", "POST", body)).status, 409);
    assert.deepEqual(await snapshot(f), before);
    await cancelNeighbor(f);
    assert.deepEqual(
      (await (await request(availability(f.ids.autoArea!))).json()).items,
      [],
    );
    const created = await request("/reservations", "POST", body);
    assert.equal(created.status, 201);
    const confirmed = await created.json();
    assert.equal(confirmed.status, "CONFIRMED");
    const cancel = await request(`/reservations/${confirmed.id}`, "DELETE");
    assert.equal(cancel.status, 204);
    assert.deepEqual(
      (await (await request(availability(f.ids.autoArea!))).json()).items,
      [],
    );
    const pendingResponse = await request("/reservations", "POST", {
      ...body,
      areaId: f.ids.pendingArea,
    });
    assert.equal(pendingResponse.status, 201);
    const pending = await pendingResponse.json();
    assert.equal(pending.status, "PENDING");
    assert.equal(
      (
        await request(`/reservations/${pending.id}/decision`, "POST", {
          status: "CONFIRMED",
        })
      ).status,
      403,
    );
    await revokeCalendar(f);
    assert.equal((await request(availability(f.ids.autoArea!))).status, 403);
    assert.equal((await request(availability(f.ids.pendingArea!))).status, 403);
    const mine = await request(
      `/reservations?buildingId=${account.buildingId}&mine=true`,
    );
    assert.equal(mine.status, 200);
    assert.deepEqual(
      (await mine.json()).items.map((r: { status: string }) => r.status).sort(),
      ["CANCELLED", "PENDING"],
    );
    assert.deepEqual(await snapshot(f), {
      ownTotal: 2,
      ownConfirmed: 0,
      ownPending: 1,
      ownCancelled: 1,
      createdAudits: 2,
      cancelledAudits: 1,
      neighborStatus: "CANCELLED",
      calendarGrantsActive: 0,
      foreignStatus: "CONFIRMED",
    });
  } finally {
    await server.close();
    if (f) await cleanup(f);
  }
});
