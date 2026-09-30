import { Router } from "express";
import { assertApiDatabaseRoles } from "../database.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, service: "predioon-api", timestamp: new Date().toISOString() });
});

/** Readiness: only healthy when the database actually answers. */
healthRouter.get("/ready", async (_req, res) => {
  try {
    await assertApiDatabaseRoles();
    res.json({ ok: true, database: "up" });
  } catch {
    res.status(503).json({ ok: false, database: "down" });
  }
});
