import { handleGatewayStatus } from "./pipeline/gateway-status.js";
import { handleTelemetry } from "./pipeline/telemetry.js";
import { connectIngest } from "./mqtt.js";
import { startOfflineSweeper } from "./offline-sweeper.js";

const client = connectIngest(async (topic, payload) => {
  if (topic.endsWith("/telemetry") || topic.endsWith("/telemetria")) return handleTelemetry(topic, payload);
  if (topic.endsWith("/status")) return handleGatewayStatus(topic, payload);
});

startOfflineSweeper();
console.log("Serviço de ingestão Prédio ON iniciado.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} recebido, encerrando...`);
    client.end(false, () => process.exit(0));
  });
}
