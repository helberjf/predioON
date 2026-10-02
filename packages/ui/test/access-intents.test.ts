import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAccessIntentStore,
  createAccessInteractionGuard,
} from "../src/access-intents.ts";

const command = {
  id: "command-a",
  requestId: "request-a",
  gateId: "gate-a",
  status: "PENDING" as const,
  createdAt: "2026-10-02T12:00:00Z",
  expiresAt: "2026-10-02T12:00:15Z",
  failureReason: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

test("a duplicate gesture cannot submit twice while one physical request is pending", async () => {
  const store = createAccessIntentStore(() => command.requestId),
    response = deferred<typeof command>();
  let sent = 0;
  const post = async () => {
    sent++;
    return response.promise;
  };
  const first = store.submit("building-a", "gate-a", post);
  await store.submit("building-a", "gate-a", post);
  assert.equal(sent, 1);
  response.resolve(command);
  await first;
  assert.equal(
    store.getSnapshot()[store.key("building-a", "gate-a")]?.command?.id,
    command.id,
  );
});

test("a lost response keeps its requestId across view subscriptions and tenant selections", async () => {
  let generated = 0;
  const store = createAccessIntentStore(() => `request-${++generated}`),
    sent: string[] = [];
  const cancel = store.subscribe(() => {});
  await store.submit("building-a", "gate-a", async (id) => {
    sent.push(id);
    throw new Error("lost response");
  });
  cancel();
  const remounted = store.subscribe(() => {});
  await store.submit("building-b", "gate-b", async (id) => ({
    ...command,
    id: "command-b",
    gateId: "gate-b",
    requestId: id,
  }));
  await store.submit("building-a", "gate-a", async (id) => {
    sent.push(id);
    return { ...command, requestId: id };
  });
  remounted();
  assert.deepEqual(sent, ["request-1", "request-1"]);
  assert.equal(generated, 2);
});

test("mounting, observing and reading state never send physical commands", async () => {
  let sent = 0;
  const store = createAccessIntentStore(() => command.requestId);
  await store.submit("building-a", "gate-a", async () => {
    sent++;
    throw new Error("uncertain");
  });
  const remove = store.subscribe(() => {});
  store.getSnapshot();
  store.observe("building-a", "gate-a", { ...command, status: "SENT" });
  remove();
  assert.equal(sent, 1);
  assert.equal(
    store.getSnapshot()[store.key("building-a", "gate-a")]?.command?.status,
    "SENT",
  );
});

test("a different latest request cannot replace or settle the local uncertain intent", async () => {
  const store = createAccessIntentStore(() => command.requestId);
  await store.submit("building-a", "gate-a", async () => {
    throw new Error("uncertain");
  });
  store.observe("building-a", "gate-a", {
    ...command,
    id: "other-command",
    requestId: "other-request",
    status: "ACKNOWLEDGED",
  });
  assert.equal(
    store.getSnapshot()[store.key("building-a", "gate-a")]?.command,
    null,
  );
  store.observe("building-a", "gate-a", {
    ...command,
    gateId: "other-gate",
    status: "ACKNOWLEDGED",
  });
  assert.equal(
    store.getSnapshot()[store.key("building-a", "gate-a")]?.command,
    null,
  );
});

test("a late HTTP receipt cannot regress a confirmed command observed while awaiting the response", async () => {
  const store = createAccessIntentStore(() => command.requestId),
    response = deferred<typeof command>();
  const pending = store.submit("building-a", "gate-a", () => response.promise);
  store.observe("building-a", "gate-a", { ...command, status: "ACKNOWLEDGED" });
  response.resolve(command);
  await pending;
  assert.equal(
    store.getSnapshot()[store.key("building-a", "gate-a")]?.command?.status,
    "ACKNOWLEDGED",
  );
});

test("session invalidation clears intents and ignores late receipts or new calls on the old store", async () => {
  const store = createAccessIntentStore(() => command.requestId),
    response = deferred<typeof command>();
  let sent = 0;
  const pending = store.submit("building-a", "gate-a", async () => {
    sent++;
    return response.promise;
  });
  store.invalidate();
  response.resolve(command);
  await pending;
  await store.submit("building-a", "gate-a", async () => {
    sent++;
    return command;
  });
  assert.deepEqual(store.getSnapshot(), {});
  assert.equal(sent, 1);
});

test("only a settled request permits a newly generated physical intention", async () => {
  let generated = 0;
  const store = createAccessIntentStore(() => `request-${++generated}`);
  let sent = 0;
  const post = async (id: string) => {
    sent++;
    return { ...command, requestId: id };
  };
  await store.submit("building-a", "gate-a", post);
  await store.submit("building-a", "gate-a", post);
  assert.equal(sent, 1);
  store.observe("building-a", "gate-a", {
    ...command,
    requestId: "request-1",
    status: "FAILED",
  });
  await store.submit("building-a", "gate-a", post);
  assert.equal(sent, 2);
  assert.equal(generated, 2);
});

test("a mismatched POST response stays uncertain under the original request identity", async () => {
  const store = createAccessIntentStore(() => command.requestId);
  await store.submit("building-a", "gate-a", async () => ({
    ...command,
    requestId: "unexpected",
  }));
  const intent = store.getSnapshot()[store.key("building-a", "gate-a")];
  assert.equal(intent?.command, null);
  assert.equal(intent?.requestId, command.requestId);
  assert.equal(intent?.pending, false);
  assert.match(intent?.error ?? "", /corresponde/);
});

test("navigation or background invalidates a captured confirmation even after returning to the same view", () => {
  const guard = createAccessInteractionGuard(),
    before = guard.capture();
  assert.equal(guard.isCurrent(before), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(before), false);
  const returned = guard.capture();
  assert.equal(guard.isCurrent(returned), true);
  assert.equal(guard.isCurrent(before), false);
  guard.invalidate();
  assert.equal(guard.isCurrent(returned), false);
});
