// Configuration is validated before any module constructs a database pool.
import "./config.js";

const [
  { startIngestRuntime },
  { ingestSqlClient, closeIngestDb, verifyRestrictedDatabaseRole },
  { accessServiceSqlClient, closeAccessServiceDb },
  { handleGatewayStatus },
  { handleTelemetry },
  { connectIngest },
  { startOfflineSweeper },
  { handleAccessAck, startAccessDispatcher },
] = await Promise.all([
  import("./startup.js"),
  import("@predioon/db/ingest"),
  import("@predioon/db/access-service"),
  import("./pipeline/gateway-status.js"),
  import("./pipeline/telemetry.js"),
  import("./mqtt.js"),
  import("./offline-sweeper.js"),
  import("./access/dispatcher.js"),
]);

let stop: () => Promise<void>;
try {
  stop = await startIngestRuntime({
    verifyIngest: () => verifyRestrictedDatabaseRole(ingestSqlClient, "predioon_ingest"),
    verifyAccess: () => verifyRestrictedDatabaseRole(accessServiceSqlClient, "predioon_access_service"),
    connect: () => connectIngest(async (topic, payload, metadata) => {
      if (topic.endsWith("/ack")) return handleAccessAck(topic, payload);
      if (topic.endsWith("/telemetry") || topic.endsWith("/telemetria")) return handleTelemetry(topic, payload, metadata);
      if (topic.endsWith("/status")) return handleGatewayStatus(topic, payload);
    }),
    startOffline: startOfflineSweeper,
    startAccess: startAccessDispatcher,
    closeDatabases: async () => { await Promise.all([closeIngestDb(), closeAccessServiceDb()]); },
  });
} catch (error) {
  // startIngestRuntime already closed both pools and returns a fixed message.
  console.error(error instanceof Error ? error.message : "Não foi possível iniciar o runtime de ingestão");
  process.exit(1);
}
console.log("Serviço de ingestão Prédio ON iniciado.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} recebido, encerrando...`);
    stop().then(() => process.exit(0), () => process.exit(1));
  });
}
