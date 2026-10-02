import assert from "node:assert/strict";
import test from "node:test";
import { reservationDayWindow } from "../src/reservation-state.ts";

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
