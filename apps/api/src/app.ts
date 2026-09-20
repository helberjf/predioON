import express from "express";
import cors from "cors";
import { devAuth } from "./middleware/devAuth.js";
import { healthRouter } from "./routes/health.js";
import { devicesRouter } from "./routes/devices.js";
import { alertsRouter } from "./routes/alerts.js";
import { adminRouter } from "./routes/admin.js";

export const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (_req, res) => res.json({ name: "Prédio ON API" }));
app.use("/health", healthRouter);
app.use(devAuth);
app.use("/devices", devicesRouter);
app.use("/alerts", alertsRouter);
app.use("/admin", adminRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err instanceof Error ? err.message : "Unexpected error" });
});
