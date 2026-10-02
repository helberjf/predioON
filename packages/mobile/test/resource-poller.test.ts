import assert from "node:assert/strict";
import test from "node:test";
import { createResourcePoller } from "../src/resource-poller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(active = true) {
  const requests: ReturnType<typeof deferred<string>>[] = [];
  const events: string[] = [];
  const poller = createResourcePoller({
    active,
    read() { const request = deferred<string>(); requests.push(request); return request.promise; },
    loading() { events.push("loading"); },
    loaded(value) { events.push(`loaded:${value}`); },
    failed(error) { events.push(`error:${String(error)}`); },
    inactive() { events.push("cleared"); },
  });
  return { poller, requests, events };
}

test("resume waits for an old request but discards its data and immediately revalidates", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { poller, requests, events } = fixture();
  t.after(() => poller.dispose());
  poller.start();
  poller.setActive(false);
  poller.setActive(true);
  assert.equal(requests.length, 1, "foreground must not duplicate a pending request");
  requests[0]!.resolve("private response from before backgrounding");
  await Promise.resolve();
  assert.deepEqual(events, ["loading", "cleared", "loading"]);
  assert.equal(requests.length, 2, "resuming needs a fresh request without a polling delay");
  requests[1]!.resolve("current authorized data");
  await Promise.resolve();
  assert.equal(events.at(-1), "loaded:current authorized data");
  t.mock.timers.tick(14_999);
  assert.equal(requests.length, 2);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 3);
});

test("an old request error cannot replace the current foreground loading state", async t => {
  const { poller, requests, events } = fixture();
  t.after(() => poller.dispose());
  poller.start();
  poller.setActive(false);
  poller.setActive(true);
  requests[0]!.reject(new Error("old authorization result"));
  await Promise.resolve();
  assert.deepEqual(events, ["loading", "cleared", "loading"]);
  assert.equal(requests.length, 2);
});

test("background suspends polling and only fresh foreground errors are displayed", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { poller, requests, events } = fixture(false);
  t.after(() => poller.dispose());
  poller.start();
  assert.equal(requests.length, 0);
  poller.setActive(true);
  requests[0]!.resolve("current");
  await Promise.resolve();
  poller.setActive(false);
  t.mock.timers.tick(30_000);
  assert.equal(requests.length, 1);
  poller.setActive(true);
  requests[1]!.reject("forbidden");
  await Promise.resolve();
  assert.equal(events.at(-1), "error:forbidden");
});

test("unmounted resources do not publish late data or start another request", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { poller, requests, events } = fixture();
  poller.start();
  poller.dispose();
  requests[0]!.resolve("late");
  await Promise.resolve();
  poller.setActive(true);
  t.mock.timers.tick(30_000);
  assert.deepEqual(events, ["loading"]);
  assert.equal(requests.length, 1);
});
