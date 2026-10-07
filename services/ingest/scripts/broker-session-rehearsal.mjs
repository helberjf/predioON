// Rehearsal, not a test: does a QoS 1 message published while the ingestion
// service is offline survive a restart of the broker itself?
//
//   node scripts/broker-session-rehearsal.mjs <mqtt-url> <docker-container>
//
// Use only a disposable broker container. The script restarts it.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mqtt from "mqtt";

const [url, container] = process.argv.slice(2);
if (!url || !container) { console.error("usage: broker-session-rehearsal.mjs <mqtt-url> <docker-container>"); process.exit(2); }
const clientId = `rehearsal-${randomUUID()}`, topic = `rehearsal/${randomUUID()}/telemetry`;

async function connect(options) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const client = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 3000, ...options });
    // A broker that is still starting may close the socket without any error event.
    const connected = await Promise.race([
      new Promise(resolve => { client.once("connect", () => resolve(true)); client.once("error", () => resolve(false)); client.once("close", () => resolve(false)); }),
      delay(4000).then(() => false),
    ]);
    if (connected) { client.removeAllListeners("error"); client.on("error", () => {}); return client; }
    client.end(true);
    await delay(1000);
  }
  throw new Error("broker did not accept connections");
}
/** Same session options as the ingestion service: fixed client id, clean:false, QoS 1. */
async function subscriber() {
  const received = [];
  const client = await connect({ clientId, clean: false, manualConnect: false });
  client.on("message", (_topic, payload) => received.push(payload.toString()));
  return { client, received };
}
async function publish(label) {
  const publisher = await connect({ clientId: `publisher-${randomUUID()}`, clean: true });
  await publisher.publishAsync(topic, label, { qos: 1 });
  await publisher.endAsync();
}

const first = await subscriber();
await first.client.subscribeAsync(topic, { qos: 1 });
await first.client.endAsync();

// Control: the session survives the subscriber being offline while the broker stays up.
await publish("offline-only");
const control = await subscriber();
await delay(1500);
const offlineOnly = control.received.includes("offline-only");
await control.client.endAsync();

// The case under rehearsal: published while offline, then the broker restarts.
await publish("across-restart");
execFileSync("docker", ["restart", container], { stdio: "ignore" });
const after = await subscriber();
await delay(3000);
const acrossRestart = after.received.includes("across-restart");
// Does the subscription itself survive, for messages published after the restart?
await publish("after-restart");
await delay(1500);
const subscriptionKept = after.received.includes("after-restart");
await after.client.endAsync();

console.log(JSON.stringify({ offlineOnly, acrossRestart, subscriptionKept }));
