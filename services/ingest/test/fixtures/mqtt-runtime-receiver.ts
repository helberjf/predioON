// Child process for mqtt-runtime.integration: the real MQTT session and telemetry
// pipeline, with only the two restricted database URLs in its environment.
import { ingestSqlClient, verifyRestrictedDatabaseRole } from "@predioon/db/ingest";
import { connectIngest } from "../../src/mqtt.js";
import { handleTelemetry } from "../../src/pipeline/telemetry.js";

if (process.env.DATABASE_URL || process.env.TEST_INGEST_DATABASE_URL) throw new Error("receiver must not receive an owner URL");
await verifyRestrictedDatabaseRole(ingestSqlClient, "predioon_ingest");

const mode = process.env.MQTT_TEST_CRASH_POINT;
const parked = new Promise<void>(() => undefined);
const client = connectIngest(async (topic, payload, metadata) => {
  process.send?.({ kind: "received" });
  await handleTelemetry(topic, payload, metadata);
  process.send?.({ kind: "committed" });
  // Committed, but the callback never returns: MQTT.js withholds the PUBACK.
  if (mode === "after-commit") await parked;
});
client.on("packetreceive", packet => {
  if (packet.cmd === "suback") process.send?.({ kind: "ready" });
});
