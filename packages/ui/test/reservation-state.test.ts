import assert from "node:assert/strict";
import test from "node:test";
import { dayAvailability, freeWindows, monthGrid, reservationDayWindow, shiftMonth } from "../src/reservation-state.ts";

test("month grid covers six weeks from the Sunday before the 1st", () => {
  const grid = monthGrid("2026-10")!;
  assert.equal(grid.days.length, 42);
  assert.equal(grid.days[0], "2026-09-27");
  assert.equal(grid.days[4], "2026-10-01");
  assert.equal(grid.days.at(-1), "2026-11-07");
  assert.ok(Date.parse(grid.monthTo) - Date.parse(grid.monthFrom) <= 31 * 86_400_000);
  assert.equal(new Date(grid.monthFrom).getDate(), 1);
  assert.equal(monthGrid("2026-13"), null);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("free windows leave out busy hours, the past and stretches too short to book", () => {
  const morning = new Date(2030, 0, 10, 0, 0).getTime();
  const iso = (hours: number, minutes = 0) => new Date(2030, 0, 10, hours, minutes).toISOString();
  assert.deepEqual(freeWindows("2030-01-10", "08:00", "22:00", [], morning), [{ start: "08:00", end: "22:00" }]);
  assert.deepEqual(freeWindows("2030-01-10", "08:00", "22:00", [{ startsAt: iso(12), endsAt: iso(16) }, { startsAt: iso(18), endsAt: iso(21, 45) }], morning),
    [{ start: "08:00", end: "12:00" }, { start: "16:00", end: "18:00" }]);
  assert.deepEqual(freeWindows("2030-01-10", "08:00", "22:00", [], new Date(2030, 0, 10, 15, 0).getTime()), [{ start: "15:00", end: "22:00" }]);
  assert.deepEqual(freeWindows("2030-01-10", "18:00", "00:00", [], morning), [{ start: "18:00", end: "24:00" }]);
  assert.deepEqual(freeWindows("2030-01-10", "08:00", "22:00", [{ startsAt: iso(7), endsAt: iso(23) }], morning), []);
});

test("day availability tells free, partial, full and past days apart", () => {
  const before = new Date(2030, 0, 9, 12, 0).getTime();
  const iso = (hours: number) => new Date(2030, 0, 10, hours).toISOString();
  assert.equal(dayAvailability("2030-01-10", "08:00", "22:00", [], before), "free");
  assert.equal(dayAvailability("2030-01-10", "08:00", "22:00", [{ startsAt: iso(10), endsAt: iso(12) }], before), "partial");
  assert.equal(dayAvailability("2030-01-10", "08:00", "22:00", [{ startsAt: iso(8), endsAt: iso(22) }], before), "full");
  assert.equal(dayAvailability("2030-01-08", "08:00", "22:00", [], before), "past");
});

test("calendar rejects normalized invalid dates and accepts leap/month boundaries", () => {
  for (const value of ["", "2030-02-30", "2030-02-29", "2030-13-01", "2030-00-10", "2030-01-00", "03/01/2030", "2030-01-01T12:00Z"])
    assert.equal(reservationDayWindow(value), null, value);
  for (const value of ["2032-02-29", "2030-12-31", "2030-04-30"]) {
    const result = reservationDayWindow(value)!;
    const from = new Date(result.from), to = new Date(result.to);
    assert.equal(from.getHours(), 0);
    assert.equal(to.getHours(), 0);
    assert.equal(from.getDate(), Number(value.slice(8)));
    assert.ok(to.getTime() > from.getTime());
    assert.equal(result.from.endsWith("Z"), true);
    assert.equal(result.to.endsWith("Z"), true);
    assert.equal(to.getDate(), 1);
  }
});

test("calendar keeps the whole civil day through daylight-saving changes", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const spring = reservationDayWindow("2026-03-08")!;
    const autumn = reservationDayWindow("2026-11-01")!;
    assert.equal(Date.parse(spring.to) - Date.parse(spring.from), 23 * 3_600_000);
    assert.equal(Date.parse(autumn.to) - Date.parse(autumn.from), 25 * 3_600_000);
    for (const period of [spring, autumn]) {
      assert.equal(new Date(period.from).getHours(), 0);
      assert.equal(new Date(period.to).getHours(), 0);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
