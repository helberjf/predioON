import { handleGatewayStatus } from "./pipeline/gateway-status.js";
import { handleTelemetry } from "./pipeline/telemetry.js";
import { connectIngest } from "./mqtt.js";
import { startOfflineSweeper } from "./offline-sweeper.js";
import { handleAccessAck, startAccessDispatcher } from "./access/dispatcher.js";

const client = connectIngest(async (topic, payload) => {
  if (topic.endsWith("/ack")) return handleAccessAck(topic, payload);
  if (topic.endsWith("/telemetry") || topic.endsWith("/telemetria")) return handleTelemetry(topic, payload);
  if (topic.endsWith("/status")) return handleGatewayStatus(topic, payload);
});

startOfflineSweeper();
const stopAccessDispatcher = startAccessDispatcher(client);
console.log("Serviço de ingestão Prédio ON iniciado.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} recebido, encerrando...`);
    stopAccessDispatcher();
    client.end(false, () => process.exit(0));
  });
}
