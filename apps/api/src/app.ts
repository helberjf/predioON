import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { authenticate } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { healthRouter } from "./modules/health.js";
import { organizationsRouter } from "./modules/organizations/routes.js";
import { buildingsRouter } from "./modules/buildings/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { gatewaysRouter } from "./modules/gateways/routes.js";
import { devicesRouter } from "./modules/devices/routes.js";
import { alertRulesRouter } from "./modules/alert-rules/routes.js";
import { alertsRouter } from "./modules/alerts/routes.js";
import { telemetryRouter } from "./modules/telemetry/routes.js";
import { overviewRouter } from "./modules/overview/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { noticesRouter } from "./modules/notices/routes.js";
import { occurrencesRouter } from "./modules/occurrences/routes.js";
import { commonAreasRouter } from "./modules/common-areas/routes.js";
import { reservationsRouter } from "./modules/reservations/routes.js";
import { eventsRouter } from "./modules/events/routes.js";
import { mqttRouter } from "./modules/mqtt/routes.js";
import { monitoringRouter } from "./modules/monitoring/routes.js";
import { accessRouter } from "./modules/access/routes.js";
import { parkingRouter } from "./modules/parking/routes.js";
import { supportRouter } from "./modules/support/routes.js";
import { financeRouter } from "./modules/finance/routes.js";
import { featuresRouter } from "./modules/features/routes.js";
import { tenancyRouter } from "./modules/tenancy/routes.js";
import { authorizationRouter } from "./modules/authorization/routes.js";

export const app = express();
app.set("trust proxy", config.trustedProxyCidrs.length ? config.trustedProxyCidrs : false);

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(["/auth/login", "/auth/web/login"], express.json({ limit: "8kb" }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ name: "Prédio ON API", version: 1 }));
app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/internal/mqtt", mqttRouter);

// SSE authenticates itself, because EventSource cannot send headers.
app.use("/events", eventsRouter);

app.use(authenticate);
app.use("/v1/tenancy", tenancyRouter);
app.use("/v1/authorization", authorizationRouter);
app.use("/features", featuresRouter);
app.use("/organizations", organizationsRouter);
app.use("/buildings", buildingsRouter);
app.use("/users", usersRouter);
app.use("/gateways", gatewaysRouter);
app.use("/devices", devicesRouter);
app.use("/alert-rules", alertRulesRouter);
app.use("/alerts", alertsRouter);
app.use("/telemetry", telemetryRouter);
app.use("/overview", overviewRouter);
app.use("/audit", auditRouter);
app.use("/notices", noticesRouter);
app.use("/occurrences", occurrencesRouter);
app.use("/common-areas", commonAreasRouter);
app.use("/reservations", reservationsRouter);
app.use("/monitoring", monitoringRouter);
app.use("/access", accessRouter);
app.use("/parking", parkingRouter);
app.use("/support", supportRouter);
app.use("/finance", financeRouter);

app.use(notFoundHandler);
app.use(errorHandler);
