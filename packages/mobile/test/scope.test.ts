import test from "node:test";
import assert from "node:assert/strict";
import {
  ownedTickets,
  reservationWindow,
  screensFor,
  transparencySections,
  validateApiUrl,
  type Scope,
} from "../src/scope.ts";

const resident: Scope = {
  buildingId: "one",
  capabilities: [
    "buildings:read",
    "notices:read",
    "occurrences:create-own",
    "occurrences:read-own",
    "telemetry:read-published",
  ],
  features: ["NOTICES", "TICKETS", "RESERVATIONS"].map((key) => ({
    key,
    enabled: true,
  })),
};
test("resident audience never exposes operational screens even for a manager account", () => {
  const manager: Scope = {
    ...resident,
    capabilities: [
      ...resident.capabilities,
      "telemetry:read",
      "alerts:read",
      "alerts:resolve",
      "occurrences:manage",
    ],
  };
  assert.deepEqual(screensFor("resident", manager), [
    "notices",
    "tickets",
    "reservations",
  ]);
  assert.deepEqual(screensFor("operations", resident), []);
  assert.deepEqual(screensFor("operations", manager), [
    "overview",
    "alerts",
    "readings",
    "tickets",
  ]);
});
test("changing to a tenant with no grants removes all prior screens", () => {
  assert.deepEqual(
    screensFor("resident", {
      ...resident,
      buildingId: "two",
      capabilities: [],
    }),
    [],
  );
  assert.deepEqual(
    screensFor("operations", {
      ...resident,
      buildingId: "two",
      capabilities: [],
    }),
    [],
  );
});
test("feature disable and missing feature state fail closed", () => {
  assert.deepEqual(screensFor("resident", { ...resident, features: [] }), []);
  assert.deepEqual(
    screensFor("resident", {
      ...resident,
      features: [
        { key: "TICKETS", enabled: false },
        { key: "NOTICES", enabled: true },
      ],
    }),
    ["notices"],
  );
});
test("resident finance and access navigation follows tenant features without inventing operator grants", () => {
  const features = [
    "TRANSPARENCY",
    "FINANCE",
    "GARAGE_ACCESS",
    "PEDESTRIAN_ACCESS",
  ].map((key) => ({ key, enabled: true }));
  assert.deepEqual(screensFor("resident", { ...resident, features }), [
    "transparency",
    "access",
  ]);
  assert.deepEqual(screensFor("operations", { ...resident, features }), []);
  assert.deepEqual(
    screensFor("resident", { ...resident, features, capabilities: [] }),
    [],
  );
  assert.deepEqual(
    screensFor("resident", {
      ...resident,
      features: [{ key: "FINANCE", enabled: true }],
    }),
    ["transparency"],
  );
});
test("a notices-only reader sees GESTAO transparency without issuing a financial query", () => {
  const scope: Scope = {
    buildingId: "one",
    capabilities: ["notices:read"],
    features: [
      { key: "NOTICES", enabled: false },
      { key: "TRANSPARENCY", enabled: true },
      { key: "FINANCE", enabled: true },
    ],
  };
  assert.deepEqual(screensFor("resident", scope), ["transparency"]);
  assert.deepEqual(transparencySections(scope), {
    notices: true,
    finance: false,
  });
  assert.deepEqual(
    transparencySections({ ...scope, capabilities: ["buildings:read"] }),
    { notices: false, finance: true },
  );
});
test("resident product filters third-party tickets even when user has management scope", () => {
  const items = [
    { id: "own", openedBy: "me" },
    { id: "other", openedBy: "neighbor" },
  ];
  assert.deepEqual(
    ownedTickets(items, "me", "resident").map((item) => item.id),
    ["own"],
  );
  assert.equal(ownedTickets(items, "me", "operations").length, 2);
});
test("production API requires HTTPS and never accepts embedded credentials", () => {
  assert.equal(
    validateApiUrl("https://api.example.test/", false),
    "https://api.example.test",
  );
  assert.equal(
    validateApiUrl("http://10.0.2.2:3000", true),
    "http://10.0.2.2:3000",
  );
  for (const url of [
    "http://api.example.test",
    "https://user:password@api.example.test",
    "https://api.example.test?token=secret",
    "https://api.example.test#secret",
    "file:///test",
    "",
  ])
    assert.throws(() => validateApiUrl(url, false));
});
test("reservation validation prevents normalized invalid dates and durations", () => {
  assert.throws(
    () => reservationWindow("2030-02-30", "19:00", "1", 4, 0),
    /data válida/,
  );
  assert.throws(
    () => reservationWindow("2030-12-20", "25:00", "1", 4, 0),
    /horário/,
  );
  for (const hours of ["0", "-1", "5", "Infinity", "hello"])
    assert.throws(
      () => reservationWindow("2030-12-20", "19:00", hours, 4, 0),
      /duração/,
    );
  assert.throws(
    () =>
      reservationWindow("2020-12-20", "19:00", "1", 4, Date.UTC(2030, 0, 1)),
    /futuro/,
  );
  const window = reservationWindow("2030-12-20", "19:00", "1.5", 4, 0);
  assert.equal(
    Date.parse(window.endsAt) - Date.parse(window.startsAt),
    5_400_000,
  );
});
