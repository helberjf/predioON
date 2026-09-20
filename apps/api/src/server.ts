import "./env.js";
import { app } from "./app.js";
const port = Number(process.env.API_PORT ?? 3000);
app.listen(port, () => console.log(`Prédio ON API: http://localhost:${port}`));
