import test from "node:test";
import assert from "node:assert/strict";
import { sortWorkOrders, workOrderActions } from "../src/work-orders.ts";

test("only the assignee or a distributor sees execution actions, and closed work has none", () => {
  assert.deepEqual(workOrderActions({ status: "OPEN", assignedToMe: false }, false), []);
  assert.deepEqual(workOrderActions({ status: "OPEN", assignedToMe: true }, false).map((action) => action.status), ["IN_PROGRESS"]);
  assert.deepEqual(workOrderActions({ status: "IN_PROGRESS", assignedToMe: false }, true).map((action) => action.status), ["DONE", "OPEN"]);
  assert.ok(workOrderActions({ status: "IN_PROGRESS", assignedToMe: true }, false)[0]?.confirm, "completing asks for confirmation");
  for (const status of ["DONE", "CANCELLED"] as const) assert.deepEqual(workOrderActions({ status, assignedToMe: true }, true), []);
  for (const status of ["OPEN", "IN_PROGRESS"] as const) {
    assert.ok(!workOrderActions({ status, assignedToMe: true }, true).some((action) => action.status === "CANCELLED"), "cancelling stays on the web panel");
  }
});

test("open and urgent work comes first, then the nearest deadline, then the newest", () => {
  const order = (id: string, status: "OPEN" | "IN_PROGRESS" | "DONE", priority: "LOW" | "NORMAL" | "HIGH" | "URGENT", dueAt: string | null, createdAt: string) =>
    ({ id, status, priority, dueAt, createdAt });
  const sorted = sortWorkOrders([
    order("done-urgent", "DONE", "URGENT", null, "2026-10-01T00:00:00Z"),
    order("low", "OPEN", "LOW", null, "2026-10-01T00:00:00Z"),
    order("high-late", "IN_PROGRESS", "HIGH", "2026-10-09T00:00:00Z", "2026-10-01T00:00:00Z"),
    order("high-soon", "OPEN", "HIGH", "2026-10-07T00:00:00Z", "2026-10-01T00:00:00Z"),
    order("high-none-new", "OPEN", "HIGH", null, "2026-10-03T00:00:00Z"),
    order("high-none-old", "OPEN", "HIGH", null, "2026-10-02T00:00:00Z"),
    order("urgent", "OPEN", "URGENT", null, "2026-10-01T00:00:00Z"),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["urgent", "high-soon", "high-late", "high-none-new", "high-none-old", "low", "done-urgent"]);
});
