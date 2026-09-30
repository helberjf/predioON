import { config } from "./config.js";
import { app } from "./app.js";
import { startRealtimeBus } from "./modules/events/bus.js";
import { assertApiDatabaseRoles, closeApiDatabases } from "./database.js";

try {
  await assertApiDatabaseRoles();
  await startRealtimeBus();
  app.listen(config.API_PORT, () => {
    console.log(`Prédio ON API: http://localhost:${config.API_PORT}`);
  });
} catch {
  console.error("Inicialização recusada: verifique as credenciais restritas do banco da API.");
  await closeApiDatabases();
  process.exitCode = 1;
}
