import test from "node:test";
import assert from "node:assert/strict";
import type {
  AccessCommandView,
  AccessGateView,
  FinancialReport,
} from "@predioon/contracts";
import {
  createAccessIntentStore,
  commandMessage,
  reconcileCommand,
  requestIdFromBytes,
} from "../src/access-intents.ts";
import {
  publishedReports,
  residentGates,
  safeReceiptUrl,
  validReportMonth,
} from "../src/resident-services.ts";

const command = (
  status: AccessCommandView["status"],
  overrides: Partial<AccessCommandView> = {},
): AccessCommandView => ({
  id: "command-one",
  gateId: "gate",
  requestId: "intent-one",
  status,
  createdAt: "2030-01-01T12:00:00Z",
  expiresAt: "2030-01-01T12:00:15Z",
  failureReason: null,
  ...overrides,
});

test("physical results are monotone and unrelated commands never settle the current intent", () => {
  const sent = command("SENT");
  assert.equal(reconcileCommand(sent, command("PENDING")), sent);
  assert.equal(
    reconcileCommand(sent, command("ACKNOWLEDGED", { requestId: "other" })),
    sent,
  );
  assert.equal(
    reconcileCommand(sent, command("ACKNOWLEDGED", { gateId: "other" })),
    sent,
  );
  const acknowledged = command("ACKNOWLEDGED");
  assert.equal(
    reconcileCommand(acknowledged, command("EXPIRED")),
    acknowledged,
  );
  assert.equal(
    reconcileCommand(command("EXPIRED"), acknowledged)?.status,
    "ACKNOWLEDGED",
  );
  assert.match(commandMessage(sent), /enviado/i);
  assert.match(commandMessage(acknowledged), /controlador/i);
  assert.match(commandMessage(acknowledged), /posição física/i);
});

test("lost POST response is never retried automatically and explicit recovery reuses its requestId", async () => {
  let ids = 0;
  const store = createAccessIntentStore(() => `intent-${++ids}`);
  const posts: string[] = [];
  await store.submit("building", "gate", async (requestId) => {
    posts.push(requestId);
    throw new Error("offline");
  });
  assert.deepEqual(posts, ["intent-1"]);
  assert.equal(
    store.getSnapshot()[store.key("building", "gate")].command,
    null,
  );
  store.observe(
    "building",
    "gate",
    command("ACKNOWLEDGED", { requestId: "someone-else" }),
  );
  assert.deepEqual(posts, ["intent-1"]);
  await store.submit("building", "gate", async (requestId) => {
    posts.push(requestId);
    return command("SENT", { requestId });
  });
  assert.deepEqual(posts, ["intent-1", "intent-1"]);
  await store.submit("building", "gate", async () => {
    throw new Error("must not send a pending intent twice");
  });
  assert.equal(ids, 1);
  store.observe(
    "building",
    "gate",
    command("ACKNOWLEDGED", { requestId: "intent-1" }),
  );
  await store.submit("building", "gate", async (requestId) => {
    posts.push(requestId);
    return command("PENDING", { id: "command-two", requestId });
  });
  assert.deepEqual(posts, ["intent-1", "intent-1", "intent-2"]);
});

test("concurrent taps cannot send twice and late HTTP responses cannot regress a GET acknowledgement", async () => {
  const store = createAccessIntentStore(() => "intent-one");
  let finish!: (value: AccessCommandView) => void;
  let calls = 0;
  const post = () => {
    calls++;
    return new Promise<AccessCommandView>((resolve) => {
      finish = resolve;
    });
  };
  const first = store.submit("building", "gate", post);
  await store.submit("building", "gate", post);
  assert.equal(calls, 1);
  store.observe("building", "gate", command("ACKNOWLEDGED"));
  finish(command("PENDING"));
  await first;
  assert.equal(
    store.getSnapshot()[store.key("building", "gate")].command?.status,
    "ACKNOWLEDGED",
  );
});

