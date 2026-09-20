import { config } from "./config.js";
import { app } from "./app.js";
import { startRealtimeBus } from "./modules/events/bus.js";

await startRealtimeBus();

app.listen(config.API_PORT, () => {
  console.log(`Prédio ON API: http://localhost:${config.API_PORT}`);
});
