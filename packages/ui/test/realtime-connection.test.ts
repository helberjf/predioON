import assert from "node:assert/strict";
import { it } from "node:test";
import { startRealtimeConnection, type RealtimeSource } from "../src/realtime-connection.ts";

function setup(validate?: () => Promise<void>) {
  let access: string | null = "old-token", validations = 0;
  const opened: Array<{ token: string; stream: RealtimeSource; closed: boolean; events: Map<string, (event: { data: string }) => void> }> = [];
  const timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  const states: boolean[] = [], received: unknown[] = [];
  const stop = startRealtimeConnection({
    accessToken: () => access,
    validateSession: async () => { validations++; if (validate) await validate(); else access = "fresh-token"; },
    openStream: token => {
      const item = { token, closed: false, events: new Map<string, (event: { data: string }) => void>(), stream: null as unknown as RealtimeSource };
      item.stream = { onopen: null, onerror: null, close: () => { item.closed = true; }, addEventListener: (kind, callback) => { item.events.set(kind, callback); } };
      opened.push(item); return item.stream;
    },
    schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    onConnection: connected => states.push(connected), onEvent: event => received.push(event),
  });
  return { opened, timers, states, received, stop, setAccess: (value: string | null) => { access = value; }, validations: () => validations };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

it("closes an expired stream and reconnects only with the renewed session", async () => {
  const fixture = setup();
  const original = fixture.opened[0]!;
  original.stream.onerror?.(); original.stream.onerror?.();
  assert.ok(original.closed);
  assert.equal(fixture.timers.length, 1);
  fixture.timers[0]!.callback(); await flush();
  assert.equal(fixture.validations(), 1);
  assert.equal(fixture.opened[1]?.token, "fresh-token");
  original.stream.onopen?.();
  original.events.get("telemetry")?.({ data: '{"kind":"telemetry"}' });
  assert.ok(!fixture.states.includes(true)); assert.equal(fixture.received.length, 0);
  fixture.stop();
});
it("does not recreate a stream when unmounted during session validation", async () => {
  let finish!: () => void;
  const fixture = setup(() => new Promise<void>(resolve => { finish = resolve; }));
  fixture.opened[0]!.stream.onerror?.(); fixture.timers[0]!.callback();
  fixture.stop(); finish(); await flush();
  assert.equal(fixture.opened.length, 1);
});
it("backs off repeated failures and stops retrying after credentials are cleared", async () => {
  const fixture = setup(async () => { throw new Error("offline"); });
  fixture.opened[0]!.stream.onerror?.();
  for (let i = 0; i < 8; i++) { fixture.timers[i]!.callback(); await flush(); }
  assert.deepEqual(fixture.timers.map(timer => timer.delay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  fixture.setAccess(null);
  fixture.timers[8]!.callback(); await flush();
  assert.equal(fixture.timers.length, 9); assert.equal(fixture.validations(), 8);
  fixture.stop();
});
it("closes and cancels pending work without forwarding malformed or stale frames", () => {
  const fixture = setup(), source = fixture.opened[0]!;
  source.stream.onopen?.();
  source.events.get("alert")?.({ data: "not-json" });
  source.events.get("alert")?.({ data: '{"kind":"alert","alertId":"a"}' });
  assert.equal(fixture.received.length, 1);
  source.stream.onerror?.(); fixture.stop();
  assert.ok(fixture.timers[0]?.cancelled);
  source.stream.onopen?.();
  assert.equal(fixture.states.at(-1), false);
});
