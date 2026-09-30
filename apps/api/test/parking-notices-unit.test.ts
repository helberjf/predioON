import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parkingAvailability, acceptParkingReading, ParkingConfigSchema, ParkingOccupancySchema } from "../../../packages/shared/src/parking.js";
import { nextNoticeOccurrence, localDateTimeToIso, noticeIsVisible, NoticeScheduleSchema } from "../../../packages/shared/src/notice-schedule.js";

const now = new Date("2026-09-22T15:00:00Z");
const lot = { capacity: 20, occupied: 7, source: "MANUAL" as const, sensorId: "sensor-a", observedAt: now, staleAfterSeconds: 300 };

describe("parking availability", () => {
  it("separates known availability from missing or stale counts", () => {
    assert.deepEqual(parkingAvailability(lot, now), { available: 13, status: "CURRENT" });
    assert.deepEqual(parkingAvailability({ ...lot, occupied: null, observedAt: null }, now), { available: null, status: "UNKNOWN" });
    assert.deepEqual(parkingAvailability(lot, new Date(now.getTime() + 300_001)), { available: null, status: "STALE" });
    assert.deepEqual(parkingAvailability({ ...lot, observedAt: new Date(now.getTime() + 1) }, now), { available: null, status: "UNKNOWN" });
    assert.deepEqual(parkingAvailability({ ...lot, occupied: 21 }, now), { available: null, status: "UNKNOWN" });
  });
  it("validates counts and capacity without coercing unknown into zero", () => {
    for (const occupied of [-1, 1.1, null, "", "5"]) assert.equal(ParkingOccupancySchema.safeParse({ occupied, version: 1 }).success, false);
    for (const capacity of [-1, 1.5, null]) assert.equal(ParkingConfigSchema.safeParse({ buildingId: "b", vehicleType: "CAR", capacity }).success, false);
    assert.equal(ParkingConfigSchema.safeParse({ buildingId: "b", vehicleType: "MOTORCYCLE", capacity: 0 }).success, true);
  });
  it("ignores invalid, stale and out-of-order sensor samples", () => {
    const reading = { deviceId: "sensor-a", metric: "parking_occupied", value: 10, quality: "GOOD", timestamp: "2026-09-22T15:00:01Z" };
    const received = new Date("2026-09-22T15:00:02Z");
    assert.equal(acceptParkingReading(lot, reading, received), true);
    for (const change of [{ value: -1 }, { value: 21 }, { value: 1.5 }, { value: "10" }, { value: false }, { quality: "BAD" }, { deviceId: "other" }, { metric: "water_level" }, { timestamp: now.toISOString() }, { timestamp: "2026-09-22T15:10:00Z" }, { timestamp: "invalid" }]) {
      assert.equal(acceptParkingReading(lot, { ...reading, ...change }, received), false, JSON.stringify(change));
    }
    assert.equal(acceptParkingReading({ ...lot, observedAt: null }, reading, new Date("2026-09-22T15:06:00Z")), false);
  });
  it("accepts fresh sensor data after manual entry but rejects old buffered data", () => {
    const reading = { deviceId: "sensor-a", metric: "parking_occupied", value: 9, quality: "GOOD", timestamp: "2026-09-22T15:00:01Z" };
    assert.equal(acceptParkingReading(lot, reading, new Date("2026-09-22T15:00:02Z")), true);
    assert.equal(acceptParkingReading({ ...lot, sensorId: null }, reading, new Date("2026-09-22T15:00:02Z")), false);
  });
});

describe("notice scheduling", () => {
  it("enforces publication and expiration boundaries", () => {
    const notice = { publishedAt: now, expiresAt: new Date(now.getTime() + 1000) };
    assert.equal(noticeIsVisible(notice, new Date(now.getTime() - 1)), false);
    assert.equal(noticeIsVisible(notice, now), true);
    assert.equal(noticeIsVisible(notice, notice.expiresAt), false);
  });
  it("converts Sao Paulo local time independently from browser timezone", () => {
    assert.equal(localDateTimeToIso("2026-09-22T09:30", "America/Sao_Paulo"), "2026-09-22T12:30:00.000Z");
    assert.throws(() => localDateTimeToIso("2026-02-30T09:00", "America/Sao_Paulo"));
    assert.throws(() => localDateTimeToIso("2026-09-22T09:30", "No/Such_Zone"));
    assert.throws(() => localDateTimeToIso("2026-03-08T02:30", "America/New_York"));
    assert.throws(() => localDateTimeToIso("2026-11-01T01:30", "America/New_York"));
  });
  it("returns the next weekly occurrence including the exact boundary", () => {
    const schedule = { startsAt: "2026-09-22T12:30:00Z", recurrence: "WEEKLY" as const, timeZone: "America/Sao_Paulo" };
    assert.equal(nextNoticeOccurrence(schedule, new Date(schedule.startsAt)), "2026-09-22T12:30:00.000Z");
    assert.equal(nextNoticeOccurrence(schedule, now), "2026-09-29T12:30:00.000Z");
    assert.equal(nextNoticeOccurrence({ ...schedule, recurrence: "NONE" }, now), null);
    assert.equal(nextNoticeOccurrence(null, now), null);
  });
  it("keeps the same local hour across daylight saving changes", () => {
    const schedule = { startsAt: "2026-03-01T14:00:00Z", recurrence: "WEEKLY" as const, timeZone: "America/New_York" };
    assert.equal(nextNoticeOccurrence(schedule, new Date("2026-03-02T00:00:00Z")), "2026-03-08T13:00:00.000Z");
  });
  it("requires explicit timezone and instant for schedules", () => {
    assert.equal(NoticeScheduleSchema.safeParse({ startsAt: "2026-09-22T09:30", recurrence: "WEEKLY", timeZone: "America/Sao_Paulo" }).success, false);
    assert.equal(NoticeScheduleSchema.safeParse({ startsAt: now.toISOString(), recurrence: "MONTHLY", timeZone: "America/Sao_Paulo" }).success, false);
    assert.equal(NoticeScheduleSchema.safeParse({ startsAt: now.toISOString(), recurrence: "NONE", timeZone: "Invalid/Zone" }).success, false);
  });
});
