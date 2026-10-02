import test from "node:test";
import assert from "node:assert/strict";
import {
  ownedTickets,
  reservationActions,
  reservationWindow,
  screensFor,
  transparencySections,
  validateApiUrl,
  type Scope,
} from "../src/scope.ts";
import type { BuildingOverview } from "@predioon/contracts";

const partialOverview: BuildingOverview = {
  buildingId: "one",
  coverage: {
    devices: "none",
    gateways: "none",
    alerts: "partial",
    telemetry: "none",
    occurrences: "partial",
  },
  occurrenceVisibility: "scoped",
  counts: {
    devices: null,
    devices_online: null,
    gateways: null,
    gateways_online: null,
    open_alerts: 0,
    open_occurrences: 1,
  },
  latestAlerts: [],
  gateways: [],
};

const resident: Scope = {
  buildingId: "one",
  capabilities: [
    "buildings:read",
    "notices:read",
    "occurrences:create-own",
    "occurrences:read-own",
    "common-areas:read",
    "reservations:read-own",
    "reservations:create-own",
    "reservations:cancel-own",
    "telemetry:read-published",
    "finance:read-published",
    "gates:read",
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
test("current partial API coverage opens only its operation domains without promoting capabilities", () => {
  const scope = {
    buildingId: "one",
    capabilities: [],
    features: [{ key: "TICKETS", enabled: true }],
    overview: partialOverview,
  };
  assert.deepEqual(screensFor("operations", scope), [
    "overview",
    "alerts",
    "tickets",
  ]);
  assert.deepEqual(scope.capabilities, []);
  assert.deepEqual(screensFor("resident", scope), []);
  assert.deepEqual(
    screensFor("operations", { ...scope, buildingId: "other" }),
    [],
  );
  assert.deepEqual(screensFor("operations", { ...scope, overview: null }), []);
});
test("an authorized own occurrence count opens the summary and ticket list without technical grants", () => {
  const overview: BuildingOverview = {
    ...partialOverview,
    coverage: { ...partialOverview.coverage, alerts: "none" },
    occurrenceVisibility: "own",
    counts: {
      ...partialOverview.counts,
      open_alerts: null,
      open_occurrences: 0,
    },
  };
  const scope = {
    buildingId: "one",
    capabilities: [],
    features: [{ key: "TICKETS", enabled: true }],
    overview,
  };
  assert.deepEqual(screensFor("operations", scope), ["overview", "tickets"]);
  assert.deepEqual(
    screensFor("operations", {
      ...scope,
      features: [{ key: "TICKETS", enabled: false }],
    }),
    [],
  );
});
test("reservation navigation and actions do not borrow ticket or building permissions", () => {
  const scope: Scope = {
    buildingId: "one",
    capabilities: ["occurrences:read-own", "buildings:manage"],
    features: [{ key: "RESERVATIONS", enabled: true }],
  };
  assert.deepEqual(screensFor("resident", scope), []);
  assert.deepEqual(reservationActions(scope), {
    read: false,
    areas: false,
    create: false,
    cancel: false,
  });
  const readOnly = {
    ...scope,
    capabilities: ["reservations:read-own"] as Scope["capabilities"],
  };
  assert.deepEqual(screensFor("resident", readOnly), ["reservations"]);
  assert.deepEqual(reservationActions(readOnly), {
    read: true,
    areas: false,
    create: false,
    cancel: false,
  });
  assert.deepEqual(reservationActions(resident), {
    read: true,
    areas: true,
    create: true,
    cancel: true,
  });
  assert.equal(
    reservationActions({
      ...resident,
      capabilities: resident.capabilities.filter(
        (capability) => capability !== "common-areas:read",
      ),
    }).create,
    false,
  );
  assert.equal(
    reservationActions({
      ...resident,
      capabilities: resident.capabilities.filter(
        (capability) => capability !== "reservations:create-own",
      ),
    }).create,
    false,
  );
  assert.equal(
    reservationActions({
      ...resident,
      capabilities: resident.capabilities.filter(
        (capability) => capability !== "reservations:cancel-own",
      ),
    }).cancel,
    false,
  );
  assert.deepEqual(
    reservationActions({
      ...resident,
      features: [{ key: "RESERVATIONS", enabled: false }],
    }),
    { read: false, areas: false, create: false, cancel: false },
  );
  assert.deepEqual(
    reservationActions({ ...scope, capabilities: ["reservations:manage"] }),
    { read: false, areas: false, create: false, cancel: false },
  );
  assert.deepEqual(
    reservationActions({
      ...scope,
      capabilities: ["reservations:manage", "common-areas:read"],
    }),
    { read: true, areas: true, create: false, cancel: true },
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
test("resident access navigation requires current gate authority and never borrows a building or neighbor grant", () => {
  const scope = {
    buildingId: "one",
    capabilities: [],
    features: [{ key: "GARAGE_ACCESS", enabled: true }],
  };
  assert.deepEqual(
    screensFor("resident", { ...scope, capabilities: ["buildings:read"] }),
    [],
  );
  assert.deepEqual(
    screensFor("resident", { ...scope, capabilities: ["commands:request"] }),
    [],
  );
  assert.deepEqual(
    screensFor("resident", { ...scope, capabilities: ["gates:read"] }),
    ["access"],
  );
  const authorized = {
    ...scope,
    access: { buildingId: "one", readable: true },
  };
  assert.deepEqual(screensFor("resident", authorized), ["access"]);
  assert.deepEqual(
    screensFor("resident", { ...authorized, buildingId: "other" }),
    [],
  );
  assert.deepEqual(
    screensFor("resident", {
      ...authorized,
      access: { buildingId: "one", readable: false },
    }),
    [],
  );
  assert.deepEqual(
    screensFor("resident", {
      ...authorized,
      capabilities: ["gates:read"],
      access: null,
    }),
    [],
  );
  assert.deepEqual(
    screensFor("resident", {
      ...authorized,
      features: [{ key: "GARAGE_ACCESS", enabled: false }],
    }),
    [],
  );
  assert.deepEqual(screensFor("operations", authorized), []);
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
    { notices: false, finance: false },
  );
});
test("financial readers need their own current permission and enabled feature, without building discovery", () => {
  const scope: Scope = {
    buildingId: "one",
    capabilities: [],
    features: [{ key: "FINANCE", enabled: true }],
  };
  for (const capability of [
    "finance:read-published",
    "finance:read",
  ] as const) {
    const reader = { ...scope, capabilities: [capability] };
    assert.deepEqual(transparencySections(reader), {
      notices: false,
      finance: true,
    });
    assert.deepEqual(screensFor("resident", reader), ["transparency"]);
    assert.deepEqual(transparencySections({ ...reader, features: [] }), {
      notices: false,
      finance: false,
    });
    assert.deepEqual(
      transparencySections({
        ...reader,
        features: [{ key: "FINANCE", enabled: false }],
      }),
      { notices: false, finance: false },
    );
  }
  for (const capabilities of [
    [],
    ["finance:manage"],
    ["buildings:read"],
    ["buildings:manage"],
  ] as const) {
    assert.deepEqual(screensFor("resident", { ...scope, capabilities }), []);
  }
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
