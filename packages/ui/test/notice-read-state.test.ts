import assert from "node:assert/strict";
import { test } from "node:test";
const state = await import("../src/notice-read-state.ts");
const now = new Date("2026-10-26T12:00:00Z");
const one = { id: "one", publishedAt: "2026-10-25T12:00:00Z", expiresAt: null };
const two = { ...one, id: "two" };

test("new notices exclude future and expired publications, including pinned ones", () => {
  const future = { ...one, id: "future", publishedAt: "2026-10-27T12:00:00Z" };
  const expired = { ...one, id: "expired", expiresAt: now.toISOString() };
  assert.deepEqual(state.unreadNotices([one, future, expired, two], [], now), [one, two]);
});
test("reading persists across serialization and a new backdated notice still counts", () => {
  const seen = state.markNoticesSeen([], [one], now);
  const restored = state.parseSeenNotices(JSON.stringify(seen));
  assert.deepEqual(state.unreadNotices([one, two], restored, now), [two]);
  assert.deepEqual(state.markNoticesSeen(seen, [one], now), seen);
});
test("a scheduled notice is not marked seen before it becomes visible", () => {
  const future = { ...one, publishedAt: "2026-10-27T12:00:00Z" };
  const seen = state.markNoticesSeen([], [future], now);
  assert.deepEqual(state.unreadNotices([future], seen, new Date("2026-10-28T12:00:00Z")), [future]);
});
test("republishing an existing notice counts as new", () => {
  const seen = state.markNoticesSeen([], [one], now);
  const republished = { ...one, publishedAt: now.toISOString() };
  assert.deepEqual(state.unreadNotices([republished], seen, now), [republished]);
});
test("corrupt local history recovers without hiding new notices", () => {
  for (const raw of [null, "broken", "{}", "null", "[null,2]"]) assert.deepEqual(state.parseSeenNotices(raw), []);
});
test("history keys isolate each user and condominium without separator collisions", () => {
  assert.notEqual(state.noticeReadKey("u", "a"), state.noticeReadKey("u", "b"));
  assert.notEqual(state.noticeReadKey("u", "a"), state.noticeReadKey("v", "a"));
  assert.notEqual(state.noticeReadKey("u:a", "b"), state.noticeReadKey("u", "a:b"));
});
