import test from "node:test";
import assert from "node:assert/strict";
import { createMutationRunner } from "../src/mutation-runner.ts";
import { reservationResultMessage } from "../src/resident-services.ts";

function output() {
  const events: string[] = [];
  return {
    events,
    sink: {
      started: () => {
        events.push("started");
      },
      succeeded: (message: string) => {
        events.push(message);
      },
      failed: (message: string) => {
        events.push(message);
      },
      settled: () => {
        events.push("settled");
      },
    },
  };
}

test("an old confirmation cannot mutate after its screen has unmounted or entered background", async () => {
  const runner = createMutationRunner();
  const { events, sink } = output();
  let posts = 0;
  const confirm = () =>
    runner.run(
      async () => {
        posts++;
      },
      "done",
      sink,
    );
  runner.setActive(false);
  await confirm();
  assert.equal(posts, 0);
  assert.deepEqual(events, []);
});

test("only one mutation runs, and stale completion cannot display success after a lifecycle change", async () => {
  const runner = createMutationRunner();
  const { events, sink } = output();
  let finish!: () => void;
  const first = runner.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    "old success",
    sink,
  );
  await runner.run(
    async () => {
      throw new Error("duplicate action");
    },
    "duplicate",
    sink,
  );
  runner.setActive(false);
  runner.setActive(true);
  finish();
  await first;
  assert.deepEqual(events, ["started", "settled"]);
  await runner.run(
    async () => "new response",
    (result) => result,
    sink,
  );
  assert.deepEqual(events, [
    "started",
    "settled",
    "started",
    "new response",
    "settled",
  ]);
});

test("a confirmation opened before background expires even if the same screen resumes before it is pressed", async () => {
  const runner = createMutationRunner();
  const generation = runner.generation();
  const { events, sink } = output();
  let posts = 0;
  const oldConfirmation = () =>
    runner.run(
      async () => {
        posts++;
      },
      "done",
      sink,
      generation,
    );
  runner.setActive(false);
  runner.setActive(true);
  await oldConfirmation();
  assert.equal(posts, 0);
  assert.deepEqual(events, []);
  await runner.run(
    async () => {
      posts++;
    },
    "new confirmation",
    sink,
    runner.generation(),
  );
  assert.equal(posts, 1);
});

test("reservation success follows the server status even when the cached area no longer requires approval", async () => {
  const runner = createMutationRunner();
  const { events, sink } = output();
  const cachedArea = { requiresApproval: false };
  assert.equal(cachedArea.requiresApproval, false);
  await runner.run(
    async () => ({ status: "PENDING" }),
    (response) => reservationResultMessage(response.status),
    sink,
  );
  assert.deepEqual(events, [
    "started",
    "Reserva enviada para aprovação.",
    "settled",
  ]);
  assert.equal(reservationResultMessage("CONFIRMED"), "Reserva confirmada.");
  assert.doesNotMatch(reservationResultMessage("REJECTED"), /confirmada/);
});
