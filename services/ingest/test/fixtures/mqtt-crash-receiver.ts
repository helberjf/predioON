import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { connectIngest } from "../../src/mqtt.js";

// A tiny durable receipt stand-in for the transport crash test, not a SQL mock.
// The production transaction/deduplication is covered by PostgreSQL tests.
const ledger = process.env.MQTT_TEST_LEDGER!;
const mode = process.env.MQTT_TEST_CRASH_POINT;
const seen = new Set(existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean) : []);
const parked = new Promise<void>(() => undefined);

const client = connectIngest(async (_topic, payload) => {
  const eventId = payload.toString();
  process.send?.({ kind: "received", eventId });
  if (mode === "before-persist") await parked;
  if (!seen.has(eventId)) {
    appendFileSync(ledger, `${eventId}\n`, { flush: true });
    seen.add(eventId);
  }
  process.send?.({ kind: "persisted", eventId });
  if (mode === "after-persist") await parked;
});

client.on("packetreceive", packet => {
  if (packet.cmd === "suback") process.send?.({ kind: "ready" });
});