test("session invalidation prevents old confirmation handlers from sending and clears in-memory intents", async () => {
  const store = createAccessIntentStore(() => "intent-one");
  let finish!: (value: AccessCommandView) => void;
  const pending = store.submit(
    "building",
    "gate",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.invalidate();
  finish(command("SENT"));
  await pending;
  await store.submit("building", "gate", async () => {
    throw new Error("old session must not send");
  });
  assert.deepEqual(store.getSnapshot(), {});
});

test("tenant changes preserve their own uncertain intent without mixing another gate response", async () => {
  let ids = 0;
  const store = createAccessIntentStore(() => `intent-${++ids}`);
  await store.submit("one", "gate", async () => {
    throw new Error("offline");
  });
  await store.submit("two", "gate", async () => {
    throw new Error("offline");
  });
  store.observe(
    "two",
    "gate",
    command("ACKNOWLEDGED", { requestId: "intent-1" }),
  );
  assert.equal(store.getSnapshot()[store.key("two", "gate")].command, null);
  await store.submit("one", "gate", async (requestId) => {
    assert.equal(requestId, "intent-1");
    return command("ACKNOWLEDGED", { requestId: "mismatched-response" });
  });
  assert.equal(ids, 2);
  assert.equal(store.getSnapshot()[store.key("one", "gate")].command, null);
  assert.match(
    store.getSnapshot()[store.key("one", "gate")].error!,
    /não corresponde/,
  );
});

test("idempotency UUIDs use native random bytes and RFC 4122 version/variant bits", () => {
  const bytes = new Uint8Array(16).fill(255);
  assert.equal(
    requestIdFromBytes(bytes),
    "ffffffff-ffff-4fff-bfff-ffffffffffff",
  );
  assert.equal(bytes[6], 255, "must not mutate the random source");
  assert.throws(() => requestIdFromBytes(new Uint8Array(4)));
});

test("resident financial view omits drafts, future publications and another building even for managers", () => {
  const report = {
    id: "published",
    buildingId: "one",
    publishedAt: "2030-01-01T00:00:00Z",
  } as FinancialReport;
  assert.deepEqual(
    publishedReports(
      [
        report,
        { ...report, id: "draft", publishedAt: null },
        { ...report, id: "invalid", publishedAt: "nonsense" },
        { ...report, id: "future", publishedAt: "2031-01-01T00:00:00Z" },
        { ...report, id: "other", buildingId: "two" },
      ],
      "one",
      Date.UTC(2030, 5, 1),
    ).map((item) => item.id),
    ["published"],
  );
});

test("gate audience excludes other buildings and gates not enabled for residents", () => {
  const gate = {
    id: "allowed",
    buildingId: "one",
    enabled: true,
    allowResidents: true,
    kind: "GARAGE",
  } as AccessGateView;
  assert.deepEqual(
    residentGates(
      [
        gate,
        { ...gate, id: "denied", allowResidents: false },
        { ...gate, id: "disabled", enabled: false },
        { ...gate, id: "other", buildingId: "two" },
        { ...gate, id: "pedestrian", kind: "PEDESTRIAN" },
      ],
      "one",
      [{ key: "GARAGE_ACCESS", enabled: true }],
    ).map((item) => item.id),
    ["allowed"],
  );
});

test("receipt links reject native/file/javascript schemes and embedded credentials", () => {
  assert.equal(
    safeReceiptUrl("https://receipts.example.test/a.pdf"),
    "https://receipts.example.test/a.pdf",
  );
  for (const url of [
    null,
    "",
    "javascript:alert(1)",
    "file:///secret",
    "http://example.test",
    "https://me:secret@example.test",
  ])
    assert.equal(safeReceiptUrl(url), null);
  assert.equal(validReportMonth(""), true);
  assert.equal(validReportMonth("2030-12"), true);
  for (const value of ["2030-13", "30-01", "2030-1", "2030-00"])
    assert.equal(validReportMonth(value), false);
});
